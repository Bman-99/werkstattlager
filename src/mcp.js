'use strict';
// MCP-Schnittstelle (Streamable HTTP, zustandslos) unter /mcp
const path = require('path');
const fs = require('fs');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const C = require('../public/shared/catalog.js');
const store = require('./store');
const links = require('./links');
const { DATA_DIR } = require('./db');

let sharp = null; try { sharp = require('sharp'); } catch (e) { /* optional */ }

const TYPE_ENUM = Object.keys(C.TYPES);
const FIT_ENUM = ['press', 'snap', 'loose'];
const LINK = z.union([z.string(), z.object({ url: z.string(), title: z.string().optional(), price: z.string().optional(), note: z.string().optional() })]);
const LINKS = z.array(LINK).optional().describe('Purchase links (product pages). Strings or {url, title?, price?, note?}. Title/price/image are read from the page when missing.');
const enrichAll = (list) => Promise.all((list || []).map((l) => links.enrich(l)));

const INSTRUCTIONS = `Werkstattlager: digitales Lager für Kleinteile (Schrauben, Muttern, Scheiben, Kugellager, Einschmelzmuttern, Magnete) und Filament.
Alle Maße in mm. Jedes Teil hat Normmaße und pro Maß 3D-Druck-Passungen: press (Presssitz), snap (Snap-Fit/leichte Klemmung), loose (lose).
Die Passungswerte sind bereits die Werte, die direkt ins CAD gehören (z. B. Bohrung für einen Lagersitz). "measured" markiert am Drucker gemessene Werte; sonst sind es Startwerte.
Vor dem Konstruieren: mit search_parts prüfen, was vorrätig ist, und vorhandene Teile bevorzugen. Nach einem Projekt verbrauchte Teile mit adjust_stock abbuchen (nur nach Bestätigung durch den Nutzer).
Fotos im Eingang (list_intake / get_intake_photo) auswerten und mit resolve_intake anlegen.
Bezugsquellen: Jedes Teil hat "links" mit Produktseiten, wo es gekauft wurde (Shop, Titel, Preis). Zum Nachkaufen diese Links nennen. Neue Links mit add_part_link anhängen – bei Sortimenten einen Link an alle enthaltenen Teile (ids).`;

function compact(p) {
  const fits = {};
  p.fitTable.forEach((r) => {
    fits[r.key] = { label: r.m + ' – ' + r.sub, nominal: r.nom, press: r.values.press, snap: r.values.snap, loose: r.values.loose };
    const meas = Object.keys(r.measured); if (meas.length) fits[r.key].measured = meas;
  });
  return { id: p.id, name: p.info.name, size: p.info.size, type: p.type, norm: p.info.norm, material: p.info.mat, stock: p.stock, min_stock: p.min_stock, low_stock: p.low,
    location: p.location ? p.location.text : null, dimensions: p.params, fits, note: p.note || undefined,
    links: (p.links || []).map((l) => ({ link_id: l.id, url: l.url, shop: l.shop, title: l.title || undefined, price: l.price || undefined, note: l.note || undefined, added: l.added })) };
}
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 1) }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: 'Fehler: ' + (e && e.message ? e.message : String(e)) }] });
const safe = (fn) => async (args) => { try { return await fn(args || {}); } catch (e) { return fail(e); } };

function buildServer() {
  const s = new McpServer({ name: 'werkstattlager', version: require('../package.json').version }, { instructions: INSTRUCTIONS });

  s.registerTool('search_parts', {
    title: 'Teile suchen',
    description: 'Search the parts inventory. All filters optional and combined with AND. Free text also matches shop names and titles of purchase links. Returns stock, location, dimensions, 3D-print fit values per dimension and purchase links.',
    inputSchema: {
      query: z.string().optional().describe('Free text, e.g. "M3 zylinder", "608", "magnet 6"'),
      type: z.enum(TYPE_ENUM).optional().describe('shcs=DIN 912, button=ISO 7380, csk=DIN 7991, nut, nyloc, washer, insert, bearing, magnet, custom'),
      thread: z.string().optional().describe('Thread size, e.g. "M4" or "4"'),
      min_length: z.number().optional().describe('Minimum screw length in mm'),
      max_length: z.number().optional().describe('Maximum screw length in mm'),
      in_stock: z.boolean().optional().describe('Only parts with stock > 0'),
      container_id: z.string().optional()
    }
  }, safe((a) => ok(store.searchParts(a).map(compact))));

  s.registerTool('get_part', {
    title: 'Teil abrufen',
    description: 'Full details of one part: dimensions, fit table (press/snap/loose per dimension, marking measured values), location, purchase links and recent stock changes.',
    inputSchema: { id: z.number().int() }
  }, safe((a) => { const p = store.getPart(a.id); if (!p) throw new Error('Teil nicht gefunden'); return ok(Object.assign(compact(p), { recent_changes: store.partLog(p.id, 10) })); }));

  s.registerTool('get_fit', {
    title: 'CAD-Maße für eine Passung',
    description: 'The CAD values to model a printed feature for this part with the chosen fit, e.g. bearing seat diameter for a snap fit.',
    inputSchema: { id: z.number().int(), fit: z.enum(FIT_ENUM) }
  }, safe((a) => {
    const p = store.getPart(a.id); if (!p) throw new Error('Teil nicht gefunden');
    return ok({ part: p.info.name, fit: a.fit, fit_label: C.FIT_LABEL[a.fit],
      cad_values: p.fitTable.filter((r) => r.values[a.fit] != null).map((r) => ({ dimension: r.key, feature: r.short, nominal: r.nom, cad_mm: r.values[a.fit], source: r.measured[a.fit] ? 'gemessen' : 'Startwert' })) });
  }));

  s.registerTool('check_parts', {
    title: 'Stückliste prüfen',
    description: 'Check a bill of materials against stock. Each item references a part id, or a type+size (e.g. shcs M3x12). Returns availability and shortages.',
    inputSchema: { items: z.array(z.object({ id: z.number().int().optional(), type: z.enum(TYPE_ENUM).optional(), size: z.string().optional(), qty: z.number().int().min(1) })) }
  }, safe((a) => ok(a.items.map((it) => {
    let p = null;
    if (it.id) p = store.getPart(it.id);
    else if (it.type && it.size) {
      const want = store.resolveParams(it.type, it.size);
      p = store.searchParts({ type: it.type }).find((x) => Object.keys(want).every((k) => k === 'pitch' || x.params[k] === want[k])) || null;
    }
    if (!p) return { request: it, found: false, status: 'nicht im Lager' };
    return { request: it, found: true, id: p.id, name: p.info.name, stock: p.stock, location: p.location ? p.location.text : null, status: p.stock >= it.qty ? 'ausreichend' : `fehlt: ${it.qty - p.stock}` };
  }))));

  s.registerTool('list_catalog', {
    title: 'Normkatalog',
    description: 'Part types and the standard sizes known to the catalog (dimensions are filled in automatically when adding a part with a size).',
    inputSchema: { type: z.enum(TYPE_ENUM).optional() }
  }, safe((a) => ok(TYPE_ENUM.filter((t) => !a.type || t === a.type).map((t) => ({ type: t, label: C.TYPES[t].label, norm: C.TYPES[t].norm, sizes: C.TYPES[t].sizes(), needs_length: !!C.TYPES[t].needsLength, params: C.TYPES[t].params })))));

  s.registerTool('add_part', {
    title: 'Teil anlegen',
    description: 'Add a part. Give type + size (e.g. "M4x16", "M3", "608", "6x3") to fill norm dimensions, or params for non-standard parts. Placement: container_id (+ optional cell label like "B3"), or auto_place to use the first free bin.',
    inputSchema: {
      type: z.enum(TYPE_ENUM), size: z.string().optional(), length: z.number().optional(),
      params: z.record(z.string(), z.any()).optional().describe('Dimension overrides, e.g. {"hole":4.1}. For custom: {"title":"…","dims":[{"label":"Breite","value":12,"kind":"hole|shaft|depth"}]}'),
      name: z.string().optional(), finish: z.enum(Object.keys(C.FINISH)).optional(), stock: z.number().int().min(0).default(0), min_stock: z.number().int().min(0).optional(),
      container_id: z.string().optional(), cell: z.string().optional(), auto_place: z.boolean().optional(), note: z.string().optional(), links: LINKS
    }
  }, safe(async (a) => { if (a.links) a.links = await enrichAll(a.links); return ok(compact(store.createPart(a))); }));

  s.registerTool('update_part', {
    title: 'Teil ändern',
    description: 'Change name, finish, min stock, note, dimensions or location (container_id + cell) of a part. Set container_id to null to remove it from its bin.',
    inputSchema: { id: z.number().int(), name: z.string().optional(), finish: z.enum(Object.keys(C.FINISH)).optional(), min_stock: z.number().int().min(0).optional(), note: z.string().optional(),
      params: z.record(z.string(), z.any()).optional(), container_id: z.string().nullable().optional(), cell: z.string().optional(),
      links: LINKS.describe('Replaces ALL links of the part. To add one link use add_part_link instead.') }
  }, safe(async (a) => { const id = a.id; delete a.id; if (a.links) a.links = await enrichAll(a.links); return ok(compact(store.updatePart(id, a))); }));

  s.registerTool('add_part_link', {
    title: 'Bezugsquelle anhängen',
    description: 'Attach a purchase link (product page) to one or more parts, e.g. the shop page of an assortment box to all parts it contains. Shop name, title, price and image are read from the page when not given; Amazon/AliExpress links are shortened and tracking parameters removed. An existing identical link is updated instead of duplicated.',
    inputSchema: { ids: z.array(z.number().int()).min(1).describe('Part ids'), url: z.string(), title: z.string().optional(), price: z.string().optional().describe('e.g. "12,99 €" or "12,99 € / 720 Stk"'),
      note: z.string().optional().describe('e.g. "Sortiment 720 Stk, bestellt 10/2026"'), fetch_metadata: z.boolean().default(true) }
  }, safe(async (a) => {
    const l = await links.enrich({ url: a.url, title: a.title, price: a.price, note: a.note }, { fetch: a.fetch_metadata !== false });
    const parts = store.addLink(a.ids, l);
    return ok({ link: { url: l.url, shop: l.shop, title: l.title, price: l.price, image: l.image }, parts: parts.map((p) => ({ id: p.id, name: p.info.name, links: p.links.length })) });
  }));

  s.registerTool('remove_part_link', {
    title: 'Bezugsquelle entfernen',
    description: 'Remove a purchase link from a part (link_id from get_part, or the exact url).',
    inputSchema: { id: z.number().int(), link_id: z.string() }
  }, safe((a) => ok(compact(store.removeLink(a.id, a.link_id)))));

  s.registerTool('adjust_stock', {
    title: 'Bestand buchen',
    description: 'Change stock by delta (negative = used/removed). Only call after the user confirmed the quantities.',
    inputSchema: { id: z.number().int(), delta: z.number().int(), reason: z.string().optional() }
  }, safe((a) => ok(compact(store.adjustStock(a.id, a.delta, a.reason)))));

  s.registerTool('record_fit_measurement', {
    title: 'Passung eintragen',
    description: 'Store a measured/tested CAD value for one dimension and fit of a part (e.g. after a tolerance test print). value=null resets to the default.',
    inputSchema: { id: z.number().int(), dimension: z.string().describe('Dimension key from get_part fits, e.g. "od", "sw", "shaft"'), fit: z.enum(FIT_ENUM),
      value: z.number().nullable(), material: z.string().optional().describe('e.g. "PETG"'), note: z.string().optional() }
  }, safe((a) => ok(compact(store.setFit(a.id, a.dimension, a.fit, a.value, a.material, a.note)))));

  s.registerTool('list_containers', {
    title: 'Organizer',
    description: 'All organizers (Mini-Systainer, Tanos, grids) with their bins, contents and free bins.',
    inputSchema: { container_id: z.string().optional() }
  }, safe((a) => {
    const parts = store.listParts();
    return ok(store.listContainers().filter((c) => !a.container_id || c.id === a.container_id).map((c) => ({
      id: c.id, name: c.name, kind: c.kind,
      bins: c.layout.cells.map((cell, i) => { const p = parts.find((x) => x.container_id === c.id && x.cell === i); return { bin: store.cellLabel(cell), size: cell.c * cell.r, part: p ? { id: p.id, name: p.info.name, stock: p.stock } : null }; })
    })));
  }));

  s.registerTool('list_spools', {
    title: 'Filament',
    description: 'Filament spools with material, color, remaining grams, AMS slot and temperatures.',
    inputSchema: { material: z.string().optional() }
  }, safe((a) => ok(store.listSpools().filter((sp) => !a.material || sp.material.toLowerCase().includes(a.material.toLowerCase())))));

  s.registerTool('update_spool', {
    title: 'Spule ändern / anlegen',
    description: 'Update a spool (e.g. remaining grams after a print, AMS slot) or create one when id is omitted.',
    inputSchema: { id: z.number().int().optional(), material: z.string().optional(), color: z.string().optional(), hex: z.string().optional(), vendor: z.string().optional(),
      rest_g: z.number().int().optional(), total_g: z.number().int().optional(), location: z.string().optional(), ams_slot: z.number().int().nullable().optional(),
      nozzle: z.string().optional(), bed: z.string().optional(), note: z.string().optional() }
  }, safe((a) => { const id = a.id; delete a.id; return ok(id ? store.updateSpool(id, a) : store.createSpool(a)); }));

  s.registerTool('list_intake', {
    title: 'Foto-Eingang',
    description: 'Photos uploaded in the web UI that still need to be turned into parts, with any automatic suggestion.',
    inputSchema: {}
  }, safe(() => ok(store.listIntake(false).map((i) => ({ id: i.id, status: i.status, created: i.created, note: i.note, suggestion: i.suggestion })))));

  s.registerTool('get_intake_photo', {
    title: 'Foto ansehen',
    description: 'Returns the uploaded photo so you can identify the parts (type, size, approximate count).',
    inputSchema: { id: z.number().int() }
  }, safe(async (a) => {
    const it = store.getIntake(a.id); if (!it) throw new Error('Foto nicht gefunden');
    const file = path.join(DATA_DIR, 'photos', path.basename(it.file));
    let buf = fs.readFileSync(file), mime = it.mime;
    if (sharp) { try { buf = await sharp(buf).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer(); mime = 'image/jpeg'; } catch (e) { /* Original senden */ } }
    return { content: [{ type: 'image', data: buf.toString('base64'), mimeType: mime }, { type: 'text', text: `Foto #${it.id} vom ${it.created}${it.note ? ' · Notiz: ' + it.note : ''}` }] };
  }));

  s.registerTool('resolve_intake', {
    title: 'Foto als Teil anlegen',
    description: 'Create the part shown in an intake photo (same fields as add_part) and mark the photo as done. Confirm type, size and count with the user first if unsure.',
    inputSchema: {
      id: z.number().int(), type: z.enum(TYPE_ENUM), size: z.string().optional(), length: z.number().optional(), params: z.record(z.string(), z.any()).optional(),
      name: z.string().optional(), finish: z.enum(Object.keys(C.FINISH)).optional(), stock: z.number().int().min(0).default(0), min_stock: z.number().int().min(0).optional(),
      container_id: z.string().optional(), cell: z.string().optional(), auto_place: z.boolean().optional(), note: z.string().optional(), links: LINKS
    }
  }, safe(async (a) => {
    if (a.links) a.links = await enrichAll(a.links);
    const it = store.getIntake(a.id); if (!it) throw new Error('Foto nicht gefunden');
    const spec = Object.assign({}, a); delete spec.id;
    const p = store.createPart(spec);
    store.updateIntake(it.id, { status: 'done', note: 'Angelegt als Teil #' + p.id });
    return ok(compact(p));
  }));

  return s;
}

function mcpHandler() {
  const token = process.env.MCP_TOKEN;
  return async (req, res) => {
    if (token) {
      const h = req.get('authorization') || '';
      if (h !== 'Bearer ' + token) return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
    }
    if (req.method !== 'POST') return res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
    try {
      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: e.message }, id: null });
    }
  };
}

module.exports = { mcpHandler, buildServer };
