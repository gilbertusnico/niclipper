/**
 * Sermon profile smoke test (synthetic, not a real sermon).
 *   npx tsx scripts/regression/sermon-smoke.ts
 * Checks the sermon-only rules do what they claim: no clip overlaps the
 * prayer / offering / announcement blocks, and "Amin?" cues don't stop a
 * clip from starting on the line after them.
 */
import { analyzeTranscript } from '../../server/analysis/engine.js';

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const r = rng(7);

const BLOCKS: { kind: 'liturgy' | 'talk'; lines: string[] }[] = [
  { kind: 'liturgy', lines: ['Shalom, selamat hari minggu bapak ibu.', 'Silakan duduk.', 'Mari kita berdoa.', 'Bapa kami yang di sorga, kami bersyukur untuk hari ini.', 'Dalam nama Tuhan Yesus kami berdoa. Amin.'] },
  { kind: 'talk', lines: ['Mari kita buka Alkitab kita di Yohanes 15 ayat 5.', 'Akulah pokok anggur dan kamulah ranting-rantingnya.', 'Saudara, ranting tidak bisa berbuah kalau lepas dari pokoknya.'] },
  { kind: 'talk', lines: ['Saya ingat waktu saya kuliah di Yogyakarta, saya hampir berhenti ikut Tuhan.', 'Amin?', 'Saya kerja tiga pekerjaan sekaligus dan tidur cuma empat jam.', 'Setiap malam saya bilang, Tuhan nanti saja saya berdoa.', 'Sampai suatu malam ibu kos saya mengetuk pintu dan membawa sepiring nasi.', 'Dia bilang, nak, kamu kelihatan lelah sekali.', 'Saya menangis malam itu, saudara.', 'Haleluya!', 'Dari situ saya sadar bahwa Tuhan tidak pernah meninggalkan saya.'] },
  { kind: 'talk', lines: ['Dengar baik-baik.', 'Banyak orang Kristen sibuk melayani tapi lupa tinggal di dalam Dia.', 'Setuju?', 'Masalahnya bukan kurang aktivitas, masalahnya kita lepas dari pokok anggur.', 'Dalam bahasa Yunani, kata tinggal itu menein, artinya menetap, bukan mampir.', 'Jadi saudara, mulai hari ini jangan cuma mampir ke hadirat Tuhan.', 'Amin?'] },
  { kind: 'liturgy', lines: ['Bapak ibu, sebelum kita lanjut, waktu persembahan.', 'Kantong persembahan akan diedarkan.', 'Bisa juga lewat QRIS atau nomor rekening gereja di layar.', 'Pengumuman, ibadah minggu depan dimulai jam delapan.', 'Pendaftaran retret pemuda bisa lewat formulir di lobi.'] },
  { kind: 'talk', lines: ['Pernahkah saudara merasa doa saudara tidak dijawab?', 'Saya pernah.', 'Ada seorang jemaat datang ke saya, anaknya sakit selama dua tahun.', 'Dia berdoa setiap hari, puasa setiap minggu.', 'Lalu dia tanya ke saya, pak, kenapa Tuhan diam?', 'Saya tidak punya jawaban yang pintar.', 'Saya cuma bilang, Tuhan yang diam bukan Tuhan yang pergi.', 'Tiga bulan kemudian anaknya sembuh, dan dia bersaksi di depan gereja ini.', 'Puji Tuhan!'] },
  { kind: 'talk', lines: ['Ada tiga hal yang membuat ranting tetap berbuah.', 'Pertama, tetap melekat lewat firman setiap hari.', 'Kedua, mau dibersihkan walaupun sakit.', 'Ketiga, sabar menunggu musimnya.', 'Itulah sebabnya buah tidak muncul dalam semalam.'] },
  { kind: 'liturgy', lines: ['Mari kita tundukkan kepala dan pejamkan mata.', 'Ya Bapa, kami serahkan hidup kami kepada-Mu.', 'Kami mohon ajar kami tinggal di dalam Engkau.', 'Dalam nama Tuhan Yesus kami berdoa. Amin.', 'Tuhan Yesus memberkati, sampai bertemu minggu depan.'] },
];

let t = 0;
const cues: string[] = [];
const ranges: { kind: string; start: number; end: number }[] = [];
for (let rep = 0; rep < 3; rep++) {
  for (const b of BLOCKS) {
    if (rep > 0 && b === BLOCKS[0]) continue;
    if (rep < 2 && b === BLOCKS[BLOCKS.length - 1]) continue;
    const start = t;
    for (const line of b.lines) {
      const d = line.split(/\s+/).length * (0.36 + r() * 0.1);
      cues.push(`[TIMESTAMP: ${t.toFixed(2)} -> ${(t + d).toFixed(2)}]\n${line}`);
      t += d + (r() < 0.3 ? 0.8 : 0.25);
    }
    ranges.push({ kind: b.kind, start, end: t });
  }
}

const run = async (profile: 'podcast' | 'sermon') => {
  const log = console.log; console.log = () => {};
  const m = await analyzeTranscript(cues.join('\n\n'), undefined, undefined, undefined, undefined,
    { title: 'Tinggal di Dalam Pokok Anggur | Ibadah Minggu' }, undefined, profile);
  console.log = log;
  return m;
};

let ok = true;
for (const profile of ['podcast', 'sermon'] as const) {
  const moments = await run(profile);
  console.log(`\n== ${profile}: ${moments.length} clips`);
  for (const m of moments) {
    const hits = ranges.filter((g) => g.kind === 'liturgy' && m.startTime < g.end - 0.5 && m.endTime > g.start + 0.5);
    console.log(`${m.startTime.toFixed(1)}–${m.endTime.toFixed(1)}  ${hits.length ? 'LITURGY ' : ''}${m.title}`);
    if (profile === 'sermon' && hits.length) ok = false;
  }
  if (profile === 'sermon') console.log(moments[0]?.description.split('\n').pop());
}
console.log(ok ? '\nOK: no sermon clip overlaps prayer / offering / announcements' : '\nFAIL');
process.exit(ok ? 0 : 1);
