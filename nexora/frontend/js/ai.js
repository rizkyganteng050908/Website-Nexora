'use strict';
// NEXORA 2.0: panel AI Insight. Semua analisis dijalankan oleh backend (/api/ai/...).
(() => {
  const ai = { sub: 'report', lang: 'html', file: 0, tasks: {}, busy: null, error: '', progress: null };
  const SUBS = [['report', 'Laporan'], ['explain', 'Penjelasan kode'], ['errors', 'Kesalahan kode'], ['seo', 'Rekomendasi SEO'], ['structure', 'Struktur'], ['performance', 'Performa']];
  const LBL = { high: 'tinggi', medium: 'sedang', low: 'rendah', error: 'error', warning: 'peringatan', info: 'info' };
  const st = () => window.aiStatus || { configured: false, model: '' };
  const key = t => (t === 'explain' || t === 'errors') ? `${t}:${ai.lang}:${ai.file}` : t;
  const cur = t => ai.tasks[key(t)];
  const filesOf = l => ({ html: [{ name: 'index.html', content: state.result.html, size: state.result.html.length }],
    css: state.result.css.filter(c => c.content), js: state.result.js.filter(c => c.content) })[l];
  const redraw = () => { if (state.tab === 'ai' && state.result) drawTab(); };
  const cls = v => ({ high: 'bad', error: 'bad', medium: 'warn', warning: 'warn' }[v] || 'info');
  const tag = v => `<span class="tag ${cls(v)}">${esc(LBL[v] || v)}</span>`;
  const list = a => a && a.length ? `<ul class="list">${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="small-note">Tidak ada.</p>';
  const stamp = e => `<p class="small-note">Dibuat ${when(e.createdAt)} oleh ${esc(e.model)}. Hasil AI bisa keliru, verifikasi sebelum diterapkan.</p>`;
  const score = (n, label) => n == null ? '' : `<div class="score-row"><span class="score ${n >= 80 ? '' : n >= 50 ? 'mid' : 'low'}">${n}</span><b>${label}</b></div>`;
  const dis = () => (!st().configured || ai.busy) ? 'disabled' : '';
  const excerpt = (c, a, b, max = 14) => {
    const ls = c.split('\n').slice(a - 1, Math.min(b, a - 1 + max)).map(l => l.length > 200 ? l.slice(0, 200) + '…' : l);
    return ls.join('\n') + (b - a + 1 > max ? '\n…' : '');
  };
  function md(src) {
    const inline = s => s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    let out = '', open = false; const close = () => { if (open) { out += '</ul>'; open = false; } };
    for (const l of esc(src).split('\n')) {
      let m;
      if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) { close(); const n = Math.min(m[1].length + 1, 5); out += `<h${n}>${inline(m[2])}</h${n}>`; }
      else if ((m = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(l))) { if (!open) { out += '<ul>'; open = true; } out += `<li>${inline(m[1])}</li>`; }
      else if (/^-{3,}$/.test(l.trim())) { close(); out += '<hr>'; }
      else if (!l.trim()) close();
      else { close(); out += `<p>${inline(l)}</p>`; }
    }
    close(); return out;
  }

  // ---------- Panel ----------
  const runBtn = (task, label) => `<button class="btn primary small" data-ai-run="${task}" ${dis()}>${ai.busy === task ? 'Memproses…' : cur(task) ? 'Analisis ulang' : label}</button>`;
  const loading = () => ai.busy && ai.busy !== 'all' ? '<div class="ai-loading"><div class="bar-track"><div class="bar-fill" data-w="100"></div></div><p class="small-note">AI sedang menganalisis. Biasanya 10 sampai 60 detik.</p></div>' : '';
  const picker = () => {
    const f = filesOf(ai.lang); if (ai.file >= f.length) ai.file = 0;
    return `<div class="seg">${['html', 'css', 'js'].map(l => `<button data-ai-lang="${l}" class="${ai.lang === l ? 'active' : ''}">${l.toUpperCase()}</button>`).join('')}</div>
      ${f.length > 1 ? `<select id="aiFileSel" aria-label="Pilih berkas">${f.map((x, i) => `<option value="${i}" ${i === ai.file ? 'selected' : ''}>${esc(x.url || x.name)} (${bytes(x.size || 0)})</option>`).join('')}</select>` : ''}`;
  };
  const recList = a => a && a.length ? a.map(r => `<div class="issue ${r.priority === 'high' ? 'error' : r.priority === 'medium' ? 'warn' : ''}">${tag(r.priority)} ${r.area ? `<b>${esc(r.area)}</b>` : ''}
    ${r.problem ? `<p>${esc(r.problem)}</p>` : ''}<p><b>Tindakan:</b> ${esc(r.action)}</p>${r.example ? `<pre class="code"><code>${esc(r.example)}</code></pre>` : ''}</div>`).join('') : '<p class="small-note">Tidak ada.</p>';
  const details = (t, o) => `<details><summary>${t}</summary><pre class="code"><code>${esc(typeof o === 'string' ? o : JSON.stringify(o, null, 2))}</code></pre></details>`;

  const PANELS = {
    report() {
      const e = ai.tasks.report, p = ai.progress;
      const run = `<div class="card sub-card"><b>Analisis AI lengkap</b>
        <p class="small-note">Menjalankan struktur, SEO, performa, dan pemeriksaan kesalahan (berkas HTML, serta berkas CSS dan JS pertama), lalu menyusun laporan otomatis. Pilih berkas lain di tab Kesalahan kode bila perlu.</p>
        <button class="btn primary" data-ai-all ${dis()}>${ai.busy === 'all' ? 'Memproses…' : e ? 'Jalankan ulang semua' : 'Jalankan analisis AI lengkap'}</button>
        ${p ? `<div class="progress-head" style="margin-top:14px"><b>${esc(p.label)}</b><span>${p.i + 1}/${p.total}</span></div><div class="bar-track"><div class="bar-fill" data-w="${Math.round(p.i / p.total * 100)}"></div></div>` : ''}</div>`;
      if (!e) return run + '<p class="small-note">Belum ada laporan AI untuk hasil ini.</p>';
      return run + `<div class="code-bar"><button class="btn small" id="aiCopy">Copy Markdown</button><button class="btn small" data-export="ai-md">Download .md</button><button class="btn small" data-export="ai-pdf">Download PDF</button></div>
        <div class="md">${md(e.data.markdown)}</div>${stamp(e)}`;
    },
    explain() {
      const e = cur('explain'), d = e && e.data, f = filesOf(ai.lang)[ai.file];
      return `<div class="code-bar">${picker()}<span class="spacer"></span>${f ? runBtn('explain', 'Jelaskan kode') : ''}</div>${loading()}
        ${!f ? '<div class="empty">Tidak ada berkas pada kategori ini.</div>' : !d ? '<p class="small-note">Pilih berkas lalu jalankan penjelasan. AI akan menguraikan fungsi tiap bagian kode.</p>' : `
        <p>${esc(d.overview)}</p>${d.truncated ? `<p class="small-note">Hanya ${d.sentLines} dari ${d.totalLines} baris pertama yang dianalisis.</p>` : ''}
        ${d.sections.map(s => `<div class="card sub-card"><div class="card-head"><b>${esc(s.title)}</b><span class="tag">baris ${s.start_line}${s.end_line > s.start_line ? '-' + s.end_line : ''}</span></div><p>${esc(s.explanation)}</p>
        <details><summary>Lihat kode</summary><pre class="code"><code>${esc(excerpt(f.content, s.start_line, s.end_line))}</code></pre></details></div>`).join('')}
        ${d.notes.length ? `<h4>Catatan</h4>${list(d.notes)}` : ''}${stamp(e)}`}`;
    },
    errors() {
      const e = cur('errors'), d = e && e.data, f = filesOf(ai.lang)[ai.file];
      return `<div class="code-bar">${picker()}<span class="spacer"></span>${f ? runBtn('errors', 'Deteksi kesalahan') : ''}</div>${loading()}
        ${!f ? '<div class="empty">Tidak ada berkas pada kategori ini.</div>' : !d ? '<p class="small-note">Pilih berkas lalu jalankan deteksi. AI hanya melaporkan kesalahan yang dapat dibuktikan dari kode.</p>' : `
        <p>${esc(d.summary)}</p>${d.truncated ? `<p class="small-note">Hanya ${d.sentLines} dari ${d.totalLines} baris pertama yang diperiksa.</p>` : ''}
        ${d.issues.length ? d.issues.map(i => `<div class="issue ${i.severity}">${tag(i.severity)} ${i.line ? `<span class="tag">baris ${i.line}</span>` : ''}<p>${esc(i.message)}</p>
          ${i.line && f.content.split('\n')[i.line - 1] !== undefined ? `<pre class="code"><code>${esc(f.content.split('\n')[i.line - 1].slice(0, 220))}</code></pre>` : ''}
          <p><b>Saran:</b> ${esc(i.suggestion)}</p>${i.fix_example ? `<pre class="code"><code>${esc(i.fix_example)}</code></pre>` : ''}</div>`).join('') : '<div class="issue">AI tidak menemukan kesalahan yang dapat dibuktikan pada berkas ini.</div>'}
        ${d.checks ? details('Pemeriksaan otomatis HTML (terukur)', d.checks) : ''}${stamp(e)}`}`;
    },
    seo() {
      const e = cur('seo'), d = e && e.data;
      return `<div class="code-bar">${runBtn('seo', 'Buat rekomendasi SEO')}</div>${loading()}
        ${!d ? '<p class="small-note">AI memeriksa metadata, heading, tautan, dan konten halaman ini lalu menyusun rekomendasi berprioritas.</p>' : `
        ${score(d.score, 'Skor SEO menurut AI')}<p>${esc(d.summary)}</p><h4>Rekomendasi</h4>${recList(d.recommendations)}
        <h4>Quick wins</h4>${list(d.quick_wins)}${details('Data terukur yang dikirim ke AI', d.facts)}${stamp(e)}`}`;
    },
    structure() {
      const e = cur('structure'), d = e && e.data;
      return `<div class="code-bar">${runBtn('structure', 'Analisis struktur')}</div>${loading()}
        ${!d ? '<p class="small-note">AI menganalisis outline DOM, HTML semantik, dan organisasi halaman berdasarkan data yang diukur server.</p>' : `
        ${score(d.semantic_score, 'Skor semantik HTML')}<p>${esc(d.summary)}</p><h4>Arsitektur</h4><p>${esc(d.architecture)}</p>
        <h4>Bagian halaman</h4>${d.page_sections.length ? `<ul class="list">${d.page_sections.map(p => `<li><b>${esc(p.name)}</b> <small>${esc(p.role)}</small></li>`).join('')}</ul>` : '<p class="small-note">Tidak ada.</p>'}
        <div class="grid-2"><div><h4>Kekuatan</h4>${list(d.strengths)}</div><div><h4>Kelemahan</h4>${list(d.weaknesses)}</div></div>
        <h4>Aksesibilitas</h4>${list(d.accessibility)}<h4>Rekomendasi</h4>${recList(d.recommendations)}
        ${details('Outline DOM terukur', d.facts.outline)}${details('Fakta struktur', { ...d.facts, outline: undefined, headingOutline: undefined })}${stamp(e)}`}`;
    },
    performance() {
      const e = cur('performance'), d = e && e.data;
      return `<div class="code-bar">${runBtn('performance', 'Analisis performa')}</div>${loading()}
        ${!d ? '<p class="small-note">AI menilai ukuran aset, script pemblokir render, gambar, dan pihak ketiga dari data yang diukur server. Ini bukan pengukuran Lighthouse.</p>' : `
        ${score(d.score, 'Skor performa menurut AI')}<p>${esc(d.summary)}</p><h4>Hambatan dan perbaikan</h4>
        ${d.bottlenecks.length ? d.bottlenecks.map(b => `<div class="issue ${b.impact === 'high' ? 'error' : b.impact === 'medium' ? 'warn' : ''}">${tag(b.impact)} <b>${esc(b.issue)}</b>
          ${b.evidence ? `<p class="small-note">Bukti: ${esc(b.evidence)}</p>` : ''}<p><b>Perbaikan:</b> ${esc(b.fix)}</p></div>`).join('') : '<p class="small-note">Tidak ada.</p>'}
        <h4>Quick wins</h4>${list(d.quick_wins)}${details('Data performa terukur', d.facts)}${stamp(e)}`}`;
    },
  };

  function render() {
    const s = st();
    return `${s.configured
      ? `<p class="small-note">Model: ${esc(s.model)}. Kode dan metadata halaman ini dikirim ke Anthropic API untuk dianalisis; hasilnya disimpan di server Anda.</p>`
      : '<div class="error-box">Fitur AI belum aktif. Setel variabel lingkungan <code>ANTHROPIC_API_KEY</code> di server, lalu restart <code>npm start</code>. Hasil AI yang sudah tersimpan tetap bisa dilihat.</div>'}
      <div class="tabs sub-tabs">${SUBS.map(([k, l]) => `<button class="tab ${ai.sub === k ? 'active' : ''}" data-ai-sub="${k}">${l}</button>`).join('')}</div>
      ${ai.error ? `<p class="error-box" role="alert">${esc(ai.error)}</p>` : ''}${PANELS[ai.sub]()}`;
  }

  // ---------- Panggilan backend ----------
  async function call(task, extra, refresh) {
    const r = await api(`/api/ai/${state.result.id}/${task}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...extra, refresh: !!refresh }) });
    ai.tasks[r.key] = r; return r;
  }
  async function runOne(task) {
    if (ai.busy) return;
    ai.busy = task; ai.error = ''; redraw();
    try { await call(task, (task === 'explain' || task === 'errors') ? { lang: ai.lang, file: ai.file } : {}, !!cur(task)); toast('Analisis AI selesai', 'ok'); }
    catch (e) { ai.error = e.message; }
    ai.busy = null; redraw();
  }
  async function runAll() {
    if (ai.busy) return;
    const refresh = !!ai.tasks.report;
    const steps = [['structure', {}, 'Menganalisis struktur'], ['seo', {}, 'Menyusun rekomendasi SEO'], ['performance', {}, 'Menganalisis performa'], ['errors', { lang: 'html', file: 0 }, 'Memeriksa kesalahan HTML']];
    if (filesOf('css').length) steps.push(['errors', { lang: 'css', file: 0 }, 'Memeriksa kesalahan CSS']);
    if (filesOf('js').length) steps.push(['errors', { lang: 'js', file: 0 }, 'Memeriksa kesalahan JavaScript']);
    steps.push(['report', {}, 'Menyusun laporan akhir']);
    ai.busy = 'all'; ai.error = ''; ai.sub = 'report'; const failed = [];
    for (let i = 0; i < steps.length; i++) {
      ai.progress = { i, total: steps.length, label: steps[i][2] + '…' }; redraw();
      try { await call(steps[i][0], steps[i][1], refresh); }
      catch (e) { failed.push(`${steps[i][2]}: ${e.message}`); if ([429, 503].includes(e.status)) break; }
    }
    ai.progress = null; ai.busy = null;
    if (failed.length) { ai.error = 'Sebagian langkah gagal. ' + failed.join(' | '); toast('Analisis selesai sebagian', 'error'); } else toast('Laporan AI siap', 'ok');
    redraw();
  }

  function bind() {
    const root = $('#tabBody');
    $$('[data-ai-sub]', root).forEach(b => b.addEventListener('click', () => { ai.sub = b.dataset.aiSub; ai.error = ''; redraw(); }));
    $$('[data-ai-lang]', root).forEach(b => b.addEventListener('click', () => { ai.lang = b.dataset.aiLang; ai.file = 0; ai.error = ''; redraw(); }));
    const sel = $('#aiFileSel', root); if (sel) sel.addEventListener('change', () => { ai.file = +sel.value; ai.error = ''; redraw(); });
    $$('[data-ai-run]', root).forEach(b => b.addEventListener('click', () => runOne(b.dataset.aiRun)));
    $$('[data-ai-all]', root).forEach(b => b.addEventListener('click', runAll));
    $$('[data-export]', root).forEach(b => b.addEventListener('click', () => doExport(b)));
    const cp = $('#aiCopy', root);
    if (cp) cp.addEventListener('click', () => navigator.clipboard.writeText(ai.tasks.report.data.markdown).then(() => toast('Laporan disalin', 'ok'), () => toast('Gagal menyalin. Izinkan akses clipboard.', 'error')));
    $$('[data-w]', root).forEach(e => { e.style.width = e.dataset.w + '%'; });
  }

  async function reset(r) {
    Object.assign(ai, { sub: 'report', lang: 'html', file: 0, tasks: {}, busy: null, error: '', progress: null });
    try { const d = await api('/api/ai/' + r.id); if (state.result && state.result.id === r.id) { ai.tasks = d.tasks || {}; redraw(); } } catch { /* tanpa hasil tersimpan */ }
  }
  function open(sub, lang, file) { ai.sub = sub; ai.lang = lang; ai.file = file; ai.error = ''; state.tab = 'ai'; drawTab(); }

  window.NexoraAI = { render, bind, reset, open, hasReport: () => !!ai.tasks.report };
})();
