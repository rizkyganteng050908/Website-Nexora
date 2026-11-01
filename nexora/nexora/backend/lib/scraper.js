'use strict';
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const cheerio = require('cheerio');
const robotsParser = require('robots-parser');
const { validateUrl, safeLookup } = require('./security');

const UA = 'NexoraBot/1.0 (developer analysis tool; respects robots.txt)';
const LIMITS = {
  html: 5 * 1024 * 1024, asset: 1024 * 1024, image: 2 * 1024 * 1024, robots: 200 * 1024,
  requestMs: 10000, totalMs: 60000, maxCss: 10, maxJs: 10, maxImages: 200, maxLinks: 300,
};

/** GET aman: validasi URL tiap hop, DNS pinning, batas ukuran & waktu, tanpa cookie/auth. */
function get(rawUrl, { maxBytes = LIMITS.asset, accept, timeoutMs = LIMITS.requestMs, deadline, hops = 0 } = {}) {
  return new Promise((resolve, reject) => {
    if (deadline && Date.now() > deadline) return reject(new Error('Batas waktu scraping (60 detik) terlampaui.'));
    let url;
    try { url = validateUrl(rawUrl); } catch (e) { return reject(e); }
    const hardMs = Math.max(1000, Math.min(20000, deadline ? deadline - Date.now() : 20000));
    let hard;
    const ok = v => { clearTimeout(hard); resolve(v); };
    const fail = e => { clearTimeout(hard); reject(e); };
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, {
      method: 'GET', lookup: safeLookup,
      headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Encoding': 'gzip, deflate, br' },
    }, res => {
      const code = res.statusCode;
      if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
        res.resume();
        clearTimeout(hard);
        if (hops >= 5) return reject(new Error('Terlalu banyak redirect.'));
        let next;
        try { next = new URL(res.headers.location, url).href; } catch { return reject(new Error('Redirect tidak valid.')); }
        return resolve(get(next, { maxBytes, accept, timeoutMs, deadline, hops: hops + 1 }));
      }
      const type = res.headers['content-type'] || '';
      if (code < 400 && accept && !accept.test(type)) {
        res.destroy();
        return fail(new Error(`Tipe konten tidak didukung: ${type || 'tidak diketahui'}.`));
      }
      if (+res.headers['content-length'] > maxBytes) {
        res.destroy();
        return fail(new Error(`Ukuran file melebihi batas ${(maxBytes / 1048576).toFixed(1)} MB.`));
      }
      const enc = (res.headers['content-encoding'] || '').toLowerCase();
      let stream = res;
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      const chunks = []; let size = 0;
      stream.on('data', c => {
        size += c.length;
        if (size > maxBytes) { req.destroy(); fail(new Error('Ukuran file melebihi batas yang diizinkan.')); }
        else chunks.push(c);
      });
      stream.on('end', () => ok({ status: code, headers: res.headers, body: Buffer.concat(chunks), url: url.href }));
      stream.on('error', fail);
      res.on('error', fail);
    });
    hard = setTimeout(() => req.destroy(new Error('Waktu unduhan terlampaui.')), hardMs);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Koneksi ke server timeout.')));
    req.on('error', fail);
    req.end();
  });
}

// ---- robots.txt ----
const robotsCache = new Map();
async function robotsFor(origin, deadline) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  let p = null;
  try {
    const r = await get(origin + '/robots.txt', { maxBytes: LIMITS.robots, deadline, timeoutMs: 5000 });
    if (r.status >= 500) p = { isAllowed: () => false };
    else if (r.status < 300) p = robotsParser(origin + '/robots.txt', r.body.toString('utf8'));
  } catch { p = null; }
  if (robotsCache.size > 200) robotsCache.clear();
  robotsCache.set(origin, p);
  return p;
}
async function allowed(url, deadline) {
  const p = await robotsFor(new URL(url).origin, deadline);
  return !p || p.isAllowed(url, 'NexoraBot') !== false;
}

// ---- util ----
const TECH = [['WordPress', /wp-content|wp-includes/i], ['Next.js', /_next\//i], ['React', /react(\.min)?\.js|data-reactroot|__NEXT_DATA__/i],
  ['Vue.js', /vue(\.min)?\.js|data-v-[0-9a-f]|__vue/i], ['Angular', /ng-version|angular(\.min)?\.js/i], ['jQuery', /jquery/i],
  ['Bootstrap', /bootstrap/i], ['Tailwind CSS', /tailwind/i], ['Shopify', /cdn\.shopify\.com/i],
  ['Google Analytics/GTM', /googletagmanager|google-analytics|gtag\(/i], ['Cloudflare', /cloudflare/i]];

const fname = (u, ext, i) => {
  let b = '';
  try { b = decodeURIComponent(new URL(u).pathname.split('/').filter(Boolean).pop() || ''); } catch {}
  b = b.replace(/[^\w.-]/g, '_').slice(0, 60);
  if (!b.toLowerCase().endsWith('.' + ext)) b = (b || ext) + '.' + ext;
  return `${i + 1}-${b}`;
};

function cssStats(list) {
  const all = list.map(c => c.content || '').join('\n');
  const count = (re, f) => { const o = {}; (all.match(re) || []).forEach(x => { x = f(x); if (x) o[x] = (o[x] || 0) + 1; }); return o; };
  const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => k);
  return {
    rules: (all.match(/\{/g) || []).length, mediaQueries: (all.match(/@media/g) || []).length,
    variables: (all.match(/--[\w-]+\s*:/g) || []).length,
    topColors: top(count(/#[0-9a-f]{3,8}\b/gi, c => c.toLowerCase())),
    topFonts: top(count(/font-family\s*:\s*[^;}]+/gi, f => f.split(':')[1].split(',')[0].trim().replace(/['"]/g, ''))),
  };
}

async function fetchTextAssets(urls, kind, accept, deadline) {
  return Promise.all(urls.map(async (url, i) => {
    const base = { type: 'external', url, name: fname(url, kind, i) };
    try {
      if (!(await allowed(url, deadline))) return { ...base, error: 'Diblokir oleh robots.txt' };
      const r = await get(url, { maxBytes: LIMITS.asset, accept, deadline });
      if (r.status >= 400) return { ...base, error: `HTTP ${r.status}` };
      const content = r.body.toString('utf8');
      return { ...base, size: r.body.length, content };
    } catch (e) { return { ...base, error: e.message }; }
  }));
}

async function analyze(rawUrl, emit = () => {}) {
  const t0 = Date.now(), deadline = t0 + LIMITS.totalMs;
  const step = (percent, message) => emit({ type: 'progress', percent, message });

  step(3, 'Memvalidasi URL dan proteksi SSRF…');
  const target = validateUrl(rawUrl);

  step(8, 'Memeriksa robots.txt…');
  if (!(await allowed(target.href, deadline))) throw new Error('Halaman ini dilarang oleh robots.txt. NEXORA menghormati aturan tersebut dan tidak melanjutkan.');

  step(15, 'Mengunduh HTML…');
  const page = await get(target.href, { maxBytes: LIMITS.html, accept: /text\/html|application\/xhtml/i, deadline });
  if (page.status === 401 || page.status === 403) throw new Error(`Halaman membutuhkan autentikasi atau akses ditolak (HTTP ${page.status}). NEXORA tidak melewati autentikasi.`);
  if (page.status >= 400) throw new Error(`Server tujuan merespons HTTP ${page.status}.`);
  if (page.url !== target.href && !(await allowed(page.url, deadline))) throw new Error('Halaman tujuan redirect dilarang oleh robots.txt.');

  step(28, 'Mem-parsing struktur dokumen…');
  const html = page.body.toString('utf8');
  const $ = cheerio.load(html);
  let base = new URL(page.url);
  const baseHref = $('base[href]').attr('href');
  if (baseHref) { try { base = new URL(baseHref, base); } catch {} }
  const abs = v => {
    if (!v) return null;
    try { const u = new URL(String(v).trim(), base); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; }
  };
  const uniq = a => [...new Set(a.filter(Boolean))];

  // SEO
  const meta = n => $(`meta[name="${n}"]`).attr('content') || null;
  const prop = p => $(`meta[property="${p}"]`).attr('content') || null;
  const h = {}; for (let i = 1; i <= 6; i++) h['h' + i] = $('h' + i).length;
  const imgNoAlt = $('img').filter((_, el) => $(el).attr('alt') === undefined).length;
  const seo = {
    title: $('title').first().text().trim() || null, description: meta('description'), keywords: meta('keywords'),
    robots: meta('robots'), viewport: meta('viewport'), charset: $('meta[charset]').attr('charset') || null,
    lang: $('html').attr('lang') || null, canonical: abs($('link[rel="canonical"]').attr('href')),
    og: { title: prop('og:title'), description: prop('og:description'), image: abs(prop('og:image')), type: prop('og:type'), url: prop('og:url') },
    twitterCard: meta('twitter:card'), headings: h,
    h1: $('h1').map((_, el) => $(el).text().trim().slice(0, 120)).get().slice(0, 5), imagesWithoutAlt: imgNoAlt,
  };
  const issues = []; const add = (level, message) => issues.push({ level, message });
  if (!seo.title) add('error', 'Tag <title> tidak ditemukan.');
  else if (seo.title.length < 10 || seo.title.length > 60) add('warn', `Panjang title ${seo.title.length} karakter (ideal 10–60).`);
  if (!seo.description) add('error', 'Meta description tidak ditemukan.');
  else if (seo.description.length > 160) add('warn', `Meta description ${seo.description.length} karakter (ideal ≤160).`);
  if (h.h1 === 0) add('error', 'Tidak ada heading H1.'); else if (h.h1 > 1) add('warn', `Terdapat ${h.h1} heading H1 (ideal 1).`);
  if (!seo.viewport) add('warn', 'Meta viewport tidak ada (tidak ramah mobile).');
  if (!seo.lang) add('warn', 'Atribut lang pada <html> tidak ada.');
  if (imgNoAlt) add('warn', `${imgNoAlt} gambar tanpa atribut alt.`);
  if (!seo.canonical) add('info', 'Link canonical tidak ditemukan.');
  if (!seo.og.title) add('info', 'Open Graph (og:title) tidak ditemukan.');
  const count = l => issues.filter(i => i.level === l).length;
  seo.issues = issues;
  seo.score = Math.max(0, 100 - count('error') * 20 - count('warn') * 8 - count('info') * 3);

  // CSS
  step(40, 'Menganalisis CSS…');
  const css = [];
  $('style').each((_, el) => { const t = $(el).text(); if (t.trim()) css.push({ type: 'inline', name: `inline-${css.length + 1}.css`, url: null, size: Buffer.byteLength(t), content: t }); });
  const cssUrls = uniq($('link[rel~="stylesheet"][href]').map((_, el) => abs($(el).attr('href'))).get());
  css.push(...await fetchTextAssets(cssUrls.slice(0, LIMITS.maxCss), 'css', /css|text\/plain/i, deadline));
  cssUrls.slice(LIMITS.maxCss).forEach(u => css.push({ type: 'external', url: u, name: null, error: 'Dilewati (melebihi batas jumlah berkas)' }));

  // JS
  step(58, 'Mengidentifikasi JavaScript…');
  const js = [];
  $('script:not([src])').each((_, el) => {
    const type = ($(el).attr('type') || '').toLowerCase(); const t = $(el).html() || '';
    if (t.trim() && (!type || /javascript|module/.test(type))) js.push({ type: 'inline', name: `inline-${js.length + 1}.js`, url: null, size: Buffer.byteLength(t), content: t });
  });
  const jsUrls = uniq($('script[src]').map((_, el) => abs($(el).attr('src'))).get());
  const jsFetched = await fetchTextAssets(jsUrls.slice(0, LIMITS.maxJs), 'js', /javascript|ecmascript|text\/plain/i, deadline);
  jsFetched.forEach(j => { j.thirdParty = new URL(j.url).hostname !== base.hostname; });
  js.push(...jsFetched);
  jsUrls.slice(LIMITS.maxJs).forEach(u => js.push({ type: 'external', url: u, name: null, thirdParty: new URL(u).hostname !== base.hostname, error: 'Dilewati (melebihi batas jumlah berkas)' }));

  // Gambar & aset
  step(75, 'Mengumpulkan gambar dan aset publik…');
  const imgs = new Map();
  const addImg = (u, kind, alt) => { const a = abs(u); if (a && !imgs.has(a) && imgs.size < LIMITS.maxImages) imgs.set(a, { url: a, kind, alt: alt ?? null }); };
  $('img').each((_, el) => {
    const $el = $(el);
    addImg($el.attr('src') || $el.attr('data-src'), 'img', $el.attr('alt'));
    const ss = $el.attr('srcset'); if (ss) addImg(ss.split(',')[0].trim().split(/\s+/)[0], 'img', $el.attr('alt'));
  });
  $('source[srcset]').each((_, el) => addImg($(el).attr('srcset').split(',')[0].trim().split(/\s+/)[0], 'source'));
  $('link[rel~="icon"], link[rel="apple-touch-icon"]').each((_, el) => addImg($(el).attr('href'), 'icon'));
  addImg(seo.og.image, 'og:image');
  const images = [...imgs.values()];

  // Tautan
  step(85, 'Mendeteksi tautan internal dan eksternal…');
  const strip = h => h.replace(/^www\./, '');
  const seen = new Map();
  $('a[href]').each((_, el) => {
    const raw = ($(el).attr('href') || '').trim();
    if (!raw || /^(#|javascript:|mailto:|tel:)/i.test(raw)) return;
    const u = abs(raw); if (!u || seen.has(u)) return;
    const internal = strip(new URL(u).hostname) === strip(base.hostname);
    seen.set(u, { url: u, text: $(el).text().replace(/\s+/g, ' ').trim().slice(0, 80), internal, nofollow: /nofollow/i.test($(el).attr('rel') || '') });
  });
  const all = [...seen.values()];
  const internalLinks = all.filter(l => l.internal), externalLinks = all.filter(l => !l.internal);

  step(94, 'Menyusun laporan analisis…');
  const hdr = page.headers;
  const techText = html + '\n' + jsUrls.join('\n') + '\n' + cssUrls.join('\n') + '\n' + (hdr.server || '');
  return {
    url: target.href, finalUrl: page.url, createdAt: new Date().toISOString(), durationMs: Date.now() - t0,
    http: {
      status: page.status, contentType: hdr['content-type'] || null, server: hdr.server || null, poweredBy: hdr['x-powered-by'] || null,
      cacheControl: hdr['cache-control'] || null, hsts: !!hdr['strict-transport-security'], csp: !!hdr['content-security-policy'],
    },
    tech: TECH.filter(([, re]) => re.test(techText)).map(([n]) => n),
    seo, html, css, js, images,
    links: { internal: internalLinks.slice(0, LIMITS.maxLinks), external: externalLinks.slice(0, LIMITS.maxLinks), totalInternal: internalLinks.length, totalExternal: externalLinks.length },
    stats: { htmlSize: page.body.length, cssStats: cssStats(css), externalJs: jsUrls.length, thirdPartyJs: jsFetched.filter(j => j.thirdParty).length },
  };
}

module.exports = { analyze, get, allowed, LIMITS };
