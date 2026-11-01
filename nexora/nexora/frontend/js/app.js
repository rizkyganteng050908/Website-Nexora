'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bytes = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`;
const when = d => new Date(d).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
const TITLES = { dashboard: 'Dashboard', scraper: 'Scraper', history: 'Riwayat' };
const state = { result: null, tab: 'overview', lang: 'html', file: 0 };

async function api(url, opts) {
  const r = await fetch(url, opts);
  let d = {};
  try { d = await r.json(); } catch {}
  if (!r.ok) throw new Error(d.error || `Permintaan gagal (HTTP ${r.status})`);
  return d;
}
function toast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = 'toast ' + type; t.textContent = msg;
  $('#toasts').append(t); setTimeout(() => t.remove(), 4500);
}
function download(name, content, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const link = (u, t) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer nofollow">${esc(t ?? u)}</a>`;

// ---------- Navigasi ----------
function show(view) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#viewTitle').textContent = TITLES[view];
  closeMenu();
  if (view === 'dashboard') loadDashboard();
  if (view === 'history') loadHistory();
}
const closeMenu = () => { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('open'); };
$$('.nav-btn').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));
$('#menuBtn').addEventListener('click', () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('open'); });
$('#scrim').addEventListener('click', closeMenu);
document.addEventListener('click', e => {
  const go = e.target.closest('[data-go]'); if (go) show(go.dataset.go);
  const op = e.target.closest('[data-open]'); if (op) openResult(op.dataset.open);
  const del = e.target.closest('[data-del]');
  if (del) api('/api/results/' + del.dataset.del, { method: 'DELETE' }).then(() => { toast('Riwayat dihapus', 'ok'); loadHistory(); loadDashboard(); }).catch(err => toast(err.message, 'error'));
});

// ---------- Dashboard & riwayat ----------
function rows(list) {
  if (!list.length) return '<div class="empty">Belum ada analisis. Mulai dari menu Scraper.</div>';
  return list.map(h => `<div class="row"><i class="st ${h.status === 'failed' ? 'failed' : ''}"></i>
    <div class="info"><b>${esc(h.status === 'success' && h.summary.title ? h.summary.title : h.url)}</b>
    <small>${esc(h.url)}</small><br><small>${when(h.createdAt)}, ${(h.durationMs / 1000).toFixed(1)} dtk${h.status === 'success'
      ? `, ${h.summary.cssCount} CSS, ${h.summary.jsCount} JS, ${h.summary.imageCount} gambar, skor SEO ${h.summary.score}` : `, gagal: ${esc(h.error)}`}</small></div>
    <div class="acts">${h.status === 'success' ? `<button class="btn small" data-open="${esc(h.id)}">Buka</button>` : ''}
    ${h.status === 'success' ? `<button class="btn small ghost danger" data-del="${esc(h.id)}">Hapus</button>` : ''}</div></div>`).join('');
}
async function loadDashboard() {
  try {
    const [s, h] = await Promise.all([api('/api/stats'), api('/api/history')]);
    $('#stats').innerHTML = [['Website dianalisis', s.total], ['Berhasil', s.success], ['Gagal', s.failed],
      ['Rata-rata durasi', s.avgMs ? (s.avgMs / 1000).toFixed(1) + ' dtk' : '-'], ['Aset ditemukan', s.assets]]
      .map(([l, v]) => `<div class="card stat"><span>${l}</span><strong>${esc(v)}</strong></div>`).join('');
    const max = Math.max(1, ...s.daily.map(d => d.count));
    $('#chart').innerHTML = s.daily.map(d => `<div class="bar"><b>${d.count}</b><i data-h="${Math.max(3, d.count / max * 100)}"></i><span>${new Date(d.date).toLocaleDateString('id-ID', { weekday: 'short' })}</span></div>`).join('');
    $$('#chart i').forEach(i => { i.style.height = i.dataset.h + '%'; });
    $('#recent').innerHTML = rows(h.slice(0, 5));
  } catch (e) { toast(e.message, 'error'); }
}
async function loadHistory() {
  try { $('#historyList').innerHTML = rows(await api('/api/history')); } catch (e) { toast(e.message, 'error'); }
}
$('#clearBtn').addEventListener('click', async () => {
  if (!confirm('Hapus seluruh riwayat dan hasil analisis?')) return;
  try { await api('/api/history', { method: 'DELETE' }); loadHistory(); toast('Riwayat dikosongkan', 'ok'); } catch (e) { toast(e.message, 'error'); }
});

// ---------- Scraper ----------
function normalizeUrl(raw) {
  if (!raw) return { error: 'Masukkan URL website terlebih dahulu.' };
  if (/\s/.test(raw)) return { error: 'URL tidak boleh mengandung spasi.' };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = 'https://' + raw;
  let u; try { u = new URL(raw); } catch { return { error: 'Format URL tidak valid. Contoh: https://example.com' }; }
  if (!['http:', 'https:'].includes(u.protocol)) return { error: 'Hanya URL http dan https yang didukung.' };
  if (!u.hostname.includes('.')) return { error: 'Nama domain tidak lengkap. Contoh: example.com' };
  return { url: u.href };
}
const setProgress = (p, m) => {
  $('#progressBar').style.width = p + '%'; $('#progressPct').textContent = Math.round(p) + '%'; $('#progressMsg').textContent = m;
  const li = document.createElement('li'); li.textContent = m; $('#progressLog').append(li); li.scrollIntoView({ block: 'nearest' });
};
const formError = m => { const b = $('#formError'); b.hidden = !m; b.textContent = m || ''; };

$('#scrapeForm').addEventListener('submit', async e => {
  e.preventDefault(); formError('');
  const n = normalizeUrl($('#urlInput').value.trim());
  if (n.error) return formError(n.error);
  const btn = $('#startBtn'); btn.disabled = true; btn.textContent = 'Memproses…';
  $('#result').innerHTML = ''; $('#progressLog').innerHTML = ''; $('#progressCard').hidden = false; setProgress(1, 'Mengirim permintaan…');
  const finish = () => { btn.disabled = false; btn.textContent = 'Start Scraping'; };
  try {
    const { jobId } = await api('/api/scrape', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: n.url }) });
    const es = new EventSource(`/api/scrape/${jobId}/events`);
    es.onmessage = async m => {
      const ev = JSON.parse(m.data);
      if (ev.type === 'progress') setProgress(ev.percent, ev.message);
      else if (ev.type === 'done') {
        es.close(); setProgress(100, 'Analisis selesai');
        try { renderResult(await api('/api/results/' + ev.id)); toast('Analisis selesai', 'ok'); } catch (err) { formError(err.message); }
        finish();
      } else if (ev.type === 'error') {
        es.close(); $('#progressCard').hidden = true; formError('Website tidak dapat dianalisis: ' + ev.message); finish();
      }
    };
    es.onerror = () => { if (es.readyState === EventSource.CLOSED) return; es.close(); $('#progressCard').hidden = true; formError('Koneksi progres terputus. Cek Riwayat untuk melihat hasilnya.'); finish(); };
  } catch (err) { $('#progressCard').hidden = true; formError(err.message); finish(); }
});

async function openResult(id) {
  try { show('scraper'); $('#progressCard').hidden = true; renderResult(await api('/api/results/' + id)); } catch (e) { toast(e.message, 'error'); }
}

// ---------- Hasil ----------
const TABS = [['overview', 'Ringkasan'], ['seo', 'SEO'], ['code', 'Kode'], ['assets', 'Aset'], ['links', 'Tautan'], ['export', 'Ekspor']];
function renderResult(r) {
  state.result = r; state.tab = 'overview'; state.lang = 'html'; state.file = 0;
  $('#result').innerHTML = `<div class="card"><div class="result-head"><h2>${link(r.finalUrl)}</h2>
    <span class="small-note">${when(r.createdAt)}, ${(r.durationMs / 1000).toFixed(1)} detik</span></div>
    <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}">${l}</button>`).join('')}</div>
    <div id="tabBody"></div></div>`;
  $$('.tab').forEach(t => t.addEventListener('click', () => { state.tab = t.dataset.tab; drawTab(); }));
  drawTab(); $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function drawTab() {
  const r = state.result;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === state.tab));
  const body = $('#tabBody');
  body.innerHTML = { overview, seo, code, assets, links, exp }[state.tab](r);
  if (state.tab === 'code') bindCode();
  if (state.tab === 'export') $$('[data-export]').forEach(b => b.addEventListener('click', () => doExport(b)));
}
const kv = o => `<dl class="kv">${o.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v || '<span class="small-note">tidak ada</span>'}</dd>`).join('')}</dl>`;

function overview(r) {
  const m = [['Ukuran HTML', bytes(r.stats.htmlSize)], ['Berkas CSS', r.css.length], ['Berkas JS', r.js.length], ['JS eksternal', r.stats.externalJs],
    ['Gambar', r.images.length], ['Tautan internal', r.links.totalInternal], ['Tautan eksternal', r.links.totalExternal], ['Skor SEO', r.seo.score + '/100']];
  const c = r.stats.cssStats;
  return `<div class="metrics">${m.map(([l, v]) => `<div class="metric"><span>${l}</span><b>${esc(v)}</b></div>`).join('')}</div>
    <h3>Teknologi terdeteksi</h3><div class="chips">${r.tech.length ? r.tech.map(t => `<span class="chip">${esc(t)}</span>`).join('') : '<span class="small-note">Tidak ada teknologi yang dikenali.</span>'}</div>
    <h3 style="margin-top:20px">Respons HTTP</h3>${kv([['Status', r.http.status], ['Content-Type', esc(r.http.contentType)], ['Server', esc(r.http.server)], ['X-Powered-By', esc(r.http.poweredBy)],
      ['Cache-Control', esc(r.http.cacheControl)], ['HSTS', r.http.hsts ? 'Aktif' : 'Tidak aktif'], ['CSP', r.http.csp ? 'Aktif' : 'Tidak aktif']])}
    <h3 style="margin-top:20px">Ringkasan CSS</h3>${kv([['Aturan (perkiraan)', c.rules], ['Media query', c.mediaQueries], ['Variabel CSS', c.variables],
      ['Warna dominan', c.topColors.map(esc).join(', ')], ['Font utama', c.topFonts.map(esc).join(', ')]])}`;
}
function seo(r) {
  const s = r.seo, cls = s.score >= 80 ? '' : s.score >= 50 ? 'mid' : 'low';
  return `<div class="result-head"><div style="display:flex;gap:16px;align-items:center"><span class="score ${cls}">${s.score}</span><div><b>Skor SEO dasar</b><br><span class="small-note">Berdasarkan pemeriksaan metadata dan struktur heading.</span></div></div></div>
    <h3>Temuan</h3>${s.issues.length ? s.issues.map(i => `<div class="issue ${i.level}">${esc(i.message)}</div>`).join('') : '<div class="issue">Tidak ada masalah utama.</div>'}
    <h3 style="margin-top:20px">Metadata</h3>${kv([['Title', esc(s.title)], ['Description', esc(s.description)], ['Keywords', esc(s.keywords)], ['Robots', esc(s.robots)],
      ['Canonical', s.canonical ? link(s.canonical) : ''], ['Bahasa', esc(s.lang)], ['Charset', esc(s.charset)], ['Viewport', esc(s.viewport)],
      ['og:title', esc(s.og.title)], ['og:description', esc(s.og.description)], ['og:image', s.og.image ? link(s.og.image) : ''], ['twitter:card', esc(s.twitterCard)],
      ['Heading', Object.entries(s.headings).map(([k, v]) => `${k.toUpperCase()}: ${v}`).join(', ')], ['Teks H1', s.h1.map(esc).join(' / ')]])}`;
}

// Code viewer
const LANG = { html: 'xml', css: 'css', js: 'javascript' };
const files = () => ({ html: [{ name: 'index.html', content: state.result.html }], css: state.result.css.filter(c => c.content), js: state.result.js.filter(c => c.content) }[state.lang]);
function code() {
  const f = files(); if (state.file >= f.length) state.file = 0;
  const cur = f[state.file];
  return `<div class="code-bar"><div class="seg">${['html', 'css', 'js'].map(l => `<button data-lang="${l}" class="${state.lang === l ? 'active' : ''}">${l.toUpperCase()}</button>`).join('')}</div>
    ${f.length > 1 ? `<select id="fileSel" aria-label="Pilih berkas">${f.map((x, i) => `<option value="${i}" ${i === state.file ? 'selected' : ''}>${esc(x.url || x.name)} (${bytes(x.size)})</option>`).join('')}</select>` : ''}
    <span class="spacer"></span>${cur ? '<button class="btn small" id="copyBtn">Copy Code</button><button class="btn small" id="dlBtn">Download</button>' : ''}</div>
    ${cur ? '<pre class="code"><code id="codeEl"></code></pre><p id="codeNote" class="small-note"></p>' : '<div class="empty">Tidak ada berkas pada kategori ini.</div>'}`;
}
function bindCode() {
  $$('[data-lang]').forEach(b => b.addEventListener('click', () => { state.lang = b.dataset.lang; state.file = 0; drawTab(); }));
  const sel = $('#fileSel'); if (sel) sel.addEventListener('change', () => { state.file = +sel.value; drawTab(); });
  const cur = files()[state.file]; if (!cur) return;
  const MAX = 120000, shown = cur.content.slice(0, MAX), el = $('#codeEl');
  el.textContent = shown;
  if (window.hljs) { try { el.innerHTML = hljs.highlight(shown, { language: LANG[state.lang], ignoreIllegals: true }).value; } catch {} }
  $('#codeNote').textContent = `${cur.content.split('\n').length} baris, ${bytes(cur.content.length)}` + (cur.content.length > MAX ? `. Tampilan dipotong di ${MAX.toLocaleString('id-ID')} karakter; Copy dan Download memakai kode lengkap.` : '');
  $('#copyBtn').addEventListener('click', () => navigator.clipboard.writeText(cur.content).then(() => toast('Kode disalin', 'ok'), () => toast('Gagal menyalin. Izinkan akses clipboard.', 'error')));
  $('#dlBtn').addEventListener('click', () => download(cur.name, cur.content, 'text/plain;charset=utf-8'));
}

function assets(r) {
  const fileList = (a, label) => `<h3 style="margin-top:20px">${label} (${a.length})</h3>${a.length ? `<ul class="list">${a.map(x => `<li>${x.url ? link(x.url) : esc(x.name) + ' <small>inline</small>'}
    ${x.size ? `<small>${bytes(x.size)}</small>` : ''}${x.thirdParty ? '<span class="tag">pihak ketiga</span>' : ''}${x.error ? `<span class="tag bad">${esc(x.error)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="small-note">Tidak ada.</p>'}`;
  return `<h3>Gambar dan ikon (${r.images.length})</h3>${r.images.length ? `<div class="img-grid">${r.images.slice(0, 60).map(i => `<a class="img-item" href="${esc(i.url)}" target="_blank" rel="noopener noreferrer nofollow">
    <div class="thumb"><img loading="lazy" referrerpolicy="no-referrer" alt="${esc(i.alt || '')}" src="${esc(i.url)}"></div><span title="${esc(i.url)}">${esc(i.kind)}: ${esc(i.url.split('/').pop() || i.url)}</span></a>`).join('')}</div>
    ${r.images.length > 60 ? `<p class="small-note">Menampilkan 60 dari ${r.images.length} gambar.</p>` : ''}` : '<p class="small-note">Tidak ada gambar.</p>'}
    ${fileList(r.css, 'Stylesheet')}${fileList(r.js, 'JavaScript')}`;
}
function links(r) {
  const l = (a, t) => `<h3 style="margin-top:12px">${t} (${a.length})</h3>${a.length ? `<ul class="list">${a.map(x => `<li>${link(x.url)}${x.text ? `<small>${esc(x.text)}</small>` : ''}${x.nofollow ? '<span class="tag">nofollow</span>' : ''}</li>`).join('')}</ul>` : '<p class="small-note">Tidak ada.</p>'}`;
  const cut = (n, a) => n > a ? `<p class="small-note">Menampilkan ${a} dari ${n} tautan.</p>` : '';
  return l(r.links.internal, 'Tautan internal') + cut(r.links.totalInternal, r.links.internal.length) + l(r.links.external, 'Tautan eksternal') + cut(r.links.totalExternal, r.links.external.length);
}
function exp(r) {
  const cards = [['zip', 'ZIP lengkap', 'HTML, CSS, JavaScript, laporan JSON, dan gambar yang berhasil diunduh.'], ['html', 'HTML', 'Dokumen HTML asli sebagai berkas .html.'],
    ['pdf', 'Laporan PDF', 'Ringkasan analisis, temuan SEO, dan daftar aset.'], ['assets', 'Aset saja', 'Gambar publik yang berhasil diambil (maks. 30 berkas).']];
  return `<div class="export-grid">${cards.map(([t, h, d]) => `<div class="export-card"><b>${h}</b><p>${d}</p><button class="btn" data-export="${t}">Download ${h}</button></div>`).join('')}</div>
    <p class="small-note" style="margin-top:14px">Aset diambil ulang dari situs sumber dan tunduk pada robots.txt. Hak cipta tetap milik pemilik situs.</p>`;
}
async function doExport(btn) {
  const label = btn.textContent; btn.disabled = true; btn.textContent = 'Menyiapkan…';
  try {
    const res = await fetch(`/api/results/${state.result.id}/export/${btn.dataset.export}`);
    if (!res.ok) { let m = `Ekspor gagal (HTTP ${res.status})`; try { m = (await res.json()).error || m; } catch {} throw new Error(m); }
    const name = (/filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') || '') || [])[1] || `nexora-${btn.dataset.export}`;
    download(name, await res.blob()); toast('Unduhan dimulai', 'ok');
  } catch (e) { toast(e.message, 'error'); } finally { btn.disabled = false; btn.textContent = label; }
}

// ---------- Init ----------
api('/api/health').then(() => { $('#health').classList.add('ok'); $('#health span').textContent = 'Backend aktif'; })
  .catch(() => { $('#health').classList.add('bad'); $('#health span').textContent = 'Backend tidak terjangkau'; });
loadDashboard();
