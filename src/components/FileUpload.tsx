import { useState, useRef, useCallback } from 'react';
import { Upload, FileVideo, X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

interface FileUploadProps {
  onUploadComplete: (fileId: string, fileName: string) => void;
  onError: (message: string) => void;
}

const ACCEPTED_TYPES = '.mp4,.mov,.webm,.avi,.mkv,.m4v';
const MAX_SIZE_MB = 2048;

export default function FileUpload({ onUploadComplete, onError }: FileUploadProps) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileInfo, setFileInfo] = useState<{ name: string; size: number } | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const formatSize = (bytes: number): string => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const handleFile = useCallback(async (file: File) => {
    // Validate
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    const allowed = ['.mp4', '.mov', '.webm', '.avi', '.mkv', '.m4v'];
    if (!allowed.includes(ext)) {
      setError(`Format file tidak didukung. Gunakan: MP4, MOV, WebM, AVI, MKV, atau M4V.`);
      return;
    }

    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`File terlalu besar. Maksimal ${MAX_SIZE_MB} MB (2 GB).`);
      return;
    }

    setError('');
    setFileInfo({ name: file.name, size: file.size });
    setUploading(true);
    setUploadProgress(0);

    // Upload with progress tracking
    const formData = new FormData();
    formData.append('video', file);

    try {
      const xhr = new XMLHttpRequest();

      const result = await new Promise<{ fileId: string; fileName: string }>((resolve, reject) => {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setUploadProgress(pct);
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const data = JSON.parse(xhr.responseText);
              resolve({ fileId: data.fileId, fileName: data.fileName });
            } catch {
              reject(new Error('Failed to parse server response'));
            }
          } else {
            try {
              const data = JSON.parse(xhr.responseText);
              reject(new Error(data.error || 'Upload failed'));
            } catch {
              reject(new Error(`Upload failed (${xhr.status})`));
            }
          }
        };

        xhr.onerror = () => reject(new Error('Network error — please check your connection'));
        xhr.onabort = () => reject(new Error('Upload cancelled'));

        xhr.open('POST', '/api/upload');
        xhr.send(formData);
      });

      setUploadProgress(100);
      setUploading(false);
      onUploadComplete(result.fileId, result.fileName);

    } catch (err) {
      setUploading(false);
      setFileInfo(null);
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setError(msg);
      onError(msg);
    }
  }, [onUploadComplete, onError]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  }, [handleFile]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
    // Reset so the same file can be selected again
    e.target.value = '';
  };

  const handleReset = () => {
    setFileInfo(null);
    setError('');
    setUploadProgress(0);
  };

  // ── Already uploaded state ──────────────────────────────────────
  if (fileInfo && !uploading) {
    return (
      <div className="w-full max-w-2xl mx-auto">
        <div className="p-5 rounded-xl bg-muted/30 border border-border">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-6 h-6 text-accent" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {fileInfo.name}
              </p>
              <p className="text-xs text-foreground/40 mt-0.5">
                {formatSize(fileInfo.size)} — Siap dipotong
              </p>
            </div>
            <button
              onClick={handleReset}
              className="p-2 rounded-lg text-foreground/30 hover:text-foreground hover:bg-muted transition-all duration-150 cursor-pointer"
              aria-label="Pilih file lain"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={uploading ? undefined : handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(); }}
        aria-label="Upload video file"
        className={`
          relative p-8 rounded-2xl border-2 border-dashed
          transition-all duration-200 ease-out cursor-pointer
          text-center
          ${dragOver
            ? 'border-accent bg-accent/5'
            : 'border-border hover:border-accent/40 hover:bg-muted/20'
          }
          ${uploading ? 'pointer-events-none' : ''}
          focus:outline-none focus:ring-2 focus:ring-accent/40
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          className="hidden"
          onChange={handleInputChange}
          aria-hidden="true"
        />

        {uploading ? (
          <div className="space-y-4">
            <Loader2 className="w-10 h-10 mx-auto text-accent animate-spin" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-foreground/70">Mengupload...</p>
              {fileInfo && (
                <p className="text-xs text-foreground/40 mt-1">{fileInfo.name}</p>
              )}
            </div>
            <div className="max-w-xs mx-auto">
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-300 ease-out"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="text-xs text-foreground/40 mt-1.5">{uploadProgress}%</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-accent/10 flex items-center justify-center">
              <Upload className="w-7 h-7 text-accent" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground/70">
                Tarik & lepas video di sini
              </p>
              <p className="text-xs text-foreground/40 mt-1">
                atau klik untuk memilih file
              </p>
            </div>
            <div className="flex items-center justify-center gap-3 text-xs text-foreground/30">
              <span className="flex items-center gap-1">
                <FileVideo className="w-3.5 h-3.5" />
                MP4, MOV, WebM
              </span>
              <span className="w-px h-3 bg-border" aria-hidden="true" />
              <span>Maks {MAX_SIZE_MB} MB (2 GB)</span>
            </div>
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div role="alert" className="mt-3 flex items-start gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20">
          <AlertCircle className="w-4 h-4 mt-0.5 text-destructive flex-shrink-0" aria-hidden="true" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}
    </div>
  );
}