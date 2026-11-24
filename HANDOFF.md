# Lanjutan sesi: NiClipper

> Tempel isi file ini sebagai pesan pertama di sesi baru.

## Konteks

Aku sedang mengembangkan **NiClipper** (repo `gilbertusnico/niclipper`). Aplikasi ini memotong video podcast YouTube jadi klip vertikal 9:16 untuk Shorts/TikTok/Reels. Semua jalan lokal: React + Vite (port 5173) dan server Express (port 3001), dengan FFmpeg, yt-dlp, dan Whisper. Laptopku MacBook Air 2019 (Intel dual-core, RAM 8 GB, tanpa GPU), jadi apa pun yang ditambahkan harus ringan. Jawab dalam bahasa Indonesia santai.

Cara kerja yang aku mau:
- Kerjakan di branch kerja, push, lalu tanya dulu sebelum merge. Kalau aku bilang "merge aja", buat PR lalu squash merge ke `main`.
- Sebelum mengubah engine, jalankan tes perbandingan (benchmark) sebelum dan sesudah. Jujur kalau ada hasil yang nggak bisa diverifikasi.

## Mode aplikasi

- **AI Generate**: tempel link YouTube → otomatis jadi 5 klip (25–75 detik).
- **Manual Crop**: link YouTube + waktu mulai/selesai (maksimal 5 klip, masing-masing maksimal 2 menit).
- **Import File**: upload video sendiri + waktu mulai/selesai.

## Yang sudah selesai (sudah di `main`, PR #9–#16)

- **#9/#10**: AI mode sekarang 5 klip (`DEFAULT_MAX_CLIPS = 5`, `MIN_RELATIVE_SCORE = 0.45`). Teks UI ikut diubah.
- **#11**: judul hook otomatis, teks hook besar di awal klip (Anton caps di kotak kuning, 3,5 detik pertama, bisa on/off di UI), hashtag nama dari judul video + kata topik, dan kolom "Channel hashtags" (disimpan di localStorage). File: `server/hook-overlay.ts`, `server/analysis/describe.ts`.
- **#12**: kolom "Hook text" opsional per klip di Manual Crop dan Import File.
- **#13**: perbaikan engine dari evaluasi video Richard Son:
  - Skor penanda pakai kepadatan, bukan jumlah, untuk kalimat lebih dari 22 kata.
  - Penalti untuk gagap atau obrolan saling potong.
  - Klip nggak boleh mulai dari "Maksudnya…", jawaban pendek ("Bukan."), atau kalimat tepat setelahnya.
  - Klip nggak boleh berakhir di frasa transisi ("ok kalau…").
  - Hook diambil dari 60% awal klip dan harus kalimat utuh.
- **#14**: kolom waktu manual otomatis pindah setelah 2 angka. Footer dihapus.
- **#15**: README lengkap (instalasi Node 20.19+, Python 3.9+, FFmpeg + libass, yt-dlp).
- **#16**:
  - **Framing shot lebar** (semua mode, `server/framing.ts`): shot lebar ditampilkan utuh 16:9 di atas latar blur. Deteksinya lewat persentase warna kulit di setengah atas crop 9:16 (close-up ~0,13–0,27, shot lebar ~0,02–0,05, batas 0,08), diperhalus minimal 1,5 detik, dan pergantiannya ditempel ke titik potong shot dari FFmpeg.
  - **Zona penutup** dilunakkan (45 detik, penalti 0,05 + 0,25×porsi).
  - **Filter iklan**: frasa jualan seperti "juga jual", "adalah produknya", "produk dari", "link di deskripsi", "hard selling".

## Yang sedang ditunggu

Aku sedang generate ulang https://www.youtube.com/watch?v=2c7AKTaHRRo (Dr. Tirta & Dr. Patricia Angel, mode AI) dengan versi `main` terbaru. Nanti aku kirim 5 klip hasilnya. Tolong cek:

1. Apakah shot lebar sekarang tampil utuh dengan latar blur, bukan meja kosong. Sebelumnya sekitar 40% frame cuma meja.
2. Apakah iklan Electrolux (sekitar 38:19–38:47) sudah nggak terpilih.
3. Kalau aku kasih tahu, berapa lama waktu prosesnya dibanding sebelumnya.

Pembanding: pilihan Gemini untuk video yang sama:
- 53:44–54:38: wibawa Dokter Tirta hancur / "Pak Nyongnyong" di Cardiff
- 31:26–32:12: "hidup perempuan cuma perlu bisa 4 hal"
- 28:54–29:52: 4 tahun nggak kuras water heater, airnya oren
- 16:48–17:40: les MTK 6x seminggu (Kumon, Sakamoto, sempoa)
- 37:17–38:09: "pemuda RD tewas kesetrum"

Di engine lokal, momen-momen itu peringkatnya jauh di bawah. Engine berbasis aturan nggak bisa menilai isi cerita.

## Cara mengevaluasi klip (yang sudah dipakai sebelumnya)

YouTube dan Hugging Face diblokir dari container. Jadi baca subtitle yang ter-burn di video: ambil frame dengan ffmpeg `fps=1.4`, crop area subtitle (`crop=1000:230:40:985`), lalu tile jadi contact sheet. Untuk menjalankan engine, minta aku kirim transkrip (format `[HH:MM:SS] teks`). Ubah transkrip itu jadi word timing interpolasi per cue, lalu panggil `analyzeTranscript(..., words)` lewat `npx tsx`.

Benchmark regresi yang dipakai sebelumnya: transkrip Richard Son dan Halda. Hasilnya harus tetap sama setelah perubahan engine. Kalau file transkripnya sudah hilang, minta aku kirim ulang.

## Ide berikutnya (belum dikerjakan)

- **Integrasi Gemini API (opsional, bisa on/off)**: Gemini memilih momen dan menulis headline, engine lokal merapikan batas potongan, dan engine lokal dipakai kalau Gemini gagal. Aku bilang "nanti aja", jadi jangan dikerjakan sebelum aku minta.
- Klip yang berhenti sebelum punchline (misalnya klip "Pak Nyongnyong" berhenti di 54:04, padahal punchline-nya sampai 54:33). Penyebabnya bukan lagi zona penutup.
- Dugaan sebelumnya: script `npm run dev` kemungkinan gagal di Windows tanpa WSL (format env-nya Mac/Linux). Belum dites.
