import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import dotenv from 'dotenv';
import * as archiver from 'archiver';
import multer from 'multer';
import { runPipeline } from './pipeline.js';
import { runManualPipeline } from './manual-pipeline.js';
import type { TimeRange } from './manual-pipeline.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// Paths
const outputDir = path.resolve(__dirname, '..', 'output');
const uploadsDir = path.resolve(__dirname, '..', 'uploads');

// In-memory store for uploaded files: fileId -> { filePath, fileName, fileSize }
const uploadedFiles = new Map<string, { filePath: string; fileName: string; fileSize: number }>();

// In-memory store for downloaded YouTube videos: url -> filePath
const downloadedVideos = new Map<string, string>();

// Multer setup for video uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp4';
    const name = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 512 * 1024 * 1024 }, // 512 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.mp4', '.mov', '.webm', '.avi', '.mkv', '.m4v'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file format: ${ext}. Allowed: ${allowed.join(', ')}`));
    }
  },
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Serve output directory for clip downloads and thumbnails
app.use('/api/clips', express.static(outputDir));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * POST /api/upload
 * Upload a local video file for cropping.
 * Accepts multipart/form-data with field name "video".
 */
app.post('/api/upload', (req, res) => {
  upload.single('video')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: 'File terlalu besar. Maksimal 512 MB.' });
        return;
      }
      const message = err instanceof Error ? err.message : 'Upload failed';
      res.status(400).json({ error: message });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'No video file provided. Please select a file to upload.' });
      return;
    }

    const fileId = crypto.randomUUID();
    const fileInfo = {
      filePath: req.file.path,
      fileName: req.file.originalname,
      fileSize: req.file.size,
    };
    uploadedFiles.set(fileId, fileInfo);

    console.log(`[Upload] File saved: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(1)} MB) -> id=${fileId}`);

    res.json({
      fileId,
      fileName: req.file.originalname,
      fileSize: req.file.size,
    });
  });
});

/**
 * GET /api/crop-local?fileId=...&ranges=[[start,end],...]
 * SSE endpoint for cropping an uploaded local file at user-specified time ranges.
 * Skips download stage entirely.
 */
app.get('/api/crop-local', async (req, res) => {
  const fileId = req.query.fileId as string | undefined;
  const rangesRaw = req.query.ranges as string | undefined;
  const transcript = req.query.transcript as string | undefined;
  const subtitles = req.query.subtitles as string | undefined;

  // Validate fileId
  if (!fileId || typeof fileId !== 'string') {
    res.status(400).json({ error: 'Missing "fileId" query parameter' });
    return;
  }

  const fileInfo = uploadedFiles.get(fileId);
  if (!fileInfo) {
    res.status(400).json({ error: 'File not found. It may have expired. Please upload again.' });
    return;
  }

  if (!fs.existsSync(fileInfo.filePath)) {
    res.status(400).json({ error: 'Uploaded file no longer exists on disk. Please upload again.' });
    return;
  }

  // Parse ranges
  let ranges: TimeRange[];
  try {
    const parsed = JSON.parse(rangesRaw || '[]');
    if (!Array.isArray(parsed) || parsed.length === 0) {
      res.status(400).json({ error: 'Missing or invalid "ranges" parameter. Provide a JSON array of [start, end] pairs.' });
      return;
    }
    ranges = parsed.map((pair: unknown, i: number) => {
      let start: number;
      let end: number;

      if (Array.isArray(pair)) {
        if (pair.length < 2) throw new Error(`Range ${i} is invalid`);
        start = Number(pair[0]);
        end = Number(pair[1]);
      } else if (pair && typeof pair === 'object') {
        const obj = pair as Record<string, unknown>;
        start = Number(obj.start);
        end = Number(obj.end);
      } else {
        throw new Error(`Range ${i} is invalid`);
      }

      if (isNaN(start) || isNaN(end) || start < 0 || end <= start) {
        throw new Error(`Range ${i} has invalid values: start=${start}, end=${end}`);
      }
      return { start, end };
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invalid ranges format';
    res.status(400).json({ error: `Invalid ranges: ${msg}` });
    return;
  }

  if (ranges.length > 5) {
    res.status(400).json({ error: 'Maximum 5 time ranges allowed.' });
    return;
  }

  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const sendEvent = (stage: string, progress: number, extra?: Record<string, unknown>) => {
    const data = JSON.stringify({ stage, progress, ...extra });
    res.write(`data: ${data}\n\n`);
  };

  let aborted = false;
  req.on('close', () => { aborted = true; });

  try {
    // Import and run a modified manual pipeline that uses local file instead of downloading
    const { runLocalFilePipeline } = await import('./local-file-pipeline.js');
    const clips = await runLocalFilePipeline(fileInfo.filePath, ranges, (stage, progress, extra) => {
      if (!aborted) sendEvent(stage, progress, extra);
    }, transcript, (subtitles as 'auto' | 'none' | 'manual') || 'auto');

    if (!aborted) {
      sendEvent('done', 100, { clips });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'An unexpected error occurred';
    console.error('[CropLocal] Error:', message);
    if (!aborted) {
      sendEvent('error', 0, { message });
    }
  }

  if (!aborted) {
    res.end();
  }
});

/**
 * GET /api/generate?url=...
 * Uses SSE (Server-Sent Events) via native EventSource API.
 * Accepts URL as query parameter so we can use GET (EventSource only supports GET).
 */
app.get('/api/generate', async (req, res) => {
  const url = req.query.url as string | undefined;
  const subtitles = req.query.subtitles as string | undefined;

  // Validate URL
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'Missing "url" query parameter' });
    return;
  }

  const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/i;
  if (!youtubeRegex.test(url.trim())) {
    res.status(400).json({ error: 'Invalid YouTube URL. Please provide a valid YouTube video URL.' });
    return;
  }

  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  // Helper to send SSE events
  const sendEvent = (stage: string, progress: number, extra?: Record<string, unknown>) => {
    const data = JSON.stringify({ stage, progress, ...extra });
    res.write(`data: ${data}\n\n`);
  };

  // Handle client disconnect
  let aborted = false;
  req.on('close', () => {
    aborted = true;
  });

  try {
    // Run the pipeline, sending progress events as we go
    const clips = await runPipeline(url.trim(), (stage, progress, extra) => {
      if (!aborted) {
        sendEvent(stage, progress, extra);
      }
    }, (subtitles as 'auto' | 'none' | 'manual') || 'auto');

    if (!aborted) {
      sendEvent('done', 100, { clips });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'An unexpected error occurred';
    console.error('Pipeline error:', message);
    if (!aborted) {
      sendEvent('error', 0, { message });
    }
  }

  // End the stream
  if (!aborted) {
    res.end();
  }
});

/**
 * GET /api/crop-manual?url=...&ranges=[[start,end],...]
 * SSE endpoint for manual time-range cropping (no AI analysis).
 * ranges is a JSON-encoded array of [startSeconds, endSeconds] pairs.
 */
app.get('/api/crop-manual', async (req, res) => {
  const url = req.query.url as string | undefined;
  const rangesRaw = req.query.ranges as string | undefined;
  const transcript = req.query.transcript as string | undefined;
  const subtitles = req.query.subtitles as string | undefined;

  // Validate URL
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'Missing "url" query parameter' });
    return;
  }

  const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/i;
  if (!youtubeRegex.test(url.trim())) {
    res.status(400).json({ error: 'Invalid YouTube URL. Please provide a valid YouTube video URL.' });
    return;
  }

  // Parse ranges
  let ranges: TimeRange[];
  try {
    const parsed = JSON.parse(rangesRaw || '[]');
    if (!Array.isArray(parsed) || parsed.length === 0) {
      res.status(400).json({ error: 'Missing or invalid "ranges" parameter. Provide a JSON array of [start, end] pairs.' });
      return;
    }
    ranges = parsed.map((pair: unknown, i: number) => {
      let start: number;
      let end: number;

      if (Array.isArray(pair)) {
        // Array format: [start, end]
        if (pair.length < 2) {
          throw new Error(`Range ${i} is invalid`);
        }
        start = Number(pair[0]);
        end = Number(pair[1]);
      } else if (pair && typeof pair === 'object') {
        // Object format: { start, end }
        const obj = pair as Record<string, unknown>;
        start = Number(obj.start);
        end = Number(obj.end);
      } else {
        throw new Error(`Range ${i} is invalid`);
      }

      if (isNaN(start) || isNaN(end) || start < 0 || end <= start) {
        throw new Error(`Range ${i} has invalid values: start=${start}, end=${end}`);
      }
      return { start, end };
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invalid ranges format';
    res.status(400).json({ error: `Invalid ranges: ${msg}` });
    return;
  }

  if (ranges.length > 5) {
    res.status(400).json({ error: 'Maximum 5 time ranges allowed.' });
    return;
  }

  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const sendEvent = (stage: string, progress: number, extra?: Record<string, unknown>) => {
    const data = JSON.stringify({ stage, progress, ...extra });
    res.write(`data: ${data}\n\n`);
  };

  let aborted = false;
  req.on('close', () => {
    aborted = true;
  });

  try {
    const clips = await runManualPipeline(url.trim(), ranges, (stage, progress, extra) => {
      if (!aborted) {
        sendEvent(stage, progress, extra);
      }
    }, transcript, (subtitles as 'auto' | 'none' | 'manual') || 'auto');

    if (!aborted) {
      sendEvent('done', 100, { clips });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'An unexpected error occurred';
    console.error('ManualPipeline error:', message);
    if (!aborted) {
      sendEvent('error', 0, { message });
    }
  }

  if (!aborted) {
    res.end();
  }
});

/**
 * POST /api/rerender-subtitles
 * Re-crop clips with an edited transcript (no re-transcription).
 * Accepts JSON body: { url, fileId, ranges, transcript }
 *   - url: YouTube URL (for AI/manual YouTube clips)
 *   - fileId: uploaded file ID (for local file clips)
 * Returns JSON response with updated clips.
 */
app.post('/api/rerender-subtitles', express.json({ limit: '5mb' }), async (req, res) => {
  const { url, fileId, ranges: rangesBody, transcript } = req.body as {
    url?: string;
    fileId?: string;
    ranges?: { start: number; end: number }[];
    transcript?: string;
  };

  const isLocalFile = !!fileId;

  if (!isLocalFile) {
    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: 'Missing "url" in request body' });
      return;
    }

    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/i;
    if (!youtubeRegex.test(url.trim())) {
      res.status(400).json({ error: 'Invalid YouTube URL' });
      return;
    }
  } else {
    const fileInfo = uploadedFiles.get(fileId);
    if (!fileInfo) {
      res.status(400).json({ error: 'File not found. It may have expired. Please upload again.' });
      return;
    }
    if (!fs.existsSync(fileInfo.filePath)) {
      res.status(400).json({ error: 'Uploaded file no longer exists on disk. Please upload again.' });
      return;
    }
  }

  if (!rangesBody || !Array.isArray(rangesBody) || rangesBody.length === 0) {
    res.status(400).json({ error: 'Missing or invalid "ranges"' });
    return;
  }

  if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
    res.status(400).json({ error: 'Missing or empty "transcript"' });
    return;
  }

  let validRanges: TimeRange[];
  try {
    validRanges = rangesBody.map((r, i) => {
      const start = Number(r.start);
      const end = Number(r.end);
      if (isNaN(start) || isNaN(end) || start < 0 || end <= start) {
        throw new Error(`Range ${i} has invalid values`);
      }
      return { start, end };
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invalid ranges';
    res.status(400).json({ error: `Invalid ranges: ${msg}` });
    return;
  }

  try {
    let clips;

    if (isLocalFile) {
      const fileInfo = uploadedFiles.get(fileId!)!;
      const { runLocalFilePipeline } = await import('./local-file-pipeline.js');
      clips = await runLocalFilePipeline(fileInfo.filePath, validRanges, () => {}, transcript);
    } else {
      clips = await runManualPipeline(url!.trim(), validRanges, () => {}, transcript);
    }

    res.json({ clips });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'An unexpected error occurred';
    console.error('[RerenderSubtitles] Error:', message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/open-folder
 * Opens the output folder in the system file manager
 */
app.get('/api/open-folder', (_req, res) => {
  const platform = process.platform;
  let cmd: string;

  if (platform === 'darwin') {
    cmd = `open "${outputDir}"`;
  } else if (platform === 'win32') {
    cmd = `explorer "${outputDir}"`;
  } else {
    // Linux / others
    cmd = `xdg-open "${outputDir}"`;
  }

  exec(cmd, (error) => {
    if (error) {
      console.error('Failed to open folder:', error.message);
      res.status(500).json({ error: 'Failed to open folder. You can find clips in the output/ directory.' });
      return;
    }
    res.json({ success: true, message: 'Output folder opened in file manager.' });
  });
});

/**
 * GET /api/download-code
 * Downloads the entire project source code as a ZIP file (excluding node_modules, output, .env)
 */
app.get('/api/download-code', (req, res) => {
  const projectRoot = path.resolve(__dirname, '..');

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename=niclipper-source.zip');

  const archive = archiver('zip', { zlib: { level: 5 } });
  archive.pipe(res);

  // Directories/files to exclude
  const exclude = new Set([
    'node_modules',
    'output',
    'uploads',
    '.env',
    'dist',
    '.git',
  ]);

  // Walk helper
  function addToArchive(dirPath: string, archivePath: string) {
    let entries: string[];
    try {
      entries = fs.readdirSync(dirPath);
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);
      const relPath = archivePath ? `${archivePath}/${entry}` : entry;
      if (exclude.has(entry)) continue;
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          addToArchive(fullPath, relPath);
        } else if (stat.isFile()) {
          archive.file(fullPath, { name: relPath });
        }
      } catch {
        // skip unreadable files
      }
    }
  }

  addToArchive(projectRoot, '');

  archive.finalize();
});

app.listen(PORT, () => {
  console.log(`\n  🚀  Niclipper server running on http://localhost:${PORT}`);
  console.log(`  📁  Output directory: ${outputDir}`);
  console.log(`  📋  Health check: http://localhost:${PORT}/api/health\n`);
});