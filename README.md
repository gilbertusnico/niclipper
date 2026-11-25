# NiClipper

NiClipper memotong video panjang (podcast, wawancara, vlog) jadi klip vertikal 9:16 siap upload ke **YouTube Shorts, TikTok, dan Reels**, lengkap dengan subtitle dan teks hook.

Semuanya jalan **lokal di laptop kamu**: nggak perlu API key dan nggak ada biaya per video. Internet cuma dipakai untuk download video YouTube, dan sekali saat pertama kali, untuk download model Whisper.

---

## Fitur

**Tiga mode:**

| Mode | Kegunaan |
|---|---|
| **AI Generate** | Tempel link YouTube, lalu NiClipper memilih sendiri **5 momen terbaik** (masing-masing ±25–75 detik). |
| **Manual Crop** | Tempel link YouTube, lalu tentukan sendiri waktu mulai dan selesai (maksimal 5 klip, masing-masing maksimal 2 menit). |
| **Import File** | Upload video dari laptop, lalu tentukan waktunya seperti di Manual Crop. |

**Di setiap klip:**
- **Format vertikal 1080×1920**, dipotong dari tengah video.
- **Subtitle ala TikTok**: huruf kapital tebal, dan kata yang sedang diucapkan berwarna kuning. Bisa diedit lalu di-render ulang.
- **Teks hook di awal**: teks besar di kotak kuning selama 3,5 detik pertama, supaya penonton nggak langsung swipe.
  - Mode AI: dibuat otomatis, dan bisa dimatikan.
  - Mode manual: diisi sendiri per klip (opsional).
- **Judul, deskripsi, dan hashtag YouTube** dibuat otomatis (khusus mode AI), tinggal klik Copy. Hashtag channel kamu (misalnya `#RadityaDika`) bisa disimpan sekali lalu otomatis ikut di semua deskripsi.

### Cara kerja mode AI (singkat)

1. Video di-download pakai **yt-dlp**.
2. Transkrip diambil dari subtitle YouTube. Kalau nggak ada, video ditranskrip pakai **Whisper**, yang jalan lokal di laptop.
3. **Engine analisis** menilai setiap kemungkinan potongan berdasarkan isi omongan (cerita, pertanyaan, opini, reaksi, tawa) dan energi suara. Engine juga memastikan klip mulai di awal kalimat dan berakhir setelah punchline.
4. **FFmpeg** memotong video ke 9:16 lalu menempelkan subtitle dan teks hook.

Engine-nya nggak memakai AI generatif atau LLM. Semuanya berbasis aturan, jadi ringan dan bisa jalan di laptop biasa.

---

## Kebutuhan sistem

| Software | Versi | Untuk apa |
|---|---|---|
| **Node.js** | **20.19+** atau **22.12+** (saran: versi LTS terbaru) | Menjalankan aplikasi |
| **Python** | **3.9+** | Dibutuhkan yt-dlp (dicek saat `npm install`) |
| **FFmpeg** | Versi terbaru, dengan **libass** | Memotong video, membuat subtitle dan teks hook |
| **yt-dlp** | Versi terbaru | Download video dan subtitle YouTube |
| **Git** | Versi apa pun | Download dan update source code |

Sistem operasi:
- **macOS** dan **Linux**: didukung penuh.
- **Windows**: sebaiknya lewat **WSL** (Ubuntu di Windows), karena script `npm run dev` memakai format perintah Mac/Linux.

RAM 8 GB sudah cukup. GPU nggak dibutuhkan.

---

## Instalasi

### 1. Install Node.js

**macOS** (pakai [Homebrew](https://brew.sh)). Kalau belum punya Homebrew, install dulu:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Lalu install Node.js:

```bash
brew install node
```

**Windows / Linux (Ubuntu)**: download installer LTS dari [nodejs.org](https://nodejs.org), atau di Ubuntu/WSL pakai [nvm](https://github.com/nvm-sh/nvm):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash
```

Tutup lalu buka lagi terminalnya, kemudian:

```bash
nvm install --lts
```

Cek versinya. Hasilnya harus v20.19 ke atas:

```bash
node -v
```

### 2. Install Python 3.9+

**macOS:**

```bash
brew install python
```

**Ubuntu / WSL:**

```bash
sudo apt update && sudo apt install -y python3
```

Cek versinya:

```bash
python3 --version
```

### 3. Install FFmpeg

**macOS:**

```bash
brew install ffmpeg
```

**Ubuntu / WSL:**

```bash
sudo apt install -y ffmpeg
```

Cek apakah FFmpeg sudah terpasang dan punya libass (yang menggambar subtitle):

```bash
ffmpeg -hide_banner -filters | grep -E " (ass|drawtext) "
```

Kalau muncul baris `ass`, berarti siap. Kalau FFmpeg belum terpasang di sistem, NiClipper akan memakai FFmpeg bawaan dari npm (`ffmpeg-static`) sebagai cadangan.

### 4. Install yt-dlp

`npm install` sebenarnya sudah mengunduh yt-dlp otomatis. Tapi YouTube sering berubah, jadi yt-dlp perlu sering di-update. Install juga versi sistem supaya gampang di-update.

**macOS:**

```bash
brew install yt-dlp
```

**Ubuntu / WSL:**

```bash
sudo apt install -y pipx && pipx ensurepath
```

```bash
pipx install yt-dlp
```

Cek versinya:

```bash
yt-dlp --version
```

### 5. Download NiClipper dan install dependency

```bash
git clone https://github.com/gilbertusnico/niclipper.git
```

```bash
cd niclipper
```

```bash
npm install
```

`npm install` juga mengunduh yt-dlp bawaan dan font subtitle, jadi butuh internet.

### 6. Jalankan

```bash
npm run dev
```

Buka **http://localhost:5173** di browser.

Perintah ini menjalankan dua bagian sekaligus: tampilan web (port **5173**) dan server (port **3001**). Biarkan terminalnya tetap terbuka selama aplikasi dipakai. Untuk berhenti, tekan `Ctrl + C`.

> **Pertama kali transkrip pakai Whisper** (video tanpa subtitle YouTube, atau mode Import File), NiClipper mengunduh model Whisper berukuran puluhan MB dari Hugging Face. Ini cuma sekali, setelah itu modelnya tersimpan di laptop.

---

## Cara pakai

### AI Generate
1. Pilih tab **AI Generate**.
2. Atur subtitle (**Auto-generate** atau **No Subtitles**) dan **Hook text at the start** (on/off).
3. Pilih **Content type**:
   - **Podcast**: obrolan 2 orang atau lebih (default).
   - **Khotbah**: khotbah Kristen. Bagian doa, persembahan, pengumuman, dan pimpin pujian dilewati. Ilustrasi/kesaksian dan referensi ayat dinilai lebih tinggi, dan seruan "Amin?" / "Setuju?" tidak dianggap pertanyaan.
4. Tempel link YouTube, lalu klik **Generate Clips**.
5. Tunggu prosesnya: download → transkrip → analisis → potong → render.
6. Di setiap klip: tonton, **Download**, dan copy **Title / Hook text / Description**.
7. Isi **Channel hashtags** sekali saja. Isinya otomatis masuk ke semua deskripsi dan diingat untuk sesi berikutnya.

### Manual Crop / Import File
1. Pilih tab **Manual Crop** (link YouTube) atau **Import File** (upload video).
2. Isi waktu mulai dan selesai. Setelah 2 angka, kursor otomatis pindah ke kolom berikutnya. Contoh: ketik `23 40 24 35` untuk 23:40 → 24:35.
3. (Opsional) Isi **Hook text at the start** untuk tiap klip.
4. Klik **Crop**.

### Edit subtitle
Klik ikon pensil di klip, perbaiki teks yang salah dengar, lalu klik **Update Subtitles**. Klip akan di-render ulang tanpa menghilangkan judul, deskripsi, dan hook.

### Lokasi hasil
Semua klip tersimpan di folder **`output/`** (`clip_1.mp4`, `clip_2.mp4`, dan seterusnya, ditambah thumbnail `.jpg`). Tombol folder di setiap klip langsung membuka folder ini.

Isi folder `output/` dihapus setiap kali kamu generate atau crop lagi. Pindahkan dulu klip yang mau disimpan.

---

## Update

Untuk mengambil versi NiClipper terbaru:

```bash
git pull origin main
```

```bash
npm install
```

Lalu jalankan lagi `npm run dev`.

Kalau download YouTube mulai gagal, update yt-dlp. Di macOS:

```bash
brew upgrade yt-dlp
```

Di Ubuntu / WSL:

```bash
pipx upgrade yt-dlp
```

---

## Konfigurasi

Opsional. Salin `.env.example` jadi `.env` kalau mau mengganti port server:

```bash
cp .env.example .env
```

| Variabel | Default | Keterangan |
|---|---|---|
| `PORT` | `3001` | Port server. Kalau diganti, sesuaikan juga `target` proxy di `vite.config.ts`. |

### Tes engine (untuk developer)

Sebelum dan sesudah mengubah engine analisis (`server/analysis/`):

```bash
npx tsx scripts/regression/run.ts
```

Perintah ini menjalankan engine pada transkrip podcast sintetis dan membandingkannya dengan snapshot. Hasilnya harus `SAME` kalau perubahannya tidak dimaksudkan mengubah hasil podcast. Kalau perubahannya memang disengaja, perbarui snapshot dengan `--write`.

```bash
npx tsx scripts/regression/sermon-smoke.ts
```

Perintah ini mengecek profil Khotbah: tidak ada klip yang mengenai blok doa, persembahan, atau pengumuman.

---

## Troubleshooting

**`npm install` gagal dengan pesan "youtube-dl-exec needs Python"**
Install Python 3.9+ (lihat langkah 2). Kalau yt-dlp sudah terpasang lewat Homebrew/pipx, pengecekan ini bisa dilewati:

```bash
YOUTUBE_DL_SKIP_PYTHON_CHECK=1 npm install
```

**"Gagal menjalankan yt-dlp", atau download gagal (error 403 / Sign in to confirm)**
Biasanya karena yt-dlp sudah ketinggalan versi. Update yt-dlp (lihat bagian [Update](#update)), lalu coba lagi.

**Subtitle nggak muncul di video**
FFmpeg kamu mungkin nggak punya filter `ass`. Cek dengan perintah di langkah 3. Di macOS, install ulang dengan `brew reinstall ffmpeg`.

**Port 5173 atau 3001 sudah dipakai**
Tutup aplikasi lain yang memakai port itu, atau ganti `PORT` di `.env`.

**Proses transkrip lama**
Whisper jalan di CPU. Video tanpa subtitle YouTube akan lebih lama diproses. Video YouTube yang punya subtitle (termasuk subtitle otomatis) jauh lebih cepat, karena transkripnya tinggal diambil.

**Di Windows: `'ORT_LOG_LEVEL' is not recognized…`**
Jalankan NiClipper di dalam WSL (Ubuntu), bukan di Command Prompt atau PowerShell.

---

## Struktur folder

```
niclipper/
├── src/                 # Tampilan web (React + Tailwind)
├── server/              # Server (Express): download, transkrip, potong, render
│   ├── analysis/        # Engine pemilih momen (mode AI)
│   ├── hook-overlay.ts  # Teks hook di awal klip
│   └── subtitles.ts     # Subtitle dengan highlight per kata
├── assets/fonts/        # Font Anton (subtitle & hook)
├── output/              # Hasil klip (dibuat otomatis)
└── temp/                # File sementara (dibuat otomatis)
```

Font: [Anton](https://fonts.google.com/specimen/Anton) (SIL Open Font License).
