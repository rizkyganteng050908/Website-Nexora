# NEXORA 2.0 – Advanced Website Scraper & Analyzer

Analisis HTML, CSS, JavaScript, aset, metadata SEO, dan tautan dari URL publik. Backend Node.js sungguhan, frontend terpisah.

## Menjalankan
```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...     # wajib untuk fitur AI (Windows PowerShell: $env:ANTHROPIC_API_KEY="...")
npm start                               # http://127.0.0.1:3000
```
Tanpa `ANTHROPIC_API_KEY`, scraper tetap berfungsi penuh; tombol AI dinonaktifkan dengan penjelasan.
Butuh Node.js 18+. Variabel opsional: `PORT`, `HOST` (jangan ubah HOST ke 0.0.0.0 tanpa reverse proxy + autentikasi).

## Struktur
```
backend/
  server.js          API, SSE progres, rate limit, header keamanan
  lib/security.js    validasi URL + proteksi SSRF (blokir IP privat, DNS pinning)
  lib/scraper.js     fetch aman, robots.txt, parsing HTML/CSS/JS/gambar/SEO/tautan
  lib/exporter.js    ZIP, PDF
  lib/store.js       riwayat & hasil (JSON di backend/data)
frontend/            index.html, css/style.css, js/app.js
```

## API
`POST /api/scrape {url}` → `{jobId}` · `GET /api/scrape/:jobId/events` (SSE) · `GET /api/results/:id` ·
`GET /api/results/:id/export/{html|zip|assets|pdf}` · `GET /api/history` · `GET /api/stats` · `DELETE /api/results/:id`

## Keamanan
- Hanya http/https, port 80/443, tanpa kredensial di URL.
- DNS di-resolve sekali dan IP divalidasi saat koneksi (loopback, privat, link-local, metadata cloud diblokir); redirect divalidasi ulang per hop (maks. 5).
- Batas: HTML 5 MB, aset 1 MB, gambar 2 MB, 10 detik per permintaan, 60 detik total, 3 job bersamaan, 10 scrape/menit/IP.
- robots.txt dihormati (halaman dan aset). Tanpa cookie/header auth; 401/403 ditolak, tidak ada upaya bypass.
- Output di UI di-escape; CSP ketat.

## Batasan
- Tidak mengeksekusi JavaScript (SPA yang dirender di klien hanya menampilkan HTML awal).
- Hanya 10 CSS dan 10 JS eksternal pertama yang diunduh isinya; sisanya dicantumkan saja.
- HTML di ZIP tidak ditulis ulang ke path lokal.

## Fitur AI (v2.0)
Semua analisis berjalan di backend (`backend/lib/ai.js`) lewat Anthropic Messages API; API key tidak pernah sampai ke browser.
Tab **AI Insight** pada hasil scraping:

| Fitur | Endpoint | Data yang dikirim |
|---|---|---|
| Penjelasan kode per bagian | `POST /api/ai/:id/explain` `{lang,file}` | kode bernomor baris (maks. ±45 KB) |
| Deteksi kesalahan HTML/CSS/JS | `POST /api/ai/:id/errors` `{lang,file}` | kode bernomor baris + pemeriksaan otomatis HTML |
| Rekomendasi SEO | `POST /api/ai/:id/seo` | metadata, heading, tautan, jumlah kata, JSON-LD |
| Analisis struktur | `POST /api/ai/:id/structure` | outline DOM, landmark, rasio semantik, kedalaman DOM |
| Rekomendasi performa | `POST /api/ai/:id/performance` | ukuran aset, script pemblokir render, gambar, pihak ketiga |
| Laporan otomatis | `POST /api/ai/:id/report` | semua hasil di atas yang sudah ada |

Tombol "Jalankan analisis AI lengkap" menjalankan semuanya berurutan lalu menyusun laporan. Laporan bisa diunduh sebagai Markdown, PDF, atau ikut masuk ZIP.
Hasil di-cache per hasil scraping di `backend/data/ai/`; "Analisis ulang" memaksa panggilan baru.

Variabel opsional: `NEXORA_AI_MODEL` (default `claude-sonnet-5-5`), `ANTHROPIC_BASE_URL`.

### Catatan keamanan, biaya, dan privasi
- Konten situs diperlakukan sebagai data tidak tepercaya (pembatas `<website_content>` + instruksi sistem anti prompt-injection). Keluaran AI dinormalisasi di server dan di-escape di UI; tidak ada tool/aksi yang dipicu AI.
- Setiap panggilan AI memakai kuota/biaya API key Anda. Batas: 30 panggilan/menit/IP, 4 analisis AI bersamaan.
- Kode halaman dikirim ke Anthropic API; jangan analisis halaman yang tidak boleh dikirim ke pihak ketiga.
- AI bisa keliru. Angka dan temuan terukur (DOM, ukuran aset, dll.) dihitung server dan ditampilkan di bagian "Data terukur"; skor AI adalah penilaian, bukan pengukuran Lighthouse.
