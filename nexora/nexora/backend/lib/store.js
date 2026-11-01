'use strict';
// Penyimpanan berbasis berkas JSON (riwayat + hasil lengkap).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', 'data');
const RES = path.join(DIR, 'results');
const IDX = path.join(DIR, 'history.json');
const MAX_ENTRIES = 100;
fs.mkdirSync(RES, { recursive: true });

const newId = () => crypto.randomBytes(8).toString('hex');
const validId = id => typeof id === 'string' && /^[a-f0-9]{16}$/.test(id);
const load = () => { try { return JSON.parse(fs.readFileSync(IDX, 'utf8')); } catch { return []; } };
const save = a => { fs.writeFileSync(IDX + '.tmp', JSON.stringify(a)); fs.renameSync(IDX + '.tmp', IDX); };
const rm = id => { try { fs.unlinkSync(path.join(RES, id + '.json')); } catch {} };

function record(entry, result) {
  if (result) fs.writeFileSync(path.join(RES, entry.id + '.json'), JSON.stringify(result));
  const h = load(); h.unshift(entry);
  h.splice(MAX_ENTRIES).forEach(r => rm(r.id));
  save(h);
}
const history = () => load();
function getResult(id) {
  if (!validId(id)) return null;
  try { return JSON.parse(fs.readFileSync(path.join(RES, id + '.json'), 'utf8')); } catch { return null; }
}
function remove(id) { if (!validId(id)) return false; rm(id); save(load().filter(x => x.id !== id)); return true; }
function clear() { load().forEach(x => rm(x.id)); save([]); }

function stats() {
  const h = load(), ok = h.filter(x => x.status === 'success');
  const key = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const daily = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    daily.push({ date: d.toISOString(), count: h.filter(x => key(new Date(x.createdAt)) === key(d)).length });
  }
  return {
    total: h.length, success: ok.length, failed: h.length - ok.length,
    avgMs: ok.length ? Math.round(ok.reduce((a, x) => a + x.durationMs, 0) / ok.length) : 0,
    assets: ok.reduce((a, x) => a + x.summary.imageCount + x.summary.cssCount + x.summary.jsCount, 0), daily,
  };
}
module.exports = { newId, validId, record, history, getResult, remove, clear, stats };
