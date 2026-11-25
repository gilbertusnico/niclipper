/**
 * Content profiles — the same engine, tuned per kind of video.
 *
 *  - podcast: conversation between 2+ people (the original tuning).
 *  - sermon:  Christian sermon (khotbah), one preacher + congregation.
 *
 * A profile only ADDS words to the base lexicon and switches on a few
 * sermon-only rules (prayer / offering / announcements, call-and-response
 * "Amin?", scripture references). The podcast profile is exactly the base
 * lexicon with every extra rule off, so podcast results never change because
 * of the sermon tuning.
 */

import * as L from './lexicon.js';

export type ContentProfileId = 'podcast' | 'sermon';
export const CONTENT_PROFILE_IDS: readonly ContentProfileId[] = ['podcast', 'sermon'];

export function parseProfileId(v: unknown): ContentProfileId {
  return v === 'sermon' ? 'sermon' : 'podcast';
}

export interface Lexicon {
  STOP_WORDS: ReadonlySet<string>;
  STORY_OPENERS: readonly string[];
  STORY_MARKERS: readonly string[];
  OPINION_MARKERS: readonly string[];
  INSIGHT_MARKERS: readonly string[];
  REACTION_MARKERS: readonly string[];
  QUESTION_MARKERS: readonly string[];
  CONCLUSION_MARKERS: readonly string[];
  INTRO_MARKERS: readonly string[];
  OUTRO_MARKERS: readonly string[];
  CTA_MARKERS: readonly string[];
  SPONSOR_MARKERS: readonly string[];
  GENERIC_WORDS: ReadonlySet<string>;
  CONTEXT_DEPENDENT_STARTS: readonly string[];
  TOPIC_TRANSITIONS: readonly string[];
  SENTENCE_STARTERS: readonly string[];
  REPLY_STARTS: ReadonlySet<string>;
  SHORT_FILLERS: ReadonlySet<string>;
  /** Extra first-line phrases that make a natural clip opener. */
  EXTRA_OPENERS: readonly string[];
}

export interface ContentProfile {
  id: ContentProfileId;
  lex: Lexicon;
  /** Not clip material anywhere in the video: prayer, offering, announcements, worship leading. */
  liturgyMarkers: readonly string[];
  /** Housekeeping inside the sermon ("buka Alkitab", "katakan ke sebelah"): mild penalty. */
  setupMarkers: readonly string[];
  /** Words of a call-and-response line ("Amin?", "Setuju?") — filler, not a real question. */
  callResponse: ReadonlySet<string>;
  /** Scripture reference ("Yohanes 3:16", "ayat 5") → insight. */
  scriptureRe: RegExp | null;
  /** Stems never used as a clip's keywords (all clips share them: "tuhan", "iman"). */
  keywordStop: ReadonlySet<string>;
  /** Hashtags added to every clip of this profile. */
  extraHashtags: readonly string[];
}

const BASE: Lexicon = {
  STOP_WORDS: L.STOP_WORDS,
  STORY_OPENERS: L.STORY_OPENERS,
  STORY_MARKERS: L.STORY_MARKERS,
  OPINION_MARKERS: L.OPINION_MARKERS,
  INSIGHT_MARKERS: L.INSIGHT_MARKERS,
  REACTION_MARKERS: L.REACTION_MARKERS,
  QUESTION_MARKERS: L.QUESTION_MARKERS,
  CONCLUSION_MARKERS: L.CONCLUSION_MARKERS,
  INTRO_MARKERS: L.INTRO_MARKERS,
  OUTRO_MARKERS: L.OUTRO_MARKERS,
  CTA_MARKERS: L.CTA_MARKERS,
  SPONSOR_MARKERS: L.SPONSOR_MARKERS,
  GENERIC_WORDS: L.GENERIC_WORDS,
  CONTEXT_DEPENDENT_STARTS: L.CONTEXT_DEPENDENT_STARTS,
  TOPIC_TRANSITIONS: L.TOPIC_TRANSITIONS,
  SENTENCE_STARTERS: L.SENTENCE_STARTERS,
  REPLY_STARTS: L.REPLY_STARTS,
  SHORT_FILLERS: L.SHORT_FILLERS,
  EXTRA_OPENERS: ['nah kalau', 'nah kalo', 'kalau kalian', 'kalo kalian', 'ada tiga', 'ada dua', 'ada lima', 'caranya'],
};

export const PODCAST_PROFILE: ContentProfile = {
  id: 'podcast',
  lex: BASE,
  liturgyMarkers: [],
  setupMarkers: [],
  callResponse: new Set(),
  scriptureRe: null,
  keywordStop: new Set(),
  extraHashtags: [],
};

const list = (base: readonly string[], extra: string[]) => [...base, ...extra];
const set = (base: ReadonlySet<string>, extra: string[]) => new Set([...base, ...extra]);

/** Bible books as they are spoken in Indonesian (one word each). */
const BIBLE_BOOKS = [
  'kejadian', 'keluaran', 'imamat', 'bilangan', 'ulangan', 'yosua', 'hakim-hakim', 'rut', 'samuel',
  'raja-raja', 'tawarikh', 'ezra', 'nehemia', 'ester', 'ayub', 'mazmur', 'amsal', 'pengkhotbah',
  'kidung', 'yesaya', 'yeremia', 'ratapan', 'yehezkiel', 'daniel', 'hosea', 'yoel', 'amos', 'obaja',
  'yunus', 'mikha', 'nahum', 'habakuk', 'zefanya', 'hagai', 'zakharia', 'maleakhi', 'matius',
  'markus', 'lukas', 'yohanes', 'kisah', 'roma', 'korintus', 'galatia', 'efesus', 'filipi', 'kolose',
  'tesalonika', 'timotius', 'titus', 'filemon', 'ibrani', 'yakobus', 'petrus', 'yudas', 'wahyu',
];

const SERMON_LEX: Lexicon = {
  // Address forms run through every sentence of a sermon and carry no topic.
  STOP_WORDS: set(BASE.STOP_WORDS, [
    'saudara', 'saudara-saudara', 'saudara-saudari', 'bapak', 'ibu', 'bapak-bapak', 'ibu-ibu',
    'jemaat', 'amin', 'haleluya', 'teman-teman', 'bahwa',
  ]),
  STORY_OPENERS: list(BASE.STORY_OPENERS, [
    'ada seorang', 'ada sebuah cerita', 'ada satu cerita', 'ada sebuah kisah', 'ada satu kisah',
    'saya ingat', 'saya teringat', 'suatu kali', 'beberapa tahun lalu', 'beberapa tahun yang lalu',
    'waktu saya', 'saya mau cerita', 'saya punya teman', 'saya punya seorang', 'kisahnya',
  ]),
  STORY_MARKERS: list(BASE.STORY_MARKERS, [
    'kisah', 'kesaksian', 'bersaksi', 'suatu kali', 'saya ingat', 'saya teringat', 'waktu saya',
    'ada seorang', 'beberapa tahun lalu', 'beberapa tahun yang lalu',
  ]),
  OPINION_MARKERS: list(BASE.OPINION_MARKERS, [
    'saya mau katakan', 'saya katakan', 'saya mau tegaskan', 'dengar baik baik', 'dengar baik-baik',
    'dengarkan baik baik', 'dengarkan baik-baik', 'dengarkan ini', 'ingat ini', 'ingat baik baik',
    'ingat baik-baik', 'percayalah', 'saya percaya', 'tidak ada yang mustahil', 'yang tuhan mau',
    'tuhan tidak pernah', 'tuhan tidak mau', 'banyak orang kristen', 'banyak orang percaya',
    'bukan soal', 'masalahnya bukan', 'jangan salah', 'yang terpenting', 'banyak anak tuhan',
  ]),
  INSIGHT_MARKERS: list(BASE.INSIGHT_MARKERS, [
    'firman tuhan', 'alkitab berkata', 'alkitab bilang', 'alkitab mengatakan', 'alkitab katakan',
    'ada tertulis', 'tertulis', 'yesus berkata', 'tuhan yesus berkata', 'yesus bilang', 'paulus berkata',
    'paulus bilang', 'rasul paulus', 'prinsipnya', 'prinsip', 'kebenarannya', 'bahasa aslinya',
    'kata aslinya', 'bahasa yunani', 'bahasa ibrani', 'dalam bahasa yunani', 'dalam bahasa ibrani',
  ]),
  REACTION_MARKERS: list(BASE.REACTION_MARKERS, ['haleluya', 'puji tuhan']),
  QUESTION_MARKERS: list(BASE.QUESTION_MARKERS, [
    'pernahkah saudara', 'saudara tahu', 'tahukah saudara', 'bapak ibu tahu', 'apa yang terjadi',
    'mengapa tuhan', 'kenapa tuhan', 'pernahkah kita',
  ]),
  CONCLUSION_MARKERS: list(BASE.CONCLUSION_MARKERS, [
    'jadi saudara', 'jadi bapak ibu', 'itulah sebabnya', 'itu sebabnya', 'karena itu saudara',
    'mulai hari ini', 'hari ini juga', 'biarlah', 'ingatlah', 'mari kita',
  ]),
  INTRO_MARKERS: list(BASE.INTRO_MARKERS, [
    'shalom', 'syalom', 'selamat hari minggu', 'selamat beribadah', 'puji tuhan kita bisa',
    'senang sekali bisa', 'apa kabar jemaat', 'silakan duduk', 'selamat datang di ibadah',
  ]),
  OUTRO_MARKERS: list(BASE.OUTRO_MARKERS, [
    'tuhan yesus memberkati', 'tuhan memberkati', 'god bless', 'gbu', 'sampai bertemu minggu depan',
    'sampai jumpa minggu depan', 'selamat beraktivitas', 'selamat hari minggu',
  ]),
  CTA_MARKERS: BASE.CTA_MARKERS,
  SPONSOR_MARKERS: BASE.SPONSOR_MARKERS,
  GENERIC_WORDS: set(BASE.GENERIC_WORDS, [
    'tuhan', 'yesus', 'allah', 'bapa', 'roh', 'kudus', 'firman', 'alkitab', 'iman', 'percaya', 'doa',
    'berdoa', 'gereja', 'jemaat', 'saudara', 'bapak', 'ibu', 'hidup', 'kristus', 'kristen', 'ayat',
    'pasal', 'amin', 'haleluya', 'berkat', 'berkati', 'kasihi', 'ibadah', 'sorga', 'surga', 'anak',
    'dunia', 'manusia', 'khotbah', 'renungan',
  ]),
  CONTEXT_DEPENDENT_STARTS: list(BASE.CONTEXT_DEPENDENT_STARTS, [
    'poin kedua', 'poin yang kedua', 'poin ketiga', 'poin yang ketiga', 'poin terakhir',
    'yang terakhir', 'seperti yang saya katakan', 'tadi saya', 'kembali ke ayat',
    'di ayat berikutnya', 'ayat berikutnya', 'lanjut ke ayat',
  ]),
  TOPIC_TRANSITIONS: list(BASE.TOPIC_TRANSITIONS, [
    'poin berikutnya', 'poin selanjutnya', 'masuk ke poin', 'kita lanjut', 'mari kita lihat',
    'kita lihat ayat', 'sekarang kita',
  ]),
  SENTENCE_STARTERS: list(BASE.SENTENCE_STARTERS, [
    'saudara', 'bapak', 'ibu', 'tuhan', 'alkitab', 'firman', 'yesus', 'mari', 'dengar', 'dengarkan',
  ]),
  REPLY_STARTS: set(BASE.REPLY_STARTS, ['amin']),
  SHORT_FILLERS: set(BASE.SHORT_FILLERS, ['amin', 'haleluya', 'setuju']),
  EXTRA_OPENERS: list(BASE.EXTRA_OPENERS, [
    'bayangkan', 'coba bayangkan', 'saudara bayangkan', 'saya mau katakan', 'dengar baik baik',
    'dengarkan baik baik', 'ada tiga hal', 'ada dua hal', 'alkitab berkata', 'firman tuhan berkata',
  ]),
};

export const SERMON_PROFILE: ContentProfile = {
  id: 'sermon',
  lex: SERMON_LEX,
  liturgyMarkers: [
    // prayer
    'mari kita berdoa', 'kita berdoa ya', 'mari berdoa', 'tundukkan kepala', 'menundukkan kepala',
    'pejamkan mata', 'memejamkan mata', 'dalam nama tuhan yesus', 'dalam nama yesus',
    'bapa kami yang di sorga', 'bapa kami yang di surga', 'kami berdoa', 'kami bersyukur',
    'kami mengucap syukur', 'ya bapa', 'bapa yang baik', 'terima kasih bapa', 'kami serahkan',
    'kami mohon',
    // offering / announcements
    'kantong persembahan', 'waktu persembahan', 'saat persembahan', 'kolekte', 'warta jemaat',
    'pengumuman', 'nomor rekening', 'rekening gereja', 'qris', 'ibadah minggu depan', 'jadwal ibadah',
    'pendaftaran', 'formulir',
    // worship leading
    'mari kita memuji', 'mari kita menyembah', 'mari berdiri', 'silakan berdiri', 'kita nyanyikan',
    'mari bernyanyi', 'mari kita bernyanyi',
  ],
  setupMarkers: [
    'silakan duduk', 'mari kita buka', 'silakan buka', 'buka alkitab', 'kita baca bersama',
    'saya bacakan', 'bacaan kita', 'angkat tangan', 'beri salam', 'salam ke sebelah',
    'orang di sebelah', 'bilang ke sebelah', 'katakan ke sebelah',
  ],
  callResponse: new Set([
    'amin', 'haleluya', 'setuju', 'betul', 'benar', 'bener', 'ya', 'iya', 'kan', 'bukan', 'oke', 'ok',
    'yes', 'puji', 'tuhan', 'ayo', 'siap',
  ]),
  scriptureRe: new RegExp(` (?:${BIBLE_BOOKS.join('|')}|ayat|pasal) \\d`),
  keywordStop: SERMON_LEX.GENERIC_WORDS,
  extraHashtags: ['#khotbah'],
};

export function getProfile(id: ContentProfileId = 'podcast'): ContentProfile {
  return id === 'sermon' ? SERMON_PROFILE : PODCAST_PROFILE;
}
