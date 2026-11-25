/**
 * Deterministic synthetic transcripts for engine regression checks.
 *
 * Not real content: sentences are drawn (seeded) from pools that exercise the
 * engine's rules — stories, opinions, questions and short answers, laughter,
 * fillers, a sponsor read, intro/outro. The point is that the SAME input must
 * give the SAME clips before and after a refactor.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { WordTiming } from '../../server/subtitles.js';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

const PODCAST = {
  intro: ['Halo semuanya, selamat datang di podcast kali ini.', 'Bintang tamu kita hari ini udah dateng nih.', 'Apa kabar bro?', 'Baik baik, makasih udah ngundang.'],
  outro: ['Oke makasih banget udah dateng ya.', 'Jangan lupa subscribe dan nyalain lonceng.', 'Sampai jumpa di episode selanjutnya.'],
  sponsor: ['Jangan lupa pakai kode promo NICLIP buat diskon lima puluh persen.', 'Ini adalah produknya dari partner kita, link di deskripsi ya.', 'Download aplikasinya sekarang, ada cashback juga.'],
  lines: [
    'Waktu itu gue pernah ke Bandung naik motor sendirian.', 'Jadi ceritanya gue lagi kuliah semester tiga.',
    'Menurut gue sih orang terlalu cepat menilai.', 'Jujur aja, gue gak setuju sama cara itu.',
    'Kenapa sih orang takut gagal?', 'Gimana caranya lo bisa bertahan waktu itu?', 'Bukan.', 'Iya, bener.',
    'Ternyata dia udah nunggu dari jam tujuh pagi.', 'Gila, parah banget sih itu.', 'Hahaha kocak banget.',
    'Kuncinya itu konsisten, bukan motivasi.', 'Intinya jangan pernah berhenti belajar.', 'Pertama, lo harus tau tujuan lo.',
    'Gue habisin dua puluh juta dalam tiga bulan.', 'Eh, apa namanya, gue lupa.', 'Hmm, em, gimana ya.',
    'Tapi kan gak semua orang punya kesempatan yang sama.', 'Terus akhirnya dia nangis di depan kantor.',
    'Masalahnya banyak orang gak sadar soal itu.', 'Dari situ gue sadar bahwa uang bukan segalanya.',
    'Oke kalau soal bisnis, lo mulai dari mana?', 'Kalian tau gak, sembilan puluh persen startup gagal di tahun pertama.',
    'Dia bilang ke gue, lo harus berani rugi.', 'Makanya gue mulai jualan kopi di garasi rumah.',
    'Pas gue pertama kali buka toko, yang dateng cuma dua orang.', 'Serius? Beneran cuma dua?',
    'Mungkin dia suka protes karena capek.', 'Oke, oke.', 'Nah sekarang kita bahas soal keluarga.',
    'Orang tua gue dulu gak setuju gue berhenti kerja.', 'Sebenarnya yang paling penting itu kesehatan mental.',
    'Gue inget banget, malam itu hujan deras dan listrik mati.', 'Saya pikir semua orang bisa kalau mau.',
    'Apa sih bedanya investasi sama spekulasi?', 'Bedanya ada di waktu dan risiko yang lo ambil.',
    'Kopi di garasi itu sekarang udah jadi lima belas cabang.', 'Wkwkwk sumpah gue gak nyangka.',
    'Lo pernah gak ngerasa salah jurusan?', 'Pernah, sering banget malah.', 'Contohnya gue dulu ambil teknik sipil.',
  ],
};

export interface Fixture { name: string; transcript: string; words: WordTiming[]; audioPath?: string; title: string }

function build(seed: number, minutes: number, punctuate: boolean) {
  const r = rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const lines: string[] = [];
  lines.push(...PODCAST.intro);
  const total = minutes * 60;
  let t = 0;
  const cues: { start: number; end: number; text: string }[] = [];
  const push = (text: string) => {
    const n = text.split(/\s+/).length;
    const dur = n * (0.32 + r() * 0.12);
    const start = t;
    t += dur;
    cues.push({ start, end: t, text: punctuate ? text : text.replace(/[.,!?]/g, '').toLowerCase() });
    t += r() < 0.25 ? 0.6 + r() * 0.8 : 0.1 + r() * 0.2;
    if (r() < 0.04) cues.push({ start: t, end: t + 1, text: '[tertawa]' }), (t += 1.1);
  };
  PODCAST.intro.forEach(push);
  let sponsorDone = false;
  while (t < total - 30) {
    if (!sponsorDone && t > total * 0.45) { PODCAST.sponsor.forEach(push); sponsorDone = true; continue; }
    push(pick(PODCAST.lines));
  }
  PODCAST.outro.forEach(push);
  return cues;
}

function toTranscript(cues: { start: number; end: number; text: string }[]): string {
  return cues.map((c) => `[TIMESTAMP: ${c.start.toFixed(2)} -> ${c.end.toFixed(2)}]\n${c.text}`).join('\n\n');
}

function toWordsFromCues(cues: { start: number; end: number; text: string }[]): WordTiming[] {
  const out: WordTiming[] = [];
  for (const c of cues) {
    if (c.text.startsWith('[')) continue;
    const ws = c.text.split(/\s+/).filter(Boolean);
    const step = (c.end - c.start) / ws.length;
    ws.forEach((w, i) => out.push({ start: c.start + i * step, end: c.start + (i + 1) * step, text: w }));
  }
  return out;
}

/** 8 kHz mono 16-bit WAV: noise-like speech during cues (varying loudness), silence between. */
function writeWav(file: string, cues: { start: number; end: number }[], seed: number) {
  const r = rng(seed);
  const sr = 8000;
  const dur = Math.ceil(cues[cues.length - 1].end + 1);
  const data = Buffer.alloc(dur * sr * 2);
  for (const c of cues) {
    const amp = 2000 + r() * 9000;
    for (let i = Math.floor(c.start * sr); i < Math.min(dur * sr, Math.floor(c.end * sr)); i++) {
      data.writeInt16LE(Math.round((r() * 2 - 1) * amp * (0.6 + 0.4 * Math.sin(i / 400))), i * 2);
    }
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

export function podcastFixtures(tmpDir: string): Fixture[] {
  fs.mkdirSync(tmpDir, { recursive: true });
  const title = 'Dari Garasi ke 15 Cabang: Cerita Bisnis Kopi | Podcast';
  const a = build(11, 22, true);
  const b = build(23, 18, false);
  const c = build(37, 30, true);
  const wav = path.join(tmpDir, 'podcast_c.wav');
  writeWav(wav, c, 37);
  return [
    { name: 'podcast-punctuated-cues', transcript: toTranscript(a), words: [], title },
    { name: 'podcast-autocaption-words', transcript: toTranscript(b), words: toWordsFromCues(b), title },
    { name: 'podcast-punctuated-audio', transcript: toTranscript(c), words: [], audioPath: wav, title },
  ];
}
