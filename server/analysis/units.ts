/**
 * Units — turn a timestamped transcript into short speech units with REAL
 * timestamps (one caption cue / Whisper chunk, or a piece of a long one).
 *
 * Clip boundaries are always placed on unit edges, so start/end times come
 * from the transcript itself instead of being estimated.
 *
 * Handles the two transcript sources the pipeline produces:
 *  - YouTube captions: short cues (2–5s), often without punctuation, and
 *    auto-captions are "rolling" (each cue repeats the previous line).
 *  - Whisper chunks: punctuated, sometimes long (10–30s), may overlap or
 *    have a missing end time.
 */

export interface Unit {
  index: number;
  start: number;
  end: number;
  /** Spoken text with original punctuation (bracket tags removed). */
  text: string;
  /** Lowercased words (letters/digits/% only). */
  words: string[];
  /** " word word word " — padded for whole-phrase matching. */
  norm: string;
  /** Bracketed caption tags, e.g. ["tertawa"], ["musik"]. */
  tags: string[];
  /** Text ends with . ! ? (sentence end). */
  terminal: boolean;
  /** Text ends with , ; : (clause end). */
  comma: boolean;
}

const TIMESTAMP_RE = /\[TIMESTAMP:\s*([\d.]+)\s*->\s*([\d.]+)\s*\]/i;
const MAX_UNIT_SECONDS = 9;

interface RawSeg { start: number; end: number; text: string; }

export function toWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}%\s-]/gu, ' ')
    .replace(/(^|\s)-+|-+(\s|$)/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function parseRaw(transcript: string): RawSeg[] {
  const segs: RawSeg[] = [];
  let cur: RawSeg | null = null;
  for (const rawLine of transcript.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(TIMESTAMP_RE);
    if (m) {
      if (cur && cur.text.trim()) segs.push(cur);
      cur = { start: parseFloat(m[1]), end: parseFloat(m[2]), text: '' };
      const rest = line.replace(TIMESTAMP_RE, '').trim();
      if (rest) cur.text = rest;
    } else if (cur) {
      cur.text = cur.text ? `${cur.text} ${line}` : line;
    }
  }
  if (cur && cur.text.trim()) segs.push(cur);
  return segs.filter((s) => Number.isFinite(s.start));
}

/** Number of words at the end of `prev` repeated at the start of `cur` (rolling captions). */
function repeatedPrefix(prev: string[], cur: string[]): number {
  const max = Math.min(prev.length, cur.length);
  for (let k = max; k >= 1; k--) {
    let ok = true;
    for (let i = 0; i < k; i++) {
      if (prev[prev.length - k + i] !== cur[i]) { ok = false; break; }
    }
    if (ok && (k >= 2 || k === prev.length)) return k;
  }
  return 0;
}

/** Split a long segment at sentence punctuation (or evenly) with time ∝ characters. */
function splitLong(seg: RawSeg): RawSeg[] {
  const duration = seg.end - seg.start;
  if (duration <= MAX_UNIT_SECONDS) return [seg];

  let pieces = seg.text.split(/(?<=[.!?])\s+/).filter((p) => p.trim());
  if (pieces.length < 2) pieces = seg.text.split(/(?<=[,;:])\s+/).filter((p) => p.trim());
  const targetPieces = Math.ceil(duration / 5);
  if (pieces.length < 2) {
    const words = seg.text.split(/\s+/).filter(Boolean);
    const per = Math.max(1, Math.ceil(words.length / targetPieces));
    pieces = [];
    for (let i = 0; i < words.length; i += per) pieces.push(words.slice(i, i + per).join(' '));
  }
  if (pieces.length < 2) return [seg];

  const totalChars = pieces.reduce((n, p) => n + p.length, 0) || 1;
  const out: RawSeg[] = [];
  let t = seg.start;
  pieces.forEach((p, i) => {
    const end = i === pieces.length - 1 ? seg.end : t + duration * (p.length / totalChars);
    out.push({ start: t, end, text: p });
    t = end;
  });
  // Pieces may still be long (no punctuation in a long stretch) — recurse once more.
  return out.flatMap((p) => (p.end - p.start > MAX_UNIT_SECONDS * 1.5 && p !== seg ? splitLong(p) : [p]));
}

function makeUnit(index: number, start: number, end: number, rawText: string): Unit {
  const tags = (rawText.match(/\[([^\]]*)\]/g) ?? []).map((t) => t.slice(1, -1).toLowerCase().trim());
  const text = rawText.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = toWords(text);
  return {
    index,
    start,
    end,
    text,
    words,
    norm: ` ${words.join(' ')} `,
    tags,
    terminal: /[.!?…]["')\]]*$/.test(text),
    comma: /[,;:]["')\]]*$/.test(text),
  };
}

/**
 * Re-segment speech into "breath groups" between the speaker's real pauses.
 *
 * Caption cues (especially YouTube's ~7-word cues) cut straight through
 * sentences, so their edges are poor clip boundaries. The pauses in the
 * audio ARE the sentence/clause boundaries. All words are laid on one
 * timeline (time estimated by character position inside their cue, skipping
 * pauses) and regrouped between pauses, ignoring cue edges. Group edges are
 * the pause times themselves (accurate); only which word lands on which side
 * of a pause is estimated, and that only affects scoring.
 */
export function splitUnitsAtPauses(
  units: Unit[],
  silences: { startTime: number; endTime: number; duration: number }[],
  minPause = 0.28,
): Unit[] {
  const pauses = silences.filter((p) => p.duration >= minPause).sort((a, b) => a.startTime - b.startTime);
  if (pauses.length === 0 || units.length === 0) return units;

  interface W { tok: string; t0: number; t1: number; cue: number; cueStart: number; cueEnd: number; }
  const words: W[] = [];
  let pi = 0;
  units.forEach((u, cue) => {
    const tokens = u.text.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return;
    while (pi < pauses.length && pauses[pi].endTime <= u.start) pi++;
    const inside: typeof pauses = [];
    for (let k = pi; k < pauses.length && pauses[k].startTime < u.end; k++) {
      const p = pauses[k];
      const a = Math.max(p.startTime, u.start), b = Math.min(p.endTime, u.end);
      if (b > a) inside.push({ startTime: a, endTime: b, duration: b - a });
    }
    const speech = Math.max(0.1, u.end - u.start - inside.reduce((s, p) => s + p.duration, 0));
    const toWall = (st: number) => {
      let t = u.start + st;
      for (const p of inside) if (p.startTime <= t) t += p.duration;
      return t;
    };
    const totalChars = tokens.reduce((s, t) => s + t.length + 1, 0);
    let chars = 0;
    for (const tok of tokens) {
      const a = toWall((chars / totalChars) * speech);
      chars += tok.length + 1;
      const b = toWall((chars / totalChars) * speech);
      words.push({ tok, t0: a, t1: b, cue, cueStart: u.start, cueEnd: u.end });
    }
  });
  if (words.length === 0) return units;

  // Map each pause to the token boundary it most likely falls on: nearest in
  // estimated time, but strongly preferring a boundary right after
  // punctuation (". ! ?" > ", ; :") because word timing inside a long chunk
  // drifts while punctuation does not.
  const punctBonus = (tok: string) => (/[.!?…]["')\]]*$/.test(tok) ? 0.9 : /[,;:]["')\]]*$/.test(tok) ? 0.4 : 0);
  const cuts: { after: number; pause: typeof pauses[number] }[] = [];
  let lo = 0;
  for (const p of pauses) {
    const mid = (p.startTime + p.endTime) / 2;
    if (mid < words[0].t0 || mid > words[words.length - 1].t1) continue;
    // Scan a ±2.5 s neighbourhood of boundaries.
    while (lo < words.length - 1 && words[lo].t1 < mid - 2.5) lo++;
    let best = -1, bestCost = Infinity;
    for (let i = lo; i < words.length - 1 && words[i].t1 <= mid + 2.5; i++) {
      const cost = Math.abs(words[i].t1 - mid) - punctBonus(words[i].tok);
      if (cost < bestCost) { bestCost = cost; best = i; }
    }
    if (best < 0) continue;
    const prev = cuts[cuts.length - 1];
    if (prev && best <= prev.after) {
      // Two pauses mapped to the same/earlier boundary: keep the longer pause.
      if (best === prev.after && p.duration > prev.pause.duration) prev.pause = p;
      continue;
    }
    cuts.push({ after: best, pause: p });
  }

  const out: Unit[] = [];
  let from = 0;
  let groupStart = words[0].cueStart;
  const emit = (to: number, end: number) => {
    // Very long stretch without a pause → also cut at cue edges inside it.
    let segFrom = from;
    let segStart = groupStart;
    for (let i = from + 1; i <= to; i++) {
      if (words[i].cue !== words[i - 1].cue && words[i].cueStart - segStart > MAX_UNIT_SECONDS) {
        out.push(makeUnit(0, segStart, words[i].cueStart, words.slice(segFrom, i).map((w) => w.tok).join(' ')));
        segFrom = i;
        segStart = words[i].cueStart;
      }
    }
    out.push(makeUnit(0, segStart, Math.max(end, segStart + 0.05), words.slice(segFrom, to + 1).map((w) => w.tok).join(' ')));
  };
  for (const c of cuts) {
    emit(c.after, c.pause.startTime);
    from = c.after + 1;
    groupStart = c.pause.endTime;
  }
  const last = words[words.length - 1];
  const tail = pauses.find((p) => p.startTime >= (last.t0 + last.t1) / 2 && p.startTime <= last.cueEnd + 0.5);
  emit(words.length - 1, tail ? tail.startTime : last.cueEnd);

  return out.filter((u) => u.end > u.start).map((u, index) => ({ ...u, index }));
}

export function buildUnits(transcript: string): Unit[] {
  const raw = parseRaw(transcript)
    .map((s) => {
      const words = toWords(s.text.replace(/\[[^\]]*\]/g, ' '));
      let end = Number.isFinite(s.end) ? s.end : s.start;
      if (end <= s.start) end = s.start + Math.max(1, words.length * 0.35);
      return { ...s, end };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);

  // 1. Remove rolling-caption repeats.
  const deduped: RawSeg[] = [];
  let prevWords: string[] = [];
  for (const seg of raw) {
    const tags = seg.text.match(/\[[^\]]*\]/g)?.join(' ') ?? '';
    const spoken = seg.text.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
    const spokenTokens = spoken.split(' ').filter(Boolean);
    const words = toWords(spoken);
    const prev = deduped[deduped.length - 1];
    if (prev && words.length > 0) {
      const k = repeatedPrefix(prevWords, words);
      if (k === words.length) {
        prev.end = Math.max(prev.end, seg.end);
        continue;
      }
      if (k > 0) {
        // Drop the first k spoken tokens (word counts line up because toWords is 1:1 on tokens
        // for ordinary speech; fall back to the normalized words otherwise).
        const kept = spokenTokens.length === words.length
          ? spokenTokens.slice(k).join(' ')
          : words.slice(k).join(' ');
        deduped.push({ start: Math.max(seg.start, prev.start), end: seg.end, text: `${kept} ${tags}`.trim() });
        prevWords = words.slice(k);
        continue;
      }
    }
    if (!spoken && !tags) continue;
    deduped.push({ start: seg.start, end: seg.end, text: seg.text.trim() });
    prevWords = words;
  }

  // 2. Remove time overlap, then split long segments.
  for (let i = 0; i < deduped.length - 1; i++) {
    if (deduped[i].end > deduped[i + 1].start && deduped[i + 1].start > deduped[i].start) {
      deduped[i].end = deduped[i + 1].start;
    }
  }
  const pieces = deduped.filter((s) => s.end > s.start).flatMap(splitLong);

  // 3. Build units.
  return pieces.map((s, index) => makeUnit(index, s.start, s.end, s.text));
}
