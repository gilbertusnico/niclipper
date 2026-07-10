# Fix ONNX Reshape Error in Whisper Transcription

## Problem
The Whisper transcription pipeline failed with an ONNX Reshape error:
```
Non-zero status code returned while running Reshape node.
Name:'/model/decoder/layers.0/self_attn/Reshape_6'
```

## Root Cause
The `whisper-base` model (Xenova/whisper-base) was being used, which has incompatible ONNX operator versions with the current @xenova/transformers and ONNX Runtime builds. The error occurred specifically in the decoder's self-attention Reshape operation, indicating an ONNX opset mismatch.

## Fix Applied
1. **Switched model** from `whisper-base` to `whisper-tiny` (Xenova/whisper-tiny) — a smaller, more compatible model
2. **Cleared stale model cache** — added cleanup code that removes any cached ONNX files from the previous model to prevent incompatible file reuse
3. **Set `env.allowLocalModels = false`** — forces fresh download of compatible ONNX files instead of using stale cached versions
4. **Added better error logging** — wraps the transcription call in a try-catch with detailed ONNX error output for debugging

## Files Modified
- `server/transcriber.ts` — model switch, cache clearing, error handling

## Verification
After the fix, the server should download `whisper-tiny` fresh, run transcription without the Reshape error, and log progress correctly.