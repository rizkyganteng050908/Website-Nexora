'use strict';
const archiver = require('archiver');
const PDFDocument = require('pdfkit');
const { get, allowed, LIMITS } = require('./scraper');

const host = r => new URL(r.finalUrl).hostname.replace(/[^a-z0-9.-]/gi, '_');
const NOTICE = 'Dibuat oleh NEXORA. Berkas ini adalah salinan aset publik untuk keperluan analisis developer.\nHak cipta tetap dimiliki pemilik situs asal; periksa lisensi sebelum memakai ulang.\n';

function report(r) {
  const { html, ...rest } = r;
  rest.css = r.css.map(({ content, ...c }) => c);
  rest.js = r.js.map(({ content, ...c }) => c);
  return rest;
}

async function fetchImages(r) {
  const deadline = Date.now() + 45000, list = r.images.slice(0, 30), out = [];
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const n = i++, img = list[n];
      try {
        if (!(await allowed(img.url, deadline))) continue;
        const res = await get(img.url, { maxBytes: LIMITS.image, accept: /^image\//i, deadline, timeoutMs: 8000 });
        if (res.status !== 200) continue;
        const ext = ((res.headers['content-type'] || 'image/bin').split('/')[1] || 'bin').split(/[+;]/)[0].replace('jpeg', 'jpg').replace('x-icon', 'ico').replace('vnd.microsoft.icon', 'ico');
        let b = ''; try { b = decodeURIComponent(new URL(img.url).pathname.split('/').pop() || ''); } catch {}
        b = b.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[^\w-]/g, '_').slice(0, 50) || 'image';
        out.push({ body: res.body, name: `${n + 1}-${b}.${ext}` });
      } catch { /* aset yang gagal dilewati */ }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out;
}

async function sendZip(r, res, scope) {
  res.attachment(`nexora-${host(r)}${scope === 'assets' ? '-assets' : ''}.zip`);
  const ar = archiver('zip', { zlib: { level: 9 } });
  ar.on('error', () => res.destroy());
  ar.pipe(res);
  if (scope !== 'assets') {
    ar.append(r.html, { name: 'index.html' });
    r.css.forEach(c => c.content && ar.append(c.content, { name: `css/${c.name}` }));
    r.js.forEach(j => j.content && ar.append(j.content, { name: `js/${j.name}` }));
    ar.append(JSON.stringify(report(r), null, 2), { name: 'report.json' });
  }
  (await fetchImages(r)).forEach(i => ar.append(i.body, { name: `assets/images/${i.name}` }));
  ar.append(NOTICE, { name: 'README.txt' });
  await ar.finalize();
}

const T = (s, n = 110) => { s = String(s ?? '-').replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '?'); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

function sendPdf(r, res) {
  res.attachment(`nexora-report-${host(r)}.pdf`);
  const doc = new PDFDocument({ margin: 50, size: 'A4', info: { Title: 'NEXORA – Laporan Analisis' } });
  doc.pipe(res);
  doc.rect(0, 0, doc.page.width, 92).fill('#07080f');
  doc.fillColor('#22d3ee').font('Helvetica-Bold').fontSize(26).text('NEXORA', 50, 28);
  doc.fillColor('#a78bfa').font('Helvetica').fontSize(10).text('Advanced Website Scraper & Analyzer - Laporan Analisis', 50, 60);
  doc.fillColor('#111').y = 112;
  const H = t => { doc.moveDown(0.8).font('Helvetica-Bold').fontSize(13).fillColor('#6d28d9').text(t).moveDown(0.3); doc.fillColor('#111').fontSize(10); };
  const KV = (k, v) => doc.font('Helvetica-Bold').text(k + ': ', { continued: true }).font('Helvetica').text(T(v));
  const L = a => a.forEach(x => doc.font('Helvetica').text('- ' + T(x)));

  H('Ringkasan');
  KV('URL', r.url); KV('URL akhir', r.finalUrl); KV('Dianalisis', new Date(r.createdAt).toLocaleString('id-ID'));
  KV('Durasi', (r.durationMs / 1000).toFixed(1) + ' detik'); KV('HTTP', `${r.http.status} (${r.http.contentType})`);
  KV('Server', r.http.server); KV('Teknologi terdeteksi', r.tech.join(', ') || 'Tidak terdeteksi');
  H('Statistik');
  KV('Ukuran HTML', (r.stats.htmlSize / 1024).toFixed(1) + ' KB'); KV('Berkas CSS', r.css.length); KV('Berkas JavaScript', r.js.length);
  KV('Gambar', r.images.length); KV('Tautan internal', r.links.totalInternal); KV('Tautan eksternal', r.links.totalExternal);
  H(`SEO (skor ${r.seo.score}/100)`);
  KV('Title', r.seo.title); KV('Description', r.seo.description); KV('Canonical', r.seo.canonical); KV('Bahasa', r.seo.lang);
  KV('Robots', r.seo.robots); KV('Open Graph', r.seo.og.title); KV('H1', r.seo.h1.join(' | '));
  H('Temuan SEO'); L(r.seo.issues.length ? r.seo.issues.map(i => `[${i.level}] ${i.message}`) : ['Tidak ada masalah utama.']);
  H('CSS'); L(r.css.slice(0, 15).map(c => `${c.name || c.url}${c.size ? ` (${(c.size / 1024).toFixed(1)} KB)` : ''}${c.error ? ' - ' + c.error : ''}`));
  H('JavaScript'); L(r.js.slice(0, 20).map(j => `${j.url || j.name}${j.thirdParty ? ' [pihak ketiga]' : ''}${j.error ? ' - ' + j.error : ''}`));
  H('Tautan eksternal teratas'); L(r.links.external.slice(0, 15).map(l => l.url));
  doc.moveDown(2).fontSize(8).fillColor('#666').text('Dibuat oleh NEXORA. Hormati robots.txt dan hak cipta pemilik situs.');
  doc.end();
}

module.exports = { sendZip, sendPdf };
