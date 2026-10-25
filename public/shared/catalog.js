/* Werkstattlager – Normkatalog, Maße und Passungsregeln.
 * Wird vom Server (require) und vom Browser (window.WL_CATALOG) genutzt.
 * Alle Maße in mm. Passungswerte sind Startwerte für FDM-Druck (P1S, 0,4 mm Düse)
 * und werden pro Teil durch Messwerte überschrieben. */
(function (root) {
  'use strict';

  // ---------- Normtabellen ----------
  // DIN 912 / ISO 4762 Zylinderschraube mit Innensechskant: dk, k, s (SW), Steigung
  var SHCS = {
    M2: [3.8, 2, 1.5, 0.4], 'M2.5': [4.5, 2.5, 2, 0.45], M3: [5.5, 3, 2.5, 0.5], M4: [7, 4, 3, 0.7],
    M5: [8.5, 5, 4, 0.8], M6: [10, 6, 5, 1], M8: [13, 8, 6, 1.25], M10: [16, 10, 8, 1.5]
  };
  // ISO 7380-1 Linsenkopfschraube: dk, k, s
  var BUTTON = { M3: [5.7, 1.65, 2], M4: [7.6, 2.2, 2.5], M5: [9.5, 2.75, 3], M6: [10.5, 3.3, 4], M8: [14, 4.4, 5] };
  // DIN 7991 / ISO 10642 Senkschraube (90°): dk, k, s
  var CSK = { M3: [6, 1.7, 2], M4: [8, 2.3, 2.5], M5: [10, 2.8, 3], M6: [12, 3.3, 4], M8: [16, 4.4, 5] };
  // DIN 934 / ISO 4032 Sechskantmutter: s, m
  var NUT = { M2: [4, 1.6], 'M2.5': [5, 2], M3: [5.5, 2.4], M4: [7, 3.2], M5: [8, 4], M6: [10, 5], M8: [13, 6.5], M10: [17, 8] };
  // DIN 985 Sicherungsmutter (Nylon): s, m
  var NYLOC = { M3: [5.5, 4], M4: [7, 5], M5: [8, 5], M6: [10, 6], M8: [13, 8] };
  // DIN 125-A Unterlegscheibe: d1, d2, h
  var WASHER = { M2: [2.2, 5, 0.3], 'M2.5': [2.7, 6, 0.5], M3: [3.2, 7, 0.5], M4: [4.3, 9, 0.8], M5: [5.3, 10, 1], M6: [6.4, 12, 1.6], M8: [8.4, 16, 1.6] };
  // Rillenkugellager: d, D, B
  var BEARING = {
    '623': [3, 10, 4], '624': [4, 13, 5], '625': [5, 16, 5], '626': [6, 19, 6], '608': [8, 22, 7], '688': [8, 16, 5],
    '6000': [10, 26, 8], '6001': [12, 28, 8], '6002': [15, 32, 9], '6201': [12, 32, 10], '6800': [10, 19, 5], '6900': [10, 22, 6],
    MR85: [5, 8, 2.5], MR105: [5, 10, 4], MR63: [3, 6, 2.5], MR74: [4, 7, 2.5]
  };
  // Einschmelzmuttern – nur gängige Vorlagen; Herstellerangabe zur Bohrung hat Vorrang
  var INSERT = { 'M3×5.7': [3, 4.6, 5.7, 4.0], 'M3×4': [3, 4.6, 4, 4.0] };

  function threadOf(size) { var m = /^M(\d+(?:\.\d+)?)/i.exec(String(size || '')); return m ? parseFloat(m[1]) : null; }
  function f(v) { return String(+(+v).toFixed(2)).replace('.', ','); }

  // ---------- Typen ----------
  // params: Felder, die ein Teil dieses Typs speichert. sizes(): Normgrößen für die Auswahl.
  var TYPES = {
    shcs: {
      label: 'Zylinderschraube', norm: 'DIN 912 · ISO 4762', fin: 'ox', group: 'Schrauben',
      params: ['d', 'L', 'dk', 'k', 's', 'pitch'], needsLength: true,
      sizes: function () { return Object.keys(SHCS); },
      fromSize: function (sz, L) { var t = SHCS[sz]; if (!t) return null; return { d: threadOf(sz), L: +L || 10, dk: t[0], k: t[1], s: t[2], pitch: t[3] }; }
    },
    button: {
      label: 'Linsenkopfschraube', norm: 'ISO 7380', fin: 'ss', group: 'Schrauben',
      params: ['d', 'L', 'dk', 'k', 's', 'pitch'], needsLength: true,
      sizes: function () { return Object.keys(BUTTON); },
      fromSize: function (sz, L) { var t = BUTTON[sz]; if (!t) return null; var d = threadOf(sz); return { d: d, L: +L || 10, dk: t[0], k: t[1], s: t[2], pitch: (SHCS[sz] || [0, 0, 0, 0.5])[3] }; }
    },
    csk: {
      label: 'Senkschraube', norm: 'DIN 7991 · ISO 10642', fin: 'ox', group: 'Schrauben',
      params: ['d', 'L', 'dk', 'k', 's', 'pitch'], needsLength: true,
      sizes: function () { return Object.keys(CSK); },
      fromSize: function (sz, L) { var t = CSK[sz]; if (!t) return null; return { d: threadOf(sz), L: +L || 10, dk: t[0], k: t[1], s: t[2], pitch: (SHCS[sz] || [0, 0, 0, 0.5])[3] }; }
    },
    nut: {
      label: 'Sechskantmutter', norm: 'DIN 934 · ISO 4032', fin: 'zn', group: 'Muttern & Scheiben',
      params: ['d', 's', 'm'], sizes: function () { return Object.keys(NUT); },
      fromSize: function (sz) { var t = NUT[sz]; if (!t) return null; return { d: threadOf(sz), s: t[0], m: t[1] }; }
    },
    nyloc: {
      label: 'Sicherungsmutter', norm: 'DIN 985', fin: 'zn', group: 'Muttern & Scheiben',
      params: ['d', 's', 'm'], sizes: function () { return Object.keys(NYLOC); },
      fromSize: function (sz) { var t = NYLOC[sz]; if (!t) return null; return { d: threadOf(sz), s: t[0], m: t[1] }; }
    },
    washer: {
      label: 'Unterlegscheibe', norm: 'DIN 125-A', fin: 'zn', group: 'Muttern & Scheiben',
      params: ['d', 'd1', 'd2', 'h'], sizes: function () { return Object.keys(WASHER); },
      fromSize: function (sz) { var t = WASHER[sz]; if (!t) return null; return { d: threadOf(sz), d1: t[0], d2: t[1], h: t[2] }; }
    },
    insert: {
      label: 'Einschmelzmutter', norm: 'Gewindeeinsatz', fin: 'brass', group: 'Muttern & Scheiben',
      params: ['d', 'D', 'L', 'hole'], sizes: function () { return Object.keys(INSERT); },
      fromSize: function (sz) { var t = INSERT[sz]; if (!t) return null; return { d: t[0], D: t[1], L: t[2], hole: t[3] }; }
    },
    bearing: {
      label: 'Kugellager', norm: 'Rillenkugellager · 2Z', fin: 'chrome', group: 'Lager',
      params: ['code', 'd', 'D', 'B'], sizes: function () { return Object.keys(BEARING); },
      fromSize: function (sz) { var k = String(sz).toUpperCase().replace(/(ZZ|2RS|2Z|RS)$/, ''); var t = BEARING[k]; if (!t) return null; return { code: k + 'ZZ', d: t[0], D: t[1], B: t[2] }; }
    },
    magnet: {
      label: 'Scheibenmagnet', norm: 'NdFeB', fin: 'nickel', group: 'Magnete',
      params: ['D', 'H'], sizes: function () { return []; },
      fromSize: function (sz) { var m = /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/.exec(String(sz)); return m ? { D: +m[1], H: +m[2] } : null; }
    },
    custom: {
      label: 'Sonstiges Teil', norm: 'eigene Maße', fin: 'plain', group: 'Sonstiges',
      params: ['title', 'dims'], sizes: function () { return []; }, fromSize: function () { return null; }
    }
  };

  var FINISH = {
    ox: 'Stahl 12.9 · brüniert', ss: 'Edelstahl A2', zn: 'Stahl 8 · verzinkt', brass: 'Messing',
    chrome: 'Wälzlagerstahl', nickel: 'NdFeB · vernickelt', plain: '—', black: 'Kunststoff schwarz', alu: 'Aluminium'
  };

  // ---------- Anzeige ----------
  function info(p) {
    var a = p.params || {}, T = TYPES[p.type] || TYPES.custom, d = a.d;
    var name, size, dims;
    switch (p.type) {
      case 'shcs': case 'button': case 'csk':
        size = 'M' + f(d) + '×' + f(a.L); name = T.label + ' ' + size;
        dims = 'Kopf Ø ' + f(a.dk) + ' · k ' + f(a.k) + ' · SW ' + f(a.s); break;
      case 'nut': case 'nyloc':
        size = 'M' + f(d); name = T.label + ' ' + size; dims = 'SW ' + f(a.s) + ' · m ' + f(a.m); break;
      case 'washer':
        size = 'M' + f(d); name = T.label + ' ' + size; dims = 'Ø ' + f(a.d1) + ' / ' + f(a.d2) + ' · s ' + f(a.h); break;
      case 'insert':
        size = 'M' + f(d) + '×' + f(a.L); name = T.label + ' ' + size; dims = 'Ø ' + f(a.D) + ' · L ' + f(a.L) + ' · Bohrung ' + f(a.hole); break;
      case 'bearing':
        size = a.code || (f(a.d) + '×' + f(a.D) + '×' + f(a.B)); name = T.label + ' ' + size; dims = f(a.d) + ' × ' + f(a.D) + ' × ' + f(a.B) + ' mm'; break;
      case 'magnet':
        size = 'Ø' + f(a.D) + '×' + f(a.H); name = T.label + ' ' + f(a.D) + '×' + f(a.H); dims = 'Ø ' + f(a.D) + ' · h ' + f(a.H); break;
      default:
        size = a.title || 'Teil'; name = a.title || 'Sonstiges Teil';
        dims = (a.dims || []).map(function (x) { return x.label + ' ' + f(x.value); }).join(' · ');
    }
    if (p.name) name = p.name;
    return { name: name, size: size, norm: T.norm, typeLabel: T.label, group: T.group, mat: FINISH[p.finish || T.fin] || '', dims: dims };
  }

  // ---------- Passungsregeln ----------
  // kind → Startwerte relativ zum Nennmaß (null = nicht anwendbar)
  var RULES = {
    hole:     { press: 0.05, snap: 0.15, loose: 0.35 },   // Bohrung/Tasche für ein Teil (Ø oder Breite)
    depth:    { press: 0, snap: 0.1, loose: 0.3 },        // Tiefe einer Tasche
    shaft:    { press: 0.05, snap: -0.05, loose: -0.2 },  // gedruckter Zapfen in einer Bohrung des Teils
    clear:    { press: -0.4, snap: 0.2, loose: 0.4 },     // Schraubendurchgang; press = selbstfurchend
    head:     { press: 0.1, snap: 0.25, loose: 0.5 },     // Kopfsenkung
    trap:     { press: 0.05, snap: 0.15, loose: 0.35 }    // Mutternfalle (SW)
  };
  var FIT_LABEL = { press: 'Presssitz', snap: 'Snap-Fit', loose: 'lose Passung' };

  function dims(p) {
    var a = p.params || {};
    switch (p.type) {
      case 'shcs': case 'button': return [
        { key: 'shaft', m: 'Schaft Ø', sub: 'Durchgang · Press = selbstfurchend', short: 'Bohrung Ø', nom: a.d, kind: 'clear' },
        { key: 'head', m: 'Kopf Ø', sub: 'Senkung', short: 'Senkung Ø', nom: a.dk, kind: 'head' },
        { key: 'headh', m: 'Kopfhöhe', sub: 'Senktiefe', short: 'Senktiefe', nom: a.k, kind: 'head' }];
      case 'csk': return [
        { key: 'shaft', m: 'Schaft Ø', sub: 'Durchgang · Press = selbstfurchend', short: 'Bohrung Ø', nom: a.d, kind: 'clear' },
        { key: 'head', m: 'Kopf Ø', sub: 'Senkung 90°', short: 'Senkung Ø', nom: a.dk, kind: 'head' }];
      case 'nut': case 'nyloc': return [
        { key: 'sw', m: 'Schlüsselweite', sub: 'Mutternfalle', short: 'Falle SW', nom: a.s, kind: 'trap' },
        { key: 'h', m: 'Höhe', sub: 'Taschentiefe', short: 'Tiefe', nom: a.m, kind: 'depth' },
        { key: 'thread', m: 'Gewinde', sub: 'Durchgang für die Schraube', short: 'Durchgang Ø', nom: a.d, kind: 'clear', noPress: true }];
      case 'washer': return [
        { key: 'od', m: 'Außen Ø', sub: 'Tasche', short: 'Tasche Ø', nom: a.d2, kind: 'hole' },
        { key: 'h', m: 'Dicke', sub: 'Taschentiefe', short: 'Tiefe', nom: a.h, kind: 'depth' }];
      case 'bearing': return [
        { key: 'od', m: 'Außen Ø', sub: 'Lagersitz (Bohrung)', short: 'Lagersitz Ø', nom: a.D, kind: 'hole' },
        { key: 'id', m: 'Innen Ø', sub: 'Zapfen (Welle)', short: 'Zapfen Ø', nom: a.d, kind: 'shaft' },
        { key: 'w', m: 'Breite', sub: 'Sitztiefe', short: 'Sitztiefe', nom: a.B, kind: 'depth' }];
      case 'insert': return [
        { key: 'od', m: 'Außen Ø', sub: 'Bohrung zum Einschmelzen', short: 'Bohrung Ø', nom: a.D, kind: 'insert', fixed: a.hole },
        { key: 'len', m: 'Länge', sub: 'Bohrtiefe', short: 'Bohrtiefe', nom: a.L, kind: 'insert', fixed: (+a.L || 0) + 0.5 }];
      case 'magnet': return [
        { key: 'od', m: 'Durchmesser', sub: 'Tasche', short: 'Tasche Ø', nom: a.D, kind: 'hole' },
        { key: 'h', m: 'Höhe', sub: 'Taschentiefe', short: 'Tiefe', nom: a.H, kind: 'depth' }];
      default: return (a.dims || []).map(function (x, i) {
        return { key: x.key || ('d' + i), m: x.label, sub: x.kind === 'shaft' ? 'Zapfen' : (x.kind === 'depth' ? 'Tiefe' : 'Tasche / Bohrung'), short: x.label, nom: +x.value, kind: x.kind || 'hole' };
      });
    }
  }

  function r2(v) { return v == null ? null : Math.round(v * 100) / 100; }

  // Fit-Tabelle eines Teils: Startwerte + gespeicherte Messwerte (p.fits[key][fit])
  function fitTable(p) {
    var over = p.fits || {};
    return dims(p).map(function (dm) {
      var row = { key: dm.key, m: dm.m, sub: dm.sub, short: dm.short, nom: r2(dm.nom), kind: dm.kind, values: {}, measured: {} };
      ['press', 'snap', 'loose'].forEach(function (fit) {
        var v;
        if (dm.kind === 'insert') v = fit === 'press' ? dm.fixed : null;
        else if (dm.noPress && fit === 'press') v = null;
        else v = dm.nom == null ? null : dm.nom + RULES[dm.kind][fit];
        var o = over[dm.key] && over[dm.key][fit];
        if (o && o.value != null) { v = o.value; row.measured[fit] = { material: o.material || null, note: o.note || null, at: o.at || null }; }
        row.values[fit] = r2(v);
      });
      return row;
    });
  }

  var api = { TYPES: TYPES, FINISH: FINISH, RULES: RULES, FIT_LABEL: FIT_LABEL, info: info, dims: dims, fitTable: fitTable, threadOf: threadOf, fmt: f,
    tables: { SHCS: SHCS, BUTTON: BUTTON, CSK: CSK, NUT: NUT, NYLOC: NYLOC, WASHER: WASHER, BEARING: BEARING, INSERT: INSERT } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.WL_CATALOG = api;
})(typeof self !== 'undefined' ? self : this);
