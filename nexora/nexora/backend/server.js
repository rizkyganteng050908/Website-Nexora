'use strict';
const express = require('express');
const path = require('path');
const { analyze } = require('./lib/scraper');
const { validateUrl } = require('./lib/security');
const store = require('./lib/store');
const exporter = require('./lib/exporter');

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src * data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  });
  next();
});

// Rate limit sederhana per IP
const hits = new Map();
setInterval(() => hits.clear(), 10 * 60 * 1000).unref();
const limit = (max, windowMs) => (req, res, next) => {
  const now = Date.now(), a = (hits.get(req.ip + req.path) || []).filter(t => now - t < windowMs);
  if (a.length >= max) return res.status(429).json({ error: 'Terlalu banyak permintaan. Coba lagi sebentar lagi.' });
  a.push(now); hits.set(req.ip + req.path, a); next();
};

function friendly(err) {
  const map = { ENOTFOUND: 'Domain tidak ditemukan. Periksa penulisan URL.', ECONNREFUSED: 'Koneksi ditolak oleh server tujuan.',
    ECONNRESET: 'Koneksi diputus oleh server tujuan.', ETIMEDOUT: 'Koneksi ke server tujuan timeout.', EAI_AGAIN: 'DNS gagal diselesaikan, coba lagi.' };
  const c = err.code || '';
  if (map[c]) return map[c];
  if (/CERT|SSL|TLS/i.test(c)) return 'Sertifikat SSL situs tidak valid atau tidak tepercaya.';
  return err.message || 'Terjadi kesalahan tak terduga.';
}

// ---- Scraping job + progres real-time (SSE) ----
const jobs = new Map();
let running = 0;
const MAX_RUNNING = 3;

app.post('/api/scrape', limit(10, 60000), express.json({ limit: '4kb' }), (req, res) => {
  let target;
  try { target = validateUrl(req.body && req.body.url); } catch (e) { return res.status(400).json({ error: e.message }); }
  if (running >= MAX_RUNNING) return res.status(503).json({ error: 'Server sedang sibuk. Coba lagi beberapa saat lagi.' });

  const jobId = store.newId();
  const job = { events: [], subs: new Set() };
  jobs.set(jobId, job);
  const emit = ev => { job.events.push(ev); job.subs.forEach(s => s(ev)); };
  running++;
  const t0 = Date.now();
  analyze(target.href, emit)
    .then(result => {
      result.id = store.newId();
      const summary = {
        title: result.seo.title, htmlSize: result.stats.htmlSize, cssCount: result.css.length, jsCount: result.js.length,
        imageCount: result.images.length, internal: result.links.totalInternal, external: result.links.totalExternal, score: result.seo.score,
      };
      store.record({ id: result.id, url: result.finalUrl, status: 'success', createdAt: result.createdAt, durationMs: result.durationMs, summary }, result);
      emit({ type: 'done', id: result.id });
    })
    .catch(err => {
      const message = friendly(err);
      store.record({ id: store.newId(), url: target.href, status: 'failed', createdAt: new Date().toISOString(), durationMs: Date.now() - t0, error: message }, null);
      emit({ type: 'error', message });
    })
    .finally(() => { running--; setTimeout(() => jobs.delete(jobId), 60000).unref(); });
  res.json({ jobId });
});

app.get('/api/scrape/:jobId/events', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job tidak ditemukan.' });
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const send = ev => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
    if (ev.type === 'done' || ev.type === 'error') res.end();
  };
  job.events.forEach(send);
  if (!res.writableEnded) { job.subs.add(send); req.on('close', () => job.subs.delete(send)); }
});

// ---- Data ----
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/stats', (req, res) => res.json(store.stats()));
app.get('/api/history', (req, res) => res.json(store.history()));
app.delete('/api/history', (req, res) => { store.clear(); res.json({ ok: true }); });
app.get('/api/results/:id', (req, res) => {
  const r = store.getResult(req.params.id);
  r ? res.json(r) : res.status(404).json({ error: 'Hasil analisis tidak ditemukan.' });
});
app.delete('/api/results/:id', (req, res) => { store.remove(req.params.id); res.json({ ok: true }); });

app.get('/api/results/:id/export/:type', limit(10, 60000), async (req, res, next) => {
  try {
    const r = store.getResult(req.params.id);
    if (!r) return res.status(404).json({ error: 'Hasil analisis tidak ditemukan.' });
    const slug = new URL(r.finalUrl).hostname.replace(/[^a-z0-9.-]/gi, '_');
    switch (req.params.type) {
      case 'html': res.attachment(`${slug}.html`).type('text/html; charset=utf-8').send(r.html); break;
      case 'zip': await exporter.sendZip(r, res, 'all'); break;
      case 'assets': await exporter.sendZip(r, res, 'assets'); break;
      case 'pdf': exporter.sendPdf(r, res); break;
      default: res.status(400).json({ error: 'Jenis ekspor tidak dikenal.' });
    }
  } catch (e) { next(e); }
});

app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));
app.use((err, req, res, next) => {
  if (res.headersSent) return res.destroy();
  res.status(err.status || 500).json({ error: err.status === 400 ? 'Permintaan tidak valid.' : 'Terjadi kesalahan pada server.' });
});

const PORT = process.env.PORT || 3000, HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => console.log(`NEXORA berjalan di http://${HOST}:${PORT}`));
