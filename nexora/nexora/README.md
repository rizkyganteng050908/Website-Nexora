# NEXORA – Advanced Website Scraper & Analyzer

Analisis HTML, CSS, JavaScript, aset, metadata SEO, dan tautan dari URL publik. Backend Node.js sungguhan, frontend terpisah.

## Menjalankan
```bash
npm install
npm start          # http://127.0.0.1:3000
```
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
