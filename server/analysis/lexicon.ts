/**
 * Lexicon — Indonesian (casual + formal) and common English markers used by
 * the moment-detection engine. All matching is done on lowercased,
 * punctuation-stripped text padded with spaces, so every entry is matched as
 * whole words/phrases (" tapi " never matches inside "tapis").
 *
 * Keep entries lowercase and without punctuation.
 */

/** Words that carry no topic meaning (excluded from salience / topic vectors). */
export const STOP_WORDS = new Set([
  'dan', 'di', 'ke', 'dari', 'yang', 'ini', 'itu', 'dengan', 'untuk', 'ada', 'dalam',
  'akan', 'pada', 'adalah', 'bisa', 'tidak', 'nggak', 'gak', 'ga', 'enggak', 'ngga',
  'sudah', 'udah', 'udh', 'saya', 'kamu', 'dia', 'kami', 'kita', 'mereka', 'aku', 'gue',
  'gw', 'lu', 'lo', 'elo', 'loe', 'kau', 'anda', 'juga', 'tapi', 'atau', 'kalau', 'kalo',
  'karena', 'karna', 'soalnya', 'jika', 'saat', 'pas', 'setelah', 'sebelum', 'tentang',
  'oleh', 'sebagai', 'lebih', 'sangat', 'banget', 'semua', 'hal', 'orang', 'apa', 'siapa',
  'kapan', 'mana', 'dimana', 'gimana', 'bagaimana', 'kenapa', 'mengapa', 'sedang', 'lagi',
  'selalu', 'sering', 'hanya', 'cuma', 'cuman', 'banyak', 'beberapa', 'seperti', 'kayak',
  'kaya', 'kek', 'antara', 'hingga', 'sampai', 'sampe', 'tanpa', 'masih', 'belum', 'selain',
  'sejak', 'sambil', 'meski', 'walaupun', 'ya', 'yah', 'iya', 'oh', 'ah', 'eh', 'nah', 'wah',
  'lho', 'loh', 'kok', 'sih', 'deh', 'dong', 'kan', 'pun', 'punya', 'mau', 'ingin', 'pengen',
  'harus', 'perlu', 'boleh', 'mungkin', 'jadi', 'terus', 'trus', 'lalu', 'kemudian', 'gitu',
  'begitu', 'gini', 'begini', 'tuh', 'nih', 'aja', 'saja', 'emang', 'memang', 'bener',
  'benar', 'tau', 'tahu', 'oke', 'ok', 'okay', 'yaudah', 'udah', 'sama', 'buat', 'bikin',
  'jadinya', 'tadi', 'nanti', 'sekarang', 'waktu', 'kayaknya', 'mah', 'kak', 'bang', 'mas',
  'mbak', 'bro', 'guys', 'semuanya', 'temen', 'teman', 'the', 'and', 'to', 'of', 'a', 'is',
  'it', 'that', 'you', 'i', 'in', 'so', 'like', 'just', 'yeah', 'em', 'emm', 'hmm', 'eee',
  'ee', 'apa', 'namanya', 'gimana', 'dia', 'nya', 'si', 'para', 'lah', 'pa', 'ni', 'tu',
]);

/** Phrases that OPEN a story (good first words of a clip). */
export const STORY_OPENERS = [
  'waktu itu', 'dulu', 'dulu tuh', 'pas gue', 'pas aku', 'pas saya', 'gue pernah', 'aku pernah',
  'saya pernah', 'ceritanya', 'jadi ceritanya', 'suatu hari', 'tahun lalu', 'pertama kali',
  'inget banget', 'ingat banget', 'one time', 'i remember',
];

/** Story markers anywhere in a story. */
export const STORY_MARKERS = [
  'waktu itu', 'dulu', 'dulu tuh', 'pas gue', 'pas aku', 'pas saya', 'pernah', 'gue pernah',
  'aku pernah', 'saya pernah', 'ceritanya', 'cerita', 'pengalaman', 'tiba tiba', 'tiba-tiba',
  'ternyata', 'akhirnya', 'eh ternyata', 'suatu hari', 'kejadian', 'tahun lalu', 'minggu lalu',
  'kemarin', 'pertama kali', 'one time', 'i remember', 'inget banget', 'ingat banget',
];

/** A clear opinion, claim, or hot take. */
export const OPINION_MARKERS = [
  'menurut gue', 'menurut aku', 'menurut saya', 'menurutku', 'gue rasa',
  'aku rasa', 'saya rasa', 'gue pikir', 'aku pikir', 'saya pikir', 'jujur', 'jujur aja',
  'sebenernya', 'sebenarnya', 'faktanya', 'yang paling penting', 'paling penting',
  'kuncinya', 'masalahnya', 'problemnya', 'yang salah', 'salah besar', 'gak ada yang',
  'nggak ada yang', 'semua orang', 'kebanyakan orang', 'banyak orang', 'harusnya',
  'seharusnya', 'jangan pernah', 'gue gak setuju', 'aku gak setuju', 'unpopular opinion',
  'gue mau bilang', 'aku mau bilang', 'saya mau bilang', 'gue berani bilang', 'mungkin bikin orang',
  'banyak yang gak tau', 'banyak yang nggak tahu', 'gak banyak yang tau', 'jarang orang tau',
  'yang orang gak sadar', 'gue yakin', 'aku yakin', 'saya yakin', 'gak cukup', 'nggak cukup',
  'i think', 'the truth is', 'honestly',
];

/** Teaching / insight / explanation. */
export const INSIGHT_MARKERS = [
  'caranya', 'cara', 'tips', 'tipsnya', 'trik', 'rahasia', 'rahasianya', 'alasannya',
  'alasan kenapa', 'makanya', 'intinya', 'kesimpulannya', 'pelajaran', 'pelajarannya',
  'kesalahan', 'kesalahannya', 'yang harus', 'yang perlu', 'langkah', 'pertama', 'kedua',
  'ketiga', 'strategi', 'strateginya', 'formula', 'kunci', 'karena itu', 'artinya',
  'contohnya', 'misalnya', 'bedanya', 'perbedaannya', 'gimana caranya', 'the key',
  'the reason', 'lesson',
];

/** Emotional reactions, laughter, surprise. */
export const REACTION_MARKERS = [
  'gila', 'gilak', 'anjir', 'anjay', 'anjrit', 'astaga', 'astagfirullah', 'ya ampun',
  'ya allah', 'parah', 'parah banget', 'kaget', 'syok', 'shock', 'nangis', 'takut', 'serem',
  'ngeri', 'sedih', 'kesel', 'marah', 'malu', 'bangga', 'seneng banget', 'senang sekali',
  'wkwk', 'wkwkwk', 'haha', 'hahaha', 'hehe', 'ngakak', 'lucu', 'kocak', 'gokil', 'sumpah',
  'serius', 'beneran', 'demi apa', 'gak nyangka', 'nggak nyangka', 'tidak menyangka',
  'luar biasa', 'mantap', 'keren banget', 'wow', 'amazing', 'crazy', 'insane',
];

/** Bracketed audio-event tags from captions. */
export const LAUGHTER_TAGS = ['tertawa', 'ketawa', 'laughter', 'laughs', 'tepuk tangan', 'applause'];
export const NON_SPEECH_TAGS = ['musik', 'music', 'lagu', 'suara', 'noise', 'tidak jelas', 'inaudible'];

/** Question openers (curiosity hooks). */
export const QUESTION_MARKERS = [
  'kenapa', 'mengapa', 'gimana', 'bagaimana', 'apa sih', 'apakah', 'kok bisa', 'emang bisa',
  'kalian tau', 'kalian tahu', 'tau gak', 'tahu gak', 'tau nggak', 'tahu nggak',
  'pernah gak', 'pernah nggak', 'pernahkah', 'tahukah', 'siapa yang', 'berapa', 'what',
  'why', 'how',
];

/** Conclusion / payoff phrases (good near the end of a clip). */
export const CONCLUSION_MARKERS = [
  'jadi intinya', 'intinya', 'kesimpulannya', 'makanya', 'akhirnya', 'pada akhirnya',
  'itu sih', 'gitu sih', 'that is it', 'itulah', 'karena itu', 'jadi ya', 'pelajarannya',
  'yang penting', 'pokoknya', 'udah gitu aja', 'dari situ', 'dari situ gue', 'gue sadar',
  'aku sadar', 'saya sadar', 'sadar bahwa', 'yang membedakan', 'bedanya', 'kuncinya', 'jadi berhenti',
  'jadi mulai', 'jadi jangan', 'mulai sekarang', 'moral of the story', 'the point is',
];

/** Intro / greeting / channel housekeeping. */
export const INTRO_MARKERS = [
  'halo', 'hallo', 'hai', 'hi guys', 'halo guys', 'hai guys', 'halo semua', 'halo semuanya',
  'selamat datang', 'welcome', 'balik lagi', 'kembali lagi', 'jumpa lagi', 'ketemu lagi',
  'assalamualaikum', 'selamat pagi', 'selamat siang', 'selamat sore', 'selamat malam',
  'di episode', 'episode kali ini', 'di video kali ini', 'di video ini', 'podcast kali ini',
  'bintang tamu', 'tamu kita', 'kenalin', 'perkenalkan', 'apa kabar',
];

/** Outro / sign-off. */
export const OUTRO_MARKERS = [
  'sampai jumpa', 'sampai ketemu', 'see you', 'terima kasih sudah', 'makasih udah',
  'terima kasih udah', 'thanks for watching', 'sekian', 'segitu dulu', 'byebye', 'bye bye',
  'wassalamualaikum', 'episode selanjutnya', 'video selanjutnya', 'next episode',
];

/** Calls to action. */
export const CTA_MARKERS = [
  'subscribe', 'like dan', 'jangan lupa like', 'jangan lupa subscribe', 'nyalain lonceng',
  'notifikasi', 'share video', 'komen di bawah', 'comment di bawah', 'tulis di kolom',
  'kolom komentar', 'link di deskripsi', 'link di bio', 'follow instagram', 'follow ig',
  'cek deskripsi', 'klik link',
];

/** Sponsor / ad reads. */
export const SPONSOR_MARKERS = [
  'sponsor', 'disponsori', 'didukung oleh', 'brought to you', 'kode promo', 'kode voucher',
  'promo code', 'pakai kode', 'gunakan kode', 'download aplikasinya', 'download sekarang',
  'diskon', 'cashback', 'partner kita', 'kerja sama dengan', 'paid promote',
];

/** Fillers (high density = rambling). */
export const FILLER_WORDS = new Set([
  'eh', 'em', 'emm', 'emmm', 'hmm', 'hm', 'ee', 'eee', 'eeh', 'uh', 'uhm', 'um', 'ehm', 'anu',
]);
export const FILLER_PHRASES = ['apa namanya', 'apa ya', 'gimana ya', 'kayak gitu kayak', 'ya kan ya'];

/** Phrases at the start of a clip that only make sense with earlier context. */
export const CONTEXT_DEPENDENT_STARTS = [
  'tadi', 'yang tadi', 'kayak tadi', 'seperti tadi', 'yang barusan', 'barusan', 'balik lagi ke',
  'kembali ke', 'seperti yang', 'kayak yang gue bilang', 'kayak yang aku bilang', 'nah itu',
  'itu tuh', 'yang itu', 'yang kayak gitu', 'sama kayak', 'nah makanya', 'makanya',
  'sebelumnya', 'lanjut', 'lanjutin',
  // mid-story / mid-list continuations
  'ternyata', 'eh ternyata', 'akhirnya', 'terus akhirnya', 'abis itu', 'habis itu', 'setelah itu',
  'kedua', 'ketiga', 'keempat', 'kelima', 'yang kedua', 'yang ketiga', 'terakhir',
];

/** Words that are fine (even good) as the first word of a clip. */
export const SENTENCE_STARTERS = [
  'jadi', 'nah', 'oke', 'pertama', 'kedua', 'ketiga', 'menurut', 'intinya', 'sebenernya',
  'sebenarnya', 'jujur', 'kenapa', 'gimana', 'bagaimana', 'apa', 'waktu', 'dulu', 'pas',
  'gue', 'aku', 'saya', 'kita', 'kalian', 'banyak', 'semua', 'kalau', 'kalo', 'ternyata',
  'yang', 'ada', 'pernah', 'tau', 'tahu', 'coba', 'bayangin', 'bayangkan', 'faktanya',
  'masalahnya', 'kuncinya', 'rahasianya', 'so', 'the', 'i', 'you', 'what', 'why', 'how',
];

/** Words a clip must not start with (mid-sentence continuation). */
export const BAD_START_WORDS = new Set([
  'dan', 'atau', 'sama', 'dengan', 'terus', 'trus', 'lalu', 'tapi', 'tetapi', 'namun',
  'karena', 'karna', 'soalnya', 'untuk', 'buat', 'yaitu', 'yakni', 'sehingga', 'makanya',
  'jadinya', 'kayak', 'seperti', 'nya', 'pun', 'lah', 'kan', 'sih', 'deh', 'dong', 'tuh',
  'nih', 'juga', 'aja', 'saja', 'lagi', 'udah', 'eh', 'em', 'ee', 'hmm', 'and', 'but', 'or',
  'because',
]);

/** Words a clip must not end on (sentence obviously continues). */
export const BAD_END_WORDS = new Set([
  'dan', 'atau', 'yang', 'di', 'ke', 'dari', 'untuk', 'buat', 'karena', 'karna', 'soalnya',
  'kalau', 'kalo', 'tapi', 'tetapi', 'terus', 'trus', 'lalu', 'sama', 'dengan', 'adalah',
  'akan', 'bisa', 'mau', 'jadi', 'itu', 'ini', 'si', 'para', 'pas', 'saat', 'waktu',
  'kayak', 'seperti', 'yaitu', 'bahwa', 'sih', 'tuh', 'gue', 'aku', 'saya', 'kita', 'the',
  'a', 'and', 'to', 'of', 'but', 'because', 'eh', 'em', 'ee', 'apa',
]);

/** Spelled-out numbers / quantities (specificity). */
export const NUMBER_WORDS = new Set([
  'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh',
  'sebelas', 'belas', 'puluh', 'seratus', 'ratus', 'seribu', 'ribu', 'juta', 'miliar',
  'milyar', 'triliun',
]);

/** Units that make a nearby number concrete ("50 juta", "3 tahun", "20 persen"). */
export const QUANTITY_UNITS = new Set([
  'persen', 'rupiah', 'rp', 'dolar', 'dollar', 'juta', 'jt', 'miliar', 'milyar', 'triliun',
  'ribu', 'rb', 'tahun', 'bulan', 'minggu', 'hari', 'jam', 'menit', 'kali', 'kilo', 'kg',
  'km', 'orang', 'followers', 'subscriber', 'subscribers', 'views', 'k',
]);
