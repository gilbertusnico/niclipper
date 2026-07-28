/**
 * Constants, weights, and thresholds for the Analysis Engine
 * All tunable parameters are centralized here.
 */

// ─── TextTiling ──────────────────────────────────────────────────────────
export const TEXT_TILING_WINDOW_SIZE = 3;   // sentences per side for similarity
export const TEXT_TILING_SIMILARITY_THRESHOLD = 0.35; // below this = topic boundary
export const MIN_BLOCK_DURATION = 8;         // seconds — smallest idea block
export const MAX_BLOCK_DURATION = 60;        // seconds — split if longer

// ─── Candidate Generation ────────────────────────────────────────────────
export const MIN_CLIP_DURATION = 30;         // seconds
export const MAX_CLIP_DURATION = 60;         // seconds
export const IDEAL_CLIP_DURATION_MIN = 30;
export const IDEAL_CLIP_DURATION_MAX = 60;
export const MAX_CANDIDATES = 20;            // max candidates before filtering

// ─── Retention Prediction ────────────────────────────────────────────────
export const HOOK_WEIGHT = 0.35;
export const MAINTAIN_WEIGHT = 0.30;
export const PAYOFF_WEIGHT = 0.35;

// ─── Hook Phase (0-3s) ───────────────────────────────────────────────────
export const HOOK_CURIOSITY_MAX = 40;
export const HOOK_EMOTIONAL_MAX = 30;
export const HOOK_SELF_CONTAINED_MAX = 30;

// ─── Maintain Phase (3-10s) ──────────────────────────────────────────────
export const MAINTAIN_PACING_MAX = 30;
export const MAINTAIN_ENGAGEMENT_MAX = 40;
export const MAINTAIN_NO_DEAD_AIR_MAX = 30;

// ─── Payoff Phase (10s-end) ──────────────────────────────────────────────
export const PAYOFF_ENDING_MAX = 40;
export const PAYOFF_VALUE_DELIVERY_MAX = 30;
export const PAYOFF_NO_TRAILING_MAX = 30;

// ─── Quality Filter ──────────────────────────────────────────────────────
export const QUALITY_INTRO_PENALTY = -100;
export const QUALITY_SPONSOR_PENALTY = -100;
export const QUALITY_CTA_PENALTY = -80;
export const QUALITY_OUTRO_PENALTY = -100;
export const QUALITY_DEAD_AIR_PENALTY = -50;
export const QUALITY_INCOMPLETE_PENALTY = -40;
export const QUALITY_TOO_SHORT_PENALTY = -60;
export const QUALITY_TOO_LONG_PENALTY = -30;
export const QUALITY_CONTEXT_DEPENDENT_PENALTY = -60;

// ─── Diversity Filter ────────────────────────────────────────────────────
export const DIVERSITY_NGRAM_SIZE = 3;
export const DIVERSITY_THRESHOLD = 0.40;     // Jaccard above this = too similar

// ─── Boundary Optimization ────────────────────────────────────────────────
export const BOUNDARY_MAX_SNAP = 3;          // seconds — max to snap boundary
export const PUNCHLINE_BUFFER = 1.5;         // seconds after punchline
export const MIN_PAUSE_BOUNDARY = 0.3;       // seconds — minimum pause to be a boundary

// ─── Audio Analysis ──────────────────────────────────────────────────────
export const AUDIO_FRAME_MS = 50;            // frame size in ms
export const SILENCE_RMS_THRESHOLD = 0.01;   // RMS below this = silence
export const SILENCE_MIN_DURATION = 0.3;     // seconds — min silence to register
export const ENERGY_BURST_THRESHOLD = 2.5;   // multiplier of avg RMS

// ─── Visual Analysis ─────────────────────────────────────────────────────
export const SCENE_CHANGE_THRESHOLD = 0.4;   // FFmpeg scene detection threshold

// ─── Indonesian Signal Words ─────────────────────────────────────────────
export const SIGNAL_WORDS: Record<string, string[]> = {
  intro: ['hari ini', 'kali ini', 'di video ini', 'jumpa lagi', 'balik lagi',
          'selamat datang', 'halo', 'hai', 'welcome', 'oke', 'baiklah', 'kita mulai'],
  setup: ['ceritanya', 'jadi gini', 'bermula', 'awalnya', 'pada suatu',
          'waktu itu', 'dulu', 'saat itu', 'ada seorang', 'konon'],
  conflict: ['tapi', 'namun', 'sayangnya', 'masalahnya', 'kendalanya',
             'disisi lain', 'malangnya', 'sialnya', 'gagal', 'kesulitan',
             'ternyata tidak', 'eh ternyata'],
  curiosity: ['tahukah', 'pernahkah', 'yang menarik', 'yang gak masuk akal',
              'percaya gak', 'gila gak', 'uniknya', 'fakta menarik',
              'rahasia', 'tips', 'cara mudah', 'triks'],
  twist: ['ternyata', 'tidak disangka', 'siapa sangka', 'gila', 'diluar dugaan',
          'tak terduga', 'wow', 'yang mengejutkan', 'nggak nyangka'],
  demonstration: ['pertama', 'kedua', 'ketiga', 'langkah', 'caranya',
                  'gini caranya', 'ikuti', 'seperti ini', 'contohnya',
                  'misalnya', 'sebagai contoh'],
  resolution: ['jadi', 'kesimpulannya', 'akhirnya', 'intinya', 'pokoknya',
               'sehingga', 'dengan begitu', 'maka', 'hasilnya', 'pointnya'],
  punchline: ['lucunya', 'ngakak', 'kocak', 'parah', 'gokil', 'wkwk',
              'yang bikin ngakak', 'punchline'],
  cta: ['subscribe', 'like', 'follow', 'share', 'comment', 'langganan',
        'dukung', 'support', 'join', 'gabung', 'bell', 'lonceng'],
  outro: ['sampai jumpa', 'see you', 'terima kasih', 'makasih', 'sekian',
          'daftar pustaka', 'referensi', 'byebye', 'assalamualaikum'],
};

// ─── Indonesian Stop Words ───────────────────────────────────────────────
export const STOP_WORDS = new Set([
  'dan', 'di', 'ke', 'dari', 'yang', 'ini', 'itu', 'dengan', 'untuk',
  'ada', 'dalam', 'akan', 'pada', 'adalah', 'bisa', 'tidak', 'sudah',
  'saya', 'kamu', 'dia', 'kami', 'kita', 'mereka', 'aku', 'kau',
  'juga', 'tapi', 'atau', 'kalau', 'karena', 'jika', 'saat', 'setelah',
  'sebelum', 'tentang', 'oleh', 'sebagai', 'lebih', 'sangat', 'semua',
  'hal', 'orang', 'bagaimana', 'mengapa', 'apa', 'siapa', 'kapan',
  'dimana', 'sedang', 'selalu', 'sering', 'hanya', 'banyak', 'beberapa',
  'seperti', 'antara', 'hingga', 'sampai', 'tanpa', 'masih', 'belum',
  'selain', 'sejak', 'sambil', 'meski', 'walaupun', 'kendati',
  'ya', 'oh', 'ah', 'eh', 'nah', 'wah', 'lho', 'kok', 'sih', 'deh',
  'dong', 'kan', 'pun', 'punya', 'mau', 'ingin', 'harus', 'perlu',
  'boleh', 'mungkin', 'kira', 'rasa', 'anggap', 'lihat', 'tahu',
]);

// ─── Final Ranking ───────────────────────────────────────────────────────
export const RANKING_RETENTION_WEIGHT = 0.55;
export const RANKING_QUALITY_WEIGHT = 0.20;
export const RANKING_DIVERSITY_WEIGHT = 0.10;
export const RANKING_DURATION_WEIGHT = 0.15;
export const RANKING_IDEAL_DURATION = 45;    // seconds — preferred clip length

// ─── Content Classifier ──────────────────────────────────────────────────
export const CONTENT_TYPE_SIGNALS: Record<string, {
  keywords: string[];
  pattern: RegExp[];
}> = {
  tutorial: {
    keywords: ['cara', 'langkah', 'tutorial', 'tips', 'panduan', 'how to'],
    pattern: [/^(pertama|kedua|ketiga|keempat|langkah|step)/i],
  },
  podcast: {
    keywords: ['podcast', 'obrolan', 'diskusi', 'ngobrol', 'bincang'],
    pattern: [/^gimana (menurut|pendapat)/i],
  },
  interview: {
    keywords: ['wawancara', 'interview', 'tanya jawab', 'sesi tanya'],
    pattern: [/^pertanyaan (dari|untuk)/i],
  },
  storytelling: {
    keywords: ['cerita', 'kisah', 'pengalaman', 'waktu itu', 'dulu'],
    pattern: [/^(ceritanya|bermula|awalnya|dulu)/i],
  },
  review: {
    keywords: ['review', 'ulasan', 'test', 'coba', 'testing', 'rekomendasi'],
    pattern: [/^(review|ulasan|unboxing|testing)\s/i],
  },
  news: {
    keywords: ['berita', 'kabar', 'terbaru', 'viral', 'update', 'breaking'],
    pattern: [/^(berita|kabar|update|breaking|viral)/i],
  },
  motivation: {
    keywords: ['motivasi', 'inspirasi', 'semangat', 'sukses', 'pantang'],
    pattern: [/^(ingat|jangan pernah|kuncinya|rahasia sukses)/i],
  },
  opinion: {
    keywords: ['menurutku', 'pendapat', 'opini', 'versiku', 'setuju'],
    pattern: [/^(menurut|aku rasa|saya pikir|bagi saya)/i],
  },
  comedy: {
    keywords: ['lucu', 'kocak', 'ngakak', 'gokil', 'parah', 'komedi'],
    pattern: [/^(canda|guyon|joke|punchline)/i],
  },
  q_and_a: {
    keywords: ['qna', 'q&a', 'tanya', 'pertanyaan', 'jawab'],
    pattern: [/^(ada pertanyaan|pertanyaan dari|qna)/i],
  },
};