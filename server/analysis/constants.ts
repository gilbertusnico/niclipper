/**
 * Tunable parameters for the moment-detection engine.
 * All weights/thresholds live here so tuning never needs code changes elsewhere.
 */

// ─── Clip length ─────────────────────────────────────────────────────────
export const CLIP_MIN_SECONDS = 25;
export const CLIP_MAX_SECONDS = 75;
/** Preferred length; windows are scored with a Gaussian around this.
 *  Conversational stories need room for their setup, so ~50 s. */
export const CLIP_IDEAL_SECONDS = 50;
export const CLIP_IDEAL_SPREAD = 22;
/** Opening/closing stretch of the video (greetings, guest intro, thanks, sign-off). */
export const EDGE_ZONE_SECONDS = 90;
export const EDGE_ZONE_FRACTION = 0.05;
/** How many clips AI mode returns. */
export const DEFAULT_MAX_CLIPS = 3;

// ─── Window scoring ──────────────────────────────────────────────────────
export const HOOK_WINDOW_SECONDS = 7;
export const PAYOFF_WINDOW_SECONDS = 8;
/** Units whose start/end quality is below this are never used as clip edges. */
export const MIN_START_QUALITY = 0.35;
export const MIN_END_QUALITY = 0.35;

export const WEIGHTS = {
  /** Average interest across the whole clip (most important: no boring middle). */
  density: 0.34,
  /** Best two moments inside the clip. */
  peak: 0.10,
  /** First ~7 s: interesting + clean start + opener (question/claim/story). */
  hook: 0.21,
  /** Last ~8 s: clean end + conclusion/reaction. */
  payoff: 0.18,
  /** No strong topic change inside the clip (vocabulary-based → kept light). */
  coherence: 0.07,
  /** Clip starts/ends where the topic changes (a complete segment). */
  topicEdges: 0.02,
  /** Talk right before/after the clip is less interesting than the clip (whole "island"). */
  island: 0.14,
  /** Closeness to the ideal length. */
  duration: 0.04,
} as const;

// ─── Selection ───────────────────────────────────────────────────────────
/** Seconds that must separate two selected clips. */
export const MIN_GAP_BETWEEN_CLIPS = 5;
/** Max keyword Jaccard overlap between two selected clips. */
export const MAX_KEYWORD_OVERLAP = 0.45;
/** Extra clips must score at least this fraction of the best clip's score. */
export const MIN_RELATIVE_SCORE = 0.6;

// ─── Audio analysis ──────────────────────────────────────────────────────
export const AUDIO_FRAME_MS = 50;
/** Upper bound for the adaptive silence threshold (RMS). */
export const SILENCE_RMS_THRESHOLD = 0.02;
export const SILENCE_MIN_DURATION = 0.2;
export const ENERGY_BURST_THRESHOLD = 2.5;
