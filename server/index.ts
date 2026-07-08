import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import dotenv from 'dotenv';
import ffmpegPath from 'ffmpeg-static';
import archiver from 'archiver';
import { runPipeline } from './pipeline.js';

// Set ffmpeg path from the installed package (so fluent-ffmpeg can find the binary)
if (ffmpegPath) {
  process.env.FFMPEG_PATH = ffmpegPath;
}

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// Paths
const outputDir = path.resolve(__dirname, '..', 'output');

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Serve output directory for clip downloads
app.use('/api/clips', express.static(outputDir));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * POST /api/generate
 * Accepts: { "url": "https://www.youtube.com/watch?v=..." }
 * Returns: Server-Sent Events stream with progress updates
 */
app.post('/api/generate', async (req, res) => {
  const { url } = req.body;

  // Validate URL
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'Missing or invalid "url" in request body' });
    return;
  }

  const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/i;
  if (!youtubeRegex.test(url.trim())) {
    res.status(400).json({ error: 'Invalid YouTube URL. Please provide a valid YouTube video URL.' });
    return;
  }

  // Check for GEMINI_API_KEY
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
    res.status(400).json({
      error: 'GEMINI_API_KEY is not configured. Please set it in your .env file. Get a key at https://aistudio.google.com/app/apikey',
    });
    return;
  }

  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

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
    });

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