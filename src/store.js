'use strict';
const { db } = require('./db');
const C = require('../public/shared/catalog.js');
const links = require('./links');

// ---------- Organizer-Layouts ----------
function miniLayout() {
  const cells = [];
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 5; x++) cells.push({ x, y, c: 1, r: 1 });
  return { cols: 5, rowsTpl: '0.8fr 1.2fr 1fr', height: 470, cells };
}
function tanosLayout() {
  const cells = [];
  for (let i = 0; i < 5; i++) cells.push({ x: 1, y: i + 1, c: 1, r: 1 });
  for (let i = 0; i < 5; i++) cells.push({ x: 2, y: i + 1, c: 1, r: 1 });
  for (let i = 0; i < 5; i++) cells.push({ x: 3, y: i + 1, c: 2, r: 1 });
  cells.push({ x: 5, y: 1, c: 3, r: 1 });
  for (let i = 0; i < 3; i++) cells.push({ x: 5 + i, y: 2, c: 1, r: 3 });
  for (let i = 0; i < 3; i++) cells.push({ x: 5 + i, y: 5, c: 1, r: 1 });
  return { cols: 7, rowsTpl: 'repeat(5, minmax(0, 1fr))', height: 560, cells };
}
function gridLayout(cols, rows) {
  cols = Math.max(1, Math.min(12, +cols || 4)); rows = Math.max(1, Math.min(12, +rows || 3));
  const cells = [];
  for (let y = 1; y <= rows; y++) for (let x = 1; x <= cols; x++) cells.push({ x, y, c: 1, r: 1 });
  return { cols, rowsTpl: `repeat(${rows}, minmax(0, 1fr))`, height: Math.min(640, 70 + rows * 110), cells };
}
const KINDS = {
  mini: { label: 'Mini-Systainer', prefix: 'MS', make: miniLayout },
  tanos: { label: 'Tanos Organizer', prefix: 'TO', make: tanosLayout },
  grid: { label: 'Raster', prefix: 'OR', make: (o) => gridLayout(o.cols, o.rows) }
};
function cellLabel(cell) { return String.fromCharCode(64 + cell.y) + cell.x; }

function rowToContainer(r) { return r && { id: r.id, name: r.name, kind: r.kind, layout: JSON.parse(r.layout), sort: r.sort }; }
function listContainers() { return db.prepare('SELECT * FROM containers ORDER BY sort, id').all().map(rowToContainer); }
function getContainer(id) { return rowToContainer(db.prepare('SELECT * FROM containers WHERE id = ?').get(id)); }

function nextContainerId(kind) {
  const prefix = (KINDS[kind] || KINDS.grid).prefix;
  const ids = db.prepare('SELECT id FROM containers WHERE id LIKE ?').all(prefix + '-%').map((r) => parseInt(r.id.split('-')[1], 10) || 0);
  const n = (ids.length ? Math.max(...ids) : 0) + 1;
  return `${prefix}-${String(n).padStart(2, '0')}`;
}

function createContainer({ id, name, kind = 'mini', cols, rows }) {
  if (!KINDS[kind]) throw new Error('Unbekannte Organizer-Art: ' + kind);
  id = (id || nextContainerId(kind)).trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{0,15}$/.test(id)) throw new Error('Ungültige Organizer-ID');
  if (getContainer(id)) throw new Error('Organizer ' + id + ' gibt es schon');
  const layout = KINDS[kind].make({ cols, rows });
  const sort = (db.prepare('SELECT MAX(sort) m FROM containers').get().m || 0) + 1;
  db.prepare('INSERT INTO containers (id, name, kind, layout, sort) VALUES (?, ?, ?, ?, ?)').run(id, name || KINDS[kind].label, kind, JSON.stringify(layout), sort);
  return getContainer(id);
}

function updateContainer(id, patch) {
  const c = getContainer(id); if (!c) throw new Error('Organizer nicht gefunden');
  const name = patch.name != null ? String(patch.name) : c.name;
  let kind = c.kind, layout = c.layout;
  if (patch.kind && (patch.kind !== c.kind || patch.kind === 'grid')) {
    if (!KINDS[patch.kind]) throw new Error('Unbekannte Organizer-Art');
    kind = patch.kind; layout = KINDS[kind].make({ cols: patch.cols, rows: patch.rows });
    // Teile in Fächern, die es nicht mehr gibt, verlieren ihren Platz
    db.prepare('UPDATE parts SET cell = NULL, container_id = NULL WHERE container_id = ? AND cell >= ?').run(id, layout.cells.length);
  }
  db.prepare('UPDATE containers SET name = ?, kind = ?, layout = ? WHERE id = ?').run(name, kind, JSON.stringify(layout), id);
  return getContainer(id);
}

function deleteContainer(id) {
  db.prepare('UPDATE parts SET container_id = NULL, cell = NULL WHERE container_id = ?').run(id);
  return db.prepare('DELETE FROM containers WHERE id = ?').run(id).changes > 0;
}

function occupied(containerId) {
  const m = new Map();
  db.prepare('SELECT id, cell FROM parts WHERE container_id = ? AND cell IS NOT NULL').all(containerId).forEach((r) => m.set(r.cell, r.id));
  return m;
}
function freeCells(containerId) {
  const conts = containerId ? [getContainer(containerId)].filter(Boolean) : listContainers();
  const out = [];
  conts.forEach((c) => { const occ = occupied(c.id); c.layout.cells.forEach((cell, i) => { if (!occ.has(i)) out.push({ container_id: c.id, cell: i, label: cellLabel(cell), size: cell.c * cell.r }); }); });
  return out;
}

// ---------- Teile ----------
function rowToPart(r) {
  return r && { id: r.id, type: r.type, params: JSON.parse(r.params), name: r.name, finish: r.finish, stock: r.stock, min_stock: r.min_stock,
    note: r.note, container_id: r.container_id, cell: r.cell, fits: JSON.parse(r.fits || '{}'), links: JSON.parse(r.links || '[]'), created: r.created, updated: r.updated };
}
function locationOf(p, contMap) {
  if (!p.container_id) return null;
  const c = contMap ? contMap.get(p.container_id) : getContainer(p.container_id);
  if (!c) return null;
  const cell = p.cell != null ? c.layout.cells[p.cell] : null;
  return { container_id: c.id, container: c.name, cell: p.cell, fach: cell ? cellLabel(cell) : null, text: c.id + (cell ? ' · Fach ' + cellLabel(cell) : '') };
}
function view(p, contMap) {
  const i = C.info(p);
  return Object.assign({}, p, { info: i, fitTable: C.fitTable(p), location: locationOf(p, contMap), low: p.min_stock > 0 && p.stock < p.min_stock });
}
function contMapAll() { const m = new Map(); listContainers().forEach((c) => m.set(c.id, c)); return m; }
function listParts() { const cm = contMapAll(); return db.prepare('SELECT * FROM parts ORDER BY type, id').all().map(rowToPart).map((p) => view(p, cm)); }
function getPartRaw(id) { return rowToPart(db.prepare('SELECT * FROM parts WHERE id = ?').get(+id)); }
function getPart(id) { const p = getPartRaw(id); return p ? view(p) : null; }

function num(v) { if (v == null || v === '') return undefined; const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : undefined; }

// Größenangabe wie "M4x16", "M3×12", "608ZZ", "6x3" in Parameter auflösen
function resolveParams(type, size, length, params) {
  const T = C.TYPES[type]; if (!T) throw new Error('Unbekannter Teiletyp: ' + type);
  let base = null;
  if (size) {
    let s = String(size).trim().replace(/\s+/g, '').replace(/×/g, 'x');
    let L = num(length);
    const m = /^(M\d+(?:[.,]\d+)?)(?:x(\d+(?:[.,]\d+)?))?$/i.exec(s);
    if (m && T.needsLength) { s = m[1].toUpperCase().replace(',', '.'); if (L == null && m[2]) L = num(m[2]); }
    else if (m && (type === 'nut' || type === 'nyloc' || type === 'washer')) s = m[1].toUpperCase().replace(',', '.');
    else if (type === 'insert') { const im = /^M(\d+(?:\.\d+)?)x(\d+(?:[.,]\d+)?)$/i.exec(s); if (im) s = 'M' + im[1] + '×' + im[2].replace(',', '.'); }
    base = T.fromSize(s, L);
    if (!base && type !== 'custom' && type !== 'magnet' && !params) throw new Error(`Größe "${size}" ist für ${T.label} nicht im Katalog – Maße bitte über params angeben`);
    if (base && T.needsLength && L == null) throw new Error('Länge fehlt (z. B. "M4x16")');
  }
  const out = Object.assign({}, base || {});
  if (params) Object.keys(params).forEach((k) => {
    if (k === 'dims' && Array.isArray(params.dims)) out.dims = params.dims.map((d, i) => ({ key: d.key || 'd' + i, label: String(d.label || 'Maß ' + (i + 1)), value: num(d.value) || 0, kind: ['hole', 'shaft', 'depth', 'clear', 'head', 'trap'].includes(d.kind) ? d.kind : 'hole' }));
    else if (k === 'title' || k === 'code') out[k] = String(params[k]);
    else { const n = num(params[k]); if (n != null) out[k] = n; }
  });
  const missing = T.params.filter((k) => k !== 'pitch' && k !== 'title' && k !== 'dims' && k !== 'code' && out[k] == null);
  if (missing.length && type !== 'custom') throw new Error('Fehlende Maße: ' + missing.join(', '));
  if (T.needsLength && out.pitch == null) out.pitch = 0.5;
  return out;
}

function place(spec) {
  if (spec.container_id === null) return { container_id: null, cell: null };
  if (spec.container_id) {
    const c = getContainer(spec.container_id); if (!c) throw new Error('Organizer nicht gefunden: ' + spec.container_id);
    if (spec.cell != null) {
      let idx = spec.cell;
      if (typeof idx === 'string' && !/^\d+$/.test(idx)) { idx = c.layout.cells.findIndex((cl) => cellLabel(cl) === idx.toUpperCase()); if (idx < 0) throw new Error('Fach nicht gefunden: ' + spec.cell); }
      idx = +idx; if (!c.layout.cells[idx]) throw new Error('Fach nicht gefunden');
      const occ = occupied(c.id); if (occ.has(idx) && occ.get(idx) !== spec.selfId) throw new Error('Fach ' + cellLabel(c.layout.cells[idx]) + ' ist schon belegt');
      return { container_id: c.id, cell: idx };
    }
    const f = freeCells(c.id)[0]; if (!f) throw new Error('Kein freies Fach in ' + c.id);
    return { container_id: c.id, cell: f.cell };
  }
  if (spec.auto) { const f = freeCells()[0]; return f ? { container_id: f.container_id, cell: f.cell } : { container_id: null, cell: null }; }
  return { container_id: null, cell: null };
}

function createPart(spec) {
  const type = spec.type; if (!C.TYPES[type]) throw new Error('Unbekannter Teiletyp: ' + type);
  const params = resolveParams(type, spec.size, spec.length, spec.params);
  const loc = place({ container_id: spec.container_id, cell: spec.cell, auto: spec.auto_place });
  const r = db.prepare('INSERT INTO parts (type, params, name, finish, stock, min_stock, note, container_id, cell) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(type, JSON.stringify(params), spec.name || null, spec.finish || null, Math.max(0, parseInt(spec.stock, 10) || 0), Math.max(0, parseInt(spec.min_stock, 10) || 0), spec.note || null, loc.container_id, loc.cell);
  if (spec.stock) logStock(r.lastInsertRowid, +spec.stock, 'angelegt');
  if (Array.isArray(spec.links) && spec.links.length) setLinks(r.lastInsertRowid, spec.links);
  return getPart(r.lastInsertRowid);
}

function updatePart(id, patch) {
  const p = getPartRaw(id); if (!p) throw new Error('Teil nicht gefunden');
  let params = p.params;
  if (patch.size || patch.params) params = resolveParams(p.type, patch.size, patch.length, Object.assign({}, patch.size ? {} : p.params, patch.params || {}));
  let loc = { container_id: p.container_id, cell: p.cell };
  if ('container_id' in patch) loc = place({ container_id: patch.container_id, cell: patch.cell, selfId: p.id });
  const stock = patch.stock != null ? Math.max(0, parseInt(patch.stock, 10) || 0) : p.stock;
  if (stock !== p.stock) logStock(p.id, stock - p.stock, patch.reason || 'korrigiert');
  db.prepare(`UPDATE parts SET params = ?, name = ?, finish = ?, stock = ?, min_stock = ?, note = ?, container_id = ?, cell = ?, updated = datetime('now') WHERE id = ?`)
    .run(JSON.stringify(params), 'name' in patch ? (patch.name || null) : p.name, 'finish' in patch ? (patch.finish || null) : p.finish, stock,
      patch.min_stock != null ? Math.max(0, parseInt(patch.min_stock, 10) || 0) : p.min_stock, 'note' in patch ? (patch.note || null) : p.note, loc.container_id, loc.cell, p.id);
  if (Array.isArray(patch.links)) setLinks(p.id, patch.links);
  return getPart(p.id);
}

// ---------- Bezugsquellen ----------
function saveLinks(id, list) { db.prepare(`UPDATE parts SET links = ?, updated = datetime('now') WHERE id = ?`).run(JSON.stringify(list), +id); }
// Ersetzt alle Links eines Teils (gleiche URL nur einmal)
function setLinks(id, list) {
  const p = getPartRaw(id); if (!p) throw new Error('Teil nicht gefunden');
  const out = [];
  list.forEach((l) => { const n = links.normalize(l); const old = p.links.find((x) => x.url === n.url); if (old) { n.id = old.id; n.added = old.added; } if (!out.some((x) => x.url === n.url)) out.push(n); });
  saveLinks(p.id, out);
  return getPart(p.id);
}
// Hängt einen Link an ein oder mehrere Teile; gibt es die URL schon, werden nur neue Angaben übernommen
function addLink(ids, link) {
  const n = links.normalize(link);
  return ids.map((id) => {
    const p = getPartRaw(id); if (!p) throw new Error('Teil #' + id + ' nicht gefunden');
    const old = p.links.find((x) => x.url === n.url);
    if (old) ['title', 'price', 'image', 'note', 'shop'].forEach((k) => { if (n[k] && (link[k] || !old[k])) old[k] = n[k]; });
    else p.links.push(Object.assign({}, n, { id: ids.length > 1 ? links.normalize({ url: n.url }).id : n.id }));
    saveLinks(p.id, p.links);
    return getPart(p.id);
  });
}
function updateLink(id, linkId, patch) {
  const p = getPartRaw(id); if (!p) throw new Error('Teil nicht gefunden');
  const l = p.links.find((x) => x.id === linkId); if (!l) throw new Error('Link nicht gefunden');
  ['title', 'price', 'note', 'shop'].forEach((k) => { if (k in patch) l[k] = patch[k] == null || patch[k] === '' ? (k === 'shop' ? links.shopName(l.url) : null) : String(patch[k]).trim().slice(0, k === 'note' ? 300 : 200); });
  if ('image' in patch) l.image = patch.image && /^https?:\/\//i.test(patch.image) ? String(patch.image).slice(0, 1000) : null;
  if (patch.url) { const c = links.canonical(patch.url); if (p.links.some((x) => x !== l && x.url === c)) throw new Error('Diesen Link gibt es bei dem Teil schon'); l.url = c; }
  saveLinks(p.id, p.links);
  return getPart(p.id);
}
function removeLink(id, linkId) {
  const p = getPartRaw(id); if (!p) throw new Error('Teil nicht gefunden');
  const next = p.links.filter((x) => x.id !== linkId && x.url !== linkId);
  if (next.length === p.links.length) throw new Error('Link nicht gefunden');
  saveLinks(p.id, next);
  return getPart(p.id);
}

function deletePart(id) { return db.prepare('DELETE FROM parts WHERE id = ?').run(+id).changes > 0; }
function logStock(id, delta, reason) { if (delta) db.prepare('INSERT INTO log (part_id, delta, reason) VALUES (?, ?, ?)').run(+id, delta, reason || null); }
function adjustStock(id, delta, reason) {
  const p = getPartRaw(id); if (!p) throw new Error('Teil nicht gefunden');
  const next = Math.max(0, p.stock + (parseInt(delta, 10) || 0));
  db.prepare(`UPDATE parts SET stock = ?, updated = datetime('now') WHERE id = ?`).run(next, p.id);
  logStock(p.id, next - p.stock, reason);
  return getPart(p.id);
}
function partLog(id, limit = 20) { return db.prepare('SELECT delta, reason, at FROM log WHERE part_id = ? ORDER BY id DESC LIMIT ?').all(+id, limit); }

const FITS = ['press', 'snap', 'loose'];
function setFit(id, dimKey, fit, value, material, note) {
  const p = getPartRaw(id); if (!p) throw new Error('Teil nicht gefunden');
  if (!FITS.includes(fit)) throw new Error('Passung muss press, snap oder loose sein');
  if (!C.dims(p).some((d) => d.key === dimKey)) throw new Error('Maß "' + dimKey + '" gibt es bei diesem Teil nicht. Verfügbar: ' + C.dims(p).map((d) => d.key).join(', '));
  const fits = p.fits || {};
  fits[dimKey] = fits[dimKey] || {};
  if (value == null || value === '') delete fits[dimKey][fit];
  else { const v = num(value); if (v == null) throw new Error('Ungültiger Wert'); fits[dimKey][fit] = { value: v, material: material || null, note: note || null, at: new Date().toISOString().slice(0, 10) }; }
  if (!Object.keys(fits[dimKey]).length) delete fits[dimKey];
  db.prepare(`UPDATE parts SET fits = ?, updated = datetime('now') WHERE id = ?`).run(JSON.stringify(fits), p.id);
  return getPart(p.id);
}

// ---------- Suche ----------
function norm(s) { return String(s || '').toLowerCase().replace(/×/g, 'x').replace(/,/g, '.'); }
function haystack(p) { const i = p.info; return norm([i.name, i.size, i.norm, i.typeLabel, i.group, i.mat, i.dims, p.note, p.type, p.location && p.location.text, (p.links || []).map((l) => [l.shop, l.title].join(' ')).join(' ')].join(' ')); }
function searchParts({ query, type, thread, min_length, max_length, in_stock, container_id } = {}) {
  const toks = norm(query).trim().split(/\s+/).filter(Boolean);
  const th = thread != null ? C.threadOf(/^M/i.test(String(thread)) ? thread : 'M' + thread) : null;
  return listParts().filter((p) => {
    if (type && p.type !== type) return false;
    if (th != null && p.params.d !== th) return false;
    if (min_length != null && !(p.params.L >= min_length)) return false;
    if (max_length != null && !(p.params.L <= max_length)) return false;
    if (in_stock && p.stock <= 0) return false;
    if (container_id && p.container_id !== container_id) return false;
    if (toks.length) { const h = haystack(p); return toks.every((t) => h.includes(t)); }
    return true;
  });
}

// ---------- Filament ----------
function listSpools() { return db.prepare('SELECT * FROM spools ORDER BY (ams_slot IS NULL), ams_slot, material, id').all(); }
function getSpool(id) { return db.prepare('SELECT * FROM spools WHERE id = ?').get(+id); }
const SPOOL_FIELDS = ['material', 'color', 'hex', 'vendor', 'rest_g', 'total_g', 'location', 'ams_slot', 'nozzle', 'bed', 'note'];
function cleanSpool(s) {
  const o = {};
  SPOOL_FIELDS.forEach((k) => { if (k in s) o[k] = s[k] === '' ? null : s[k]; });
  ['rest_g', 'total_g', 'ams_slot'].forEach((k) => { if (o[k] != null) o[k] = parseInt(o[k], 10); if (Number.isNaN(o[k])) o[k] = null; });
  if (o.hex && !/^#[0-9a-f]{6}$/i.test(o.hex)) throw new Error('Farbe als #rrggbb angeben');
  return o;
}
function createSpool(s) {
  const o = cleanSpool(s); if (!o.material) throw new Error('Material fehlt');
  const cols = Object.keys(o);
  const r = db.prepare(`INSERT INTO spools (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((k) => o[k]));
  return getSpool(r.lastInsertRowid);
}
function updateSpool(id, s) {
  if (!getSpool(id)) throw new Error('Spule nicht gefunden');
  const o = cleanSpool(s); const cols = Object.keys(o); if (!cols.length) return getSpool(id);
  db.prepare(`UPDATE spools SET ${cols.map((k) => k + ' = ?').join(', ')}, updated = datetime('now') WHERE id = ?`).run(...cols.map((k) => o[k]), +id);
  return getSpool(id);
}
function deleteSpool(id) { return db.prepare('DELETE FROM spools WHERE id = ?').run(+id).changes > 0; }

// ---------- Foto-Eingang ----------
function rowToIntake(r) { return r && Object.assign({}, r, { suggestion: r.suggestion ? JSON.parse(r.suggestion) : null }); }
function listIntake(all) { return db.prepare(`SELECT * FROM intake ${all ? '' : "WHERE status NOT IN ('done','dismissed')"} ORDER BY id DESC`).all().map(rowToIntake); }
function getIntake(id) { return rowToIntake(db.prepare('SELECT * FROM intake WHERE id = ?').get(+id)); }
function createIntake(file, mime, note) { const r = db.prepare('INSERT INTO intake (file, mime, note) VALUES (?, ?, ?)').run(file, mime, note || null); return getIntake(r.lastInsertRowid); }
function updateIntake(id, patch) {
  const cur = getIntake(id); if (!cur) throw new Error('Foto nicht gefunden');
  db.prepare('UPDATE intake SET status = ?, suggestion = ?, note = ? WHERE id = ?').run(patch.status || cur.status,
    'suggestion' in patch ? (patch.suggestion ? JSON.stringify(patch.suggestion) : null) : (cur.suggestion ? JSON.stringify(cur.suggestion) : null), 'note' in patch ? patch.note : cur.note, +id);
  return getIntake(id);
}

function state() {
  return {
    containers: listContainers().map((c) => Object.assign({}, c, { kindLabel: (KINDS[c.kind] || KINDS.grid).label })),
    parts: listParts(), spools: listSpools(), intake: listIntake(false),
    kinds: Object.keys(KINDS).map((k) => ({ key: k, label: KINDS[k].label }))
  };
}

function seedIfEmpty() {
  if (db.prepare('SELECT COUNT(*) n FROM containers').get().n) return;
  createContainer({ id: 'MS-01', name: 'Mini-Systainer 1', kind: 'mini' });
  createContainer({ id: 'TO-01', name: 'Tanos Organizer 1', kind: 'tanos' });
}

module.exports = {
  KINDS, cellLabel, listContainers, getContainer, createContainer, updateContainer, deleteContainer, freeCells,
  listParts, getPart, createPart, updatePart, deletePart, setLinks, addLink, updateLink, removeLink, adjustStock, partLog, setFit, searchParts, resolveParams,
  listSpools, getSpool, createSpool, updateSpool, deleteSpool,
  listIntake, getIntake, createIntake, updateIntake, state, seedIfEmpty
};
