'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const QRCode = require('qrcode');
const store = require('./store');
const vision = require('./vision');
const links = require('./links');
const { DATA_DIR } = require('./db');

const PHOTOS = path.join(DATA_DIR, 'photos');
const upload = multer({
  storage: multer.diskStorage({
    destination: PHOTOS,
    filename: (req, file, cb) => cb(null, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + (path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '') || '.jpg'))
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype))
});

function publicBase(req) { return (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, ''); }
const wrap = (fn) => (req, res) => { try { const out = fn(req, res); if (out !== undefined) res.json(out); } catch (e) { res.status(400).json({ error: e.message }); } };

const r = express.Router();
r.use(express.json({ limit: '1mb' }));

r.get('/state', wrap(() => Object.assign(store.state(), { vision: vision.enabled() })));

r.post('/containers', wrap((req) => store.createContainer(req.body || {})));
r.patch('/containers/:id', wrap((req) => store.updateContainer(req.params.id, req.body || {})));
r.delete('/containers/:id', wrap((req) => ({ ok: store.deleteContainer(req.params.id) })));
r.get('/containers/:id/qr.svg', async (req, res) => {
  const c = store.getContainer(req.params.id); if (!c) return res.status(404).end();
  const svg = await QRCode.toString(publicBase(req) + '/#/c/' + encodeURIComponent(c.id), { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
  res.type('image/svg+xml').send(svg);
});

r.post('/parts', wrap((req) => store.createPart(req.body || {})));
r.get('/parts/:id', wrap((req) => { const p = store.getPart(req.params.id); if (!p) throw new Error('Teil nicht gefunden'); return Object.assign(p, { log: store.partLog(p.id) }); }));
r.patch('/parts/:id', wrap((req) => store.updatePart(req.params.id, req.body || {})));
r.delete('/parts/:id', wrap((req) => ({ ok: store.deletePart(req.params.id) })));
r.post('/parts/:id/stock', wrap((req) => store.adjustStock(req.params.id, (req.body || {}).delta, (req.body || {}).reason)));
r.put('/parts/:id/fits/:dim/:fit', wrap((req) => { const b = req.body || {}; return store.setFit(req.params.id, req.params.dim, req.params.fit, b.value, b.material, b.note); }));
r.delete('/parts/:id/fits/:dim/:fit', wrap((req) => store.setFit(req.params.id, req.params.dim, req.params.fit, null)));

// Bezugsquellen
const awrap = (fn) => (req, res) => Promise.resolve().then(() => fn(req, res)).then((out) => res.json(out)).catch((e) => res.status(400).json({ error: e.message }));
r.post('/parts/:id/links', awrap(async (req) => {
  if (!store.getPart(req.params.id)) throw new Error('Teil nicht gefunden');
  const b = req.body || {};
  return store.addLink([+req.params.id], await links.enrich(b, { fetch: b.fetch !== false }))[0];
}));
r.patch('/parts/:id/links/:lid', wrap((req) => store.updateLink(req.params.id, req.params.lid, req.body || {})));
r.post('/parts/:id/links/:lid/refresh', awrap(async (req) => {
  const p = store.getPart(req.params.id); if (!p) throw new Error('Teil nicht gefunden');
  const l = p.links.find((x) => x.id === req.params.lid); if (!l) throw new Error('Link nicht gefunden');
  const n = await links.enrich({ url: l.url });
  return store.updateLink(p.id, l.id, { title: n.title || l.title, price: n.price || l.price, image: n.image || l.image });
}));
r.delete('/parts/:id/links/:lid', wrap((req) => store.removeLink(req.params.id, req.params.lid)));

r.post('/spools', wrap((req) => store.createSpool(req.body || {})));
r.patch('/spools/:id', wrap((req) => store.updateSpool(req.params.id, req.body || {})));
r.delete('/spools/:id', wrap((req) => ({ ok: store.deleteSpool(req.params.id) })));

r.post('/intake', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Kein Bild erhalten (JPEG, PNG, WebP oder HEIC)' });
  const it = store.createIntake(req.file.filename, req.file.mimetype, (req.body && req.body.note) || null);
  if (vision.enabled()) vision.analyze(it);
  res.json(store.getIntake(it.id));
});
r.get('/intake', wrap(() => store.listIntake(false)));
r.get('/intake/:id', wrap((req) => store.getIntake(req.params.id)));
r.get('/intake/:id/photo', (req, res) => {
  const it = store.getIntake(req.params.id); if (!it) return res.status(404).end();
  res.type(it.mime).sendFile(path.join(PHOTOS, path.basename(it.file)));
});
r.post('/intake/:id/resolve', wrap((req) => {
  const it = store.getIntake(req.params.id); if (!it) throw new Error('Foto nicht gefunden');
  const part = store.createPart(Object.assign({}, req.body || {}));
  store.updateIntake(it.id, { status: 'done', note: 'Angelegt als Teil #' + part.id });
  return part;
}));
r.post('/intake/:id/dismiss', wrap((req) => store.updateIntake(req.params.id, { status: 'dismissed' })));

// Druckbares Etikett mit QR-Code
function labelRouter() {
  const l = express.Router();
  l.get('/label/:id', async (req, res) => {
    const c = store.getContainer(req.params.id); if (!c) return res.status(404).send('Organizer nicht gefunden');
    const url = publicBase(req) + '/#/c/' + encodeURIComponent(c.id);
    const svg = await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
    const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    res.send(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Etikett ${esc(c.id)}</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@600&family=IBM+Plex+Sans:wght@500&display=swap" rel="stylesheet">
<style>@page{size:62mm 29mm;margin:0}body{margin:0;font-family:'IBM Plex Sans',sans-serif;background:#eee}
.l{width:62mm;height:29mm;box-sizing:border-box;padding:2.5mm;display:flex;gap:3mm;align-items:center;background:#fff;margin:10mm auto}
.q{width:24mm;height:24mm;flex:0 0 auto}.q svg{width:100%;height:100%}.id{font-family:'IBM Plex Mono',monospace;font-size:16pt;font-weight:600;line-height:1}
.n{font-size:9pt;margin-top:1.5mm;color:#333}.h{font-size:7pt;color:#666;margin-top:1mm}@media print{body{background:#fff}.l{margin:0}.p{display:none}}</style></head>
<body><div class="l"><div class="q">${svg}</div><div><div class="id">${esc(c.id)}</div><div class="n">${esc(c.name)}</div><div class="h">Werkstattlager</div></div></div>
<p class="p" style="text-align:center;font-size:13px;color:#555">Format 62 × 29 mm · <a href="javascript:print()">Drucken</a></p></body></html>`);
  });
  return l;
}

module.exports = { api: r, labelRouter };
