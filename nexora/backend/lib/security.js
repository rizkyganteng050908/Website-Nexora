'use strict';
// Proteksi SSRF: validasi URL + blokir IP privat/loopback/link-local pada saat DNS lookup.
const dns = require('dns');
const net = require('net');

const blocked = new net.BlockList();
[['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
 ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
 ['224.0.0.0', 4], ['240.0.0.0', 4]].forEach(([a, p]) => blocked.addSubnet(a, p, 'ipv4'));
[['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96]]
  .forEach(([a, p]) => blocked.addSubnet(a, p, 'ipv6'));

function isBlockedIp(ip) {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (m) ip = m[1];
  const fam = net.isIP(ip);
  if (!fam) return true;
  return blocked.check(ip, fam === 4 ? 'ipv4' : 'ipv6');
}

function ssrfError(host) {
  const e = new Error(`Tujuan "${host}" diblokir oleh proteksi SSRF (alamat internal/privat tidak diizinkan).`);
  e.code = 'ESSRF';
  return e;
}

function validateUrl(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('URL wajib diisi.');
  let raw = input.trim();
  if (raw.length > 2048) throw new Error('URL terlalu panjang (maksimal 2048 karakter).');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = 'https://' + raw;
  let u;
  try { u = new URL(raw); } catch { throw new Error('Format URL tidak valid.'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Hanya protokol http dan https yang diizinkan.');
  if (u.username || u.password) throw new Error('URL yang berisi kredensial tidak diizinkan.');
  if (u.port && !['80', '443'].includes(u.port)) throw new Error('Hanya port 80 dan 443 yang diizinkan.');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || /\.(localhost|local|internal|lan|home)$/.test(host)) throw ssrfError(host);
  if (net.isIP(host)) { if (isBlockedIp(host)) throw ssrfError(host); }
  else if (!host.includes('.')) throw new Error('Nama host tidak valid.');
  u.hash = '';
  return u;
}

// Dipakai sebagai opsi `lookup` http(s).request: IP yang diverifikasi = IP yang dipakai untuk koneksi
// (mencegah DNS rebinding).
function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length || addrs.some(a => isBlockedIp(a.address))) return cb(ssrfError(hostname));
    if (options && options.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}

module.exports = { validateUrl, safeLookup, isBlockedIp };
