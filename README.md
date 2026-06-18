# Image & Word to PDF Converter

Aplikasi web untuk mengonversi gambar (JPG/PNG/WebP) dan dokumen Word (.docx) menjadi PDF. Dibangun dengan Node.js + Express, frontend vanilla JavaScript, dan LibreOffice Headless untuk konversi DOCX.

**Live Demo:** [kirdun-pdfconverter-production.up.railway.app](kirdun-pdfconverter-production.up.railway.app) 

**Author:** Kirdunqt

---

## Fitur

- **Gambar → PDF** — Konversi banyak gambar (PNG, JPG, WebP) menjadi satu file PDF. Dilakukan sepenuhnya di browser menggunakan [jsPDF](https://github.com/parallax/jsPDF).
- **Word → PDF** — Konversi file `.docx` menjadi PDF di server menggunakan LibreOffice Headless.
- **Pengaturan halaman** — Pilih ukuran halaman (A4, Letter, Legal) dan orientasi (Portrait/Landscape).
- **Manajemen urutan** — Drag & drop atau gunakan tombol untuk mengubah urutan gambar sebelum konversi.
- **UI responsif** — Tampilan modern dengan Inter font, bekerja di desktop dan mobile.
- **Batas ukuran** — Maksimal 20 MB per file untuk menjaga stabilitas server.

---

## Arsitektur

```
┌─────────────────────────────────────────────────────┐
│  Browser (Client-Side)                              │
│  ┌──────────────────────────────────────────────┐   │
│  │  index.html  ──  style.css  ──  script.js   │   │
│  │  (jsPDF untuk Gambar → PDF)                  │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                       │ fetch
                       ▼
┌─────────────────────────────────────────────────────┐
│  Railway Server (Node.js + Express)                 │
│  ┌──────────────────────────────────────────────┐   │
│  │  server.js                                   │   │
│  │   • POST /api/word-to-pdf (multer upload)    │   │
│  │   • GET  /api/health                         │   │
│  └──────────────────────────────────────────────┘   │
│                       │ exec                        │
│                       ▼                            │
│  ┌──────────────────────────────────────────────┐   │
│  │  LibreOffice Headless (libreoffice-writer)   │   │
│  │  --headless --convert-to pdf <input.docx>    │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

**Catatan penting:**
- Konversi **gambar → PDF** terjadi 100% di browser, tidak membebani server.
- Konversi **Word → PDF** dilakukan server-side dengan LibreOffice (wadah Docker di Railway).

---

## Tech Stack

| Layer       | Teknologi                                          |
|-------------|----------------------------------------------------|
| Frontend    | HTML5, CSS3, Vanilla JavaScript (ES2020)           |
| PDF Client  | [jsPDF 2.5.1](https://github.com/parallax/jsPDF)   |
| Backend     | Node.js 20, Express 4                              |
| Upload      | Multer 1.4 (multipart/form-data)                   |
| Converter   | LibreOffice Headless (`libreoffice-writer`)        |
| Container   | Docker (Debian Bookworm base)                      |
| Deploy      | [Railway](https://railway.app)                     |

---

## Struktur Proyek

```
.
├── index.html              # Halaman utama (tab Gambar & Word)
├── style.css               # Styling
├── script.js               # Frontend logic + jsPDF
├── server.js               # Express server + LibreOffice wrapper
├── package.json            # Dependensi backend
├── package-lock.json
├── Dockerfile              # Image Docker (Node + LibreOffice)
├── .dockerignore
├── README.md
├── img/
│   └── Backround.jpeg      # Aset UI
└── uploads/, output/       # Direktori kerja runtime (auto-created)
```

---

## Menjalankan Lokal

### Prasyarat

- Node.js 18+
- LibreOffice terinstal di sistem (untuk konversi DOCX)
  - **Windows:** [https://www.libreoffice.org/download](https://www.libreoffice.org/download)
  - **macOS:** `brew install --cask libreoffice`
  - **Linux (Debian/Ubuntu):** `sudo apt install libreoffice-writer`

### Langkah

```bash
# 1. Clone repo
git clone https://github.com/<username>/<repo>.git
cd <repo>

# 2. Install dependensi
npm install

# 3. Jalankan server
npm start
```

Server akan berjalan di `http://localhost:3000`. Buka URL tersebut di browser.

### Cek Instalasi LibreOffice

```bash
curl http://localhost:3000/api/health
```

Response yang diharapkan:
```json
{
  "status": "ok",
  "libreOffice": "found",
  "libreOfficePath": "/usr/bin/soffice",
  "platform": "linux",
  "uploadDir": "/app/uploads",
  "outputDir": "/app/output"
}
```

Jika `libreOffice` bernilai `"missing"`, instal LibreOffice sesuai OS kamu dan restart server.

---

## Deployment ke Railway

Proyek ini sudah dikonfigurasi untuk deploy otomatis ke Railway.

### Setup

1. **Push repo ke GitHub** (lihat panduan di bawah untuk force push jika ada conflict).
2. **Login ke [Railway](https://railway.app)** → **New Project** → **Deploy from GitHub repo**.
3. Railway akan otomatis mendeteksi `Dockerfile` dan mulai build.
4. **Tunggu build selesai** (instalasi LibreOffice memakan waktu ±2-3 menit).
5. **Generate domain** di tab Settings → Networking → Generate Domain.
6. Akses aplikasi via URL yang diberikan (contoh: `https://your-app.up.railway.app`).

### Catatan Deploy

- **Resource:** Railway memberi ~512 MB RAM dan 1 vCPU pada plan gratis. LibreOffice cukup ringan, tapi file >10 MB mungkin lambat.
- **Storage:** Direktori `uploads/` dan `output/` di-reset tiap deploy. Ini bukan masalah karena file diproses langsung dan dihapus otomatis.
- **Timeout:** Konversi DOCX dibatasi 60 detik di `server.js` (`CONVERT_TIMEOUT_MS`). Bisa diubah jika perlu.
- **HTTPS:** Railway menyediakan HTTPS otomatis untuk domain yang di-generate.

### Push ke GitHub dari Lokal

Jika ada merge conflict dengan versi lama, gunakan force push untuk menimpa remote dengan versi lokal:

```bash
# Abort merge yang sedang berlangsung
git reset --hard HEAD

# Paksa push versi lokal ke GitHub
git push --force-with-lease origin main
```

---

## API Reference

### `GET /api/health`

Cek status server dan deteksi LibreOffice.

**Response 200:**
```json
{
  "status": "ok",
  "libreOffice": "found",
  "libreOfficePath": "/usr/bin/soffice",
  "platform": "linux"
}
```

### `POST /api/word-to-pdf`

Konversi file `.docx` ke PDF menggunakan LibreOffice.

**Request:**
- Content-Type: `multipart/form-data`
- Field `file`: file `.docx` (maks 20 MB)
- Field `pageSize`: `"a4"` | `"letter"` | `"legal"` (opsional, hanya untuk referensi)
- Field `orientation`: `"portrait"` | `"landscape"` (opsional, hanya untuk referensi)

**Response 200:** Binary PDF stream (`Content-Type: application/pdf`)

**Response error:**
```json
{ "error": "Hanya file .docx yang didukung." }
```
Status code: `400` (validasi), `413` (file terlalu besar), `500` (gagal konversi), `503` (LibreOffice tidak terinstal), `504` (timeout).

---

## Batasan & Catatan

- **Format input gambar:** PNG, JPG, JPEG, WebP. Tidak mendukung HEIC, TIFF, atau PDF sebagai input.
- **Format input Word:** Hanya `.docx` (Microsoft Word 2007+). Tidak mendukung `.doc` (legacy binary) atau `.odt`.
- **Ukuran file:** Maksimal 20 MB per file (sesuai konfigurasi `MAX_FILE_BYTES` di `server.js`).
- **Timeout konversi:** 60 detik per file DOCX.
- **Privasi:** File yang di-upload disimpan sementara di direktori `uploads/` lalu dihapus otomatis setelah konversi selesai.

---

## Development

### Struktur Frontend

- `index.html` — Two-tab layout: **Gambar → PDF** dan **Word → PDF**.
- `script.js` — Dua state terpisah (`state` untuk gambar, `wordState` untuk DOCX). Library jsPDF hanya untuk tab gambar.
- `style.css` — Tema gelap modern dengan variabel CSS.

### Struktur Backend

- `server.js` — Express app dengan dua route utama:
  - `POST /api/word-to-pdf` — Upload via multer, konversi via LibreOffice, stream PDF kembali ke client.
  - `GET /api/health` — Health check.
- `findLibreOffice()` — Deteksi otomatis path LibreOffice di Windows, macOS, dan Linux.

### Menambah Ukuran File Maksimum

Edit `server.js`:
```js
const MAX_FILE_BYTES = 20 * 1024 * 1024; // ubah sesuai kebutuhan
```

### Menambah Ukuran File di Frontend

Edit `script.js`:
```js
const MAX_FILE_BYTES = 20 * 1024 * 1024;
```

---

## Lisensi

MIT License — bebas digunakan untuk proyek pribadi maupun komersial.

---

## Kredit

- [jsPDF](https://github.com/parallax/jsPDF) oleh Parallax — library PDF client-side.
- [LibreOffice](https://www.libreoffice.org/) — mesin konversi DOCX.
- Dibuat oleh **Kirdunqt**.
