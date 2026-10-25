(function () {
  'use strict';
  var C = window.WL_CATALOG, G = window.WL_GEOM;
  var app = document.getElementById('app');
  var S = {
    data: null, view: 'lager', cont: null, sel: null, fit: 'snap', q: '', showRes: false,
    panel: null, form: null, editForm: null, contForm: null, fitEdit: null, spool: null, spoolForm: null,
    yaw: 0.6, pitch: -0.5, spin: true, viewers: []
  };
  var FITS = [['press', 'Press'], ['snap', 'Snap-Fit'], ['loose', 'Lose']];

  // ---------- Helfer ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(v) { return v == null ? '—' : (+v).toFixed(2).replace('.', ','); }
  function fN(v) { return v == null ? '' : String(+(+v).toFixed(2)).replace('.', ','); }
  function num(v) { if (v == null || v === '') return undefined; var n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : undefined; }
  function api(method, url, body, isForm) {
    var opt = { method: method, headers: {} };
    if (body && !isForm) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    if (isForm) opt.body = body;
    return fetch('/api' + url, opt).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || r.statusText); return j; }); });
  }
  var toastT;
  function toast(msg) { var t = document.getElementById('toast'); t.textContent = msg; t.className = 'show'; clearTimeout(toastT); toastT = setTimeout(function () { t.className = ''; }, 2600); }
  function fail(e) { toast(e.message || String(e)); }
  function byId(id) { return S.data.parts.filter(function (p) { return p.id === +id; })[0] || null; }
  function cont(id) { return S.data.containers.filter(function (c) { return c.id === id; })[0] || null; }
  function cellLabel(cell) { return String.fromCharCode(64 + cell.y) + cell.x; }
  function partIn(cid, i) { return S.data.parts.filter(function (p) { return p.container_id === cid && p.cell === i; })[0] || null; }

  var IC = {
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
    qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2"/>',
    grid: '<path d="M3 3h18v18H3zM3 12h18M12 3v18"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', pause: '<path d="M8 5v14M16 5v14"/>', play: '<path d="M7 5l12 7-12 7z" fill="currentColor"/>',
    back: '<path d="M15 5l-7 7 7 7"/>', box: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M8 8V5h8v3M3 13h18"/>'
  };
  function ic(n, s) { s = s || 18; return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + IC[n] + '</svg>'; }

  var thumbCache = {};
  function thumb(p, size) {
    var key = p.id + '|' + JSON.stringify(p.params) + '|' + p.finish + '|' + p.type;
    if (!thumbCache[key]) thumbCache[key] = G.toSvgPaths(G.render(G.geom(p, false), 0.7, -0.6, 64, 64), 0.4);
    return '<svg class="thumb" viewBox="0 0 64 64" width="' + size + '" height="' + size + '" aria-hidden="true">' + thumbCache[key] + '</svg>';
  }

  function nq(s) { return String(s || '').toLowerCase().replace(/×/g, 'x').replace(/,/g, '.'); }
  function toks() { return nq(S.q).trim().split(/\s+/).filter(Boolean); }
  function isMatch(p, t) { if (!t.length) return false; var i = p.info; var h = nq([i.name, i.size, i.norm, i.typeLabel, i.group, i.mat, i.dims, p.note, p.location && p.location.text].join(' ')); return t.every(function (x) { return h.indexOf(x) >= 0; }); }

  // ---------- Daten ----------
  function load() {
    return api('GET', '/state').then(function (d) {
      S.data = d;
      if (!S.cont || !cont(S.cont)) S.cont = d.containers[0] ? d.containers[0].id : null;
      if (S.sel && !byId(S.sel)) S.sel = null;
      render();
    }).catch(fail);
  }
  function setHash(h) { if (location.hash !== h) history.replaceState(null, '', h); }
  function route() {
    var h = location.hash.replace(/^#\/?/, '').split('/');
    if (h[0] === 'c' && h[1]) { S.view = 'lager'; S.cont = decodeURIComponent(h[1]); S.panel = null; }
    else if (h[0] === 'p' && h[1]) { var p = byId(h[1]); S.view = 'lager'; if (p) { S.sel = p.id; if (p.container_id) S.cont = p.container_id; } S.panel = null; }
    else if (h[0] === 'filament') S.view = 'filament';
    else if (h[0] === 'eingang') S.view = 'eingang';
  }

  // ---------- Kopfzeile ----------
  function header() {
    var t = toks(), res = t.length ? S.data.parts.filter(function (p) { return isMatch(p, t); }).slice(0, 8) : [];
    var nIn = S.data.intake.length;
    var tab = function (v, label, extra) { return '<button type="button" class="tab" data-act="view" data-v="' + v + '"' + (S.view === v ? ' aria-current="page"' : '') + '>' + label + (extra || '') + '</button>'; };
    return '<header class="top">' +
      '<a class="brand" href="#/" data-act="home"><svg width="32" height="32" viewBox="0 0 64 64" aria-hidden="true"><rect x="12" y="20" width="40" height="30" rx="6" fill="none" stroke="#F4F3EF" stroke-width="4"/><path d="M24 20v-5h16v5" fill="none" stroke="#F4F3EF" stroke-width="4"/><path d="M12 33h40" stroke="#C2410C" stroke-width="4"/><rect x="28" y="29" width="8" height="8" rx="2" fill="#C2410C"/></svg><b>Werkstattlager</b></a>' +
      '<nav class="tabs" aria-label="Bereiche">' + tab('lager', 'Kleinteile') + tab('filament', 'Filament') + tab('eingang', 'Eingang', nIn ? ' <span class="badge">' + nIn + '</span>' : '') + '</nav>' +
      '<div class="search"><label for="q" class="sr">Teile suchen</label>' + ic('search').replace('<svg', '<svg style="color:#9AA0A9"') +
      '<input id="q" type="search" autocomplete="off" placeholder="Suchen: „M4 20“, „608“, „Magnet 6“ …" value="' + esc(S.q) + '">' +
      (S.showRes && t.length ? '<div class="results">' + (res.length ? res.map(function (p) {
        return '<button type="button" data-act="pick" data-id="' + p.id + '"><span>' + esc(p.info.name) + '</span><span class="mono muted" style="font-size:12px;white-space:nowrap">' + esc(p.location ? p.location.text : 'ohne Platz') + ' · ' + p.stock + ' Stk</span></button>';
      }).join('') : '<div class="note" style="padding:10px">Nichts gefunden.</div>') + '</div>' : '') + '</div>' +
      '<div class="row"><button type="button" class="btn primary" data-act="add" data-mode="photo">' + ic('camera') + 'Foto erfassen</button>' +
      '<button type="button" class="btn ghost-night" data-act="add" data-mode="catalog">' + ic('plus') + 'Teil</button></div>' +
      '</header>';
  }

  // ---------- Kleinteile ----------
  function lagerView() {
    var cs = S.data.containers, t = toks();
    var chips = cs.map(function (c) {
      var hits = t.length ? S.data.parts.filter(function (p) { return p.container_id === c.id && isMatch(p, t); }).length : 0;
      return '<button type="button" class="cont-chip" data-act="cont" data-id="' + esc(c.id) + '" aria-current="' + (c.id === S.cont) + '"><span class="mono">' + esc(c.id) + '</span><span>' + esc(c.name) + '</span>' + (hits ? '<span class="badge">' + hits + '</span>' : '') + '</button>';
    }).join('') + '<button type="button" class="cont-chip add" data-act="newcont">' + ic('plus', 16) + 'Organizer</button>';
    var c = cont(S.cont);
    var body = c ? caseView(c, t) : '<div class="card empty">' + ic('box', 40) + '<h2>Noch kein Organizer</h2><p class="note">Lege deinen ersten Mini-Systainer oder Tanos-Organizer an.</p><button class="btn primary" data-act="newcont">Organizer anlegen</button></div>';
    var loose = S.data.parts.filter(function (p) { return !p.container_id || p.cell == null; });
    var looseHtml = loose.length ? '<div class="card pad stack"><div class="between"><h2>Ohne festen Platz</h2><span class="note">' + loose.length + ' Teile</span></div><div class="loose-parts">' +
      loose.map(function (p) { return '<button type="button" class="btn small" data-act="sel" data-id="' + p.id + '">' + thumb(p, 22) + esc(p.info.name) + ' · ' + p.stock + '</button>'; }).join('') + '</div></div>' : '';
    return '<div class="conts">' + chips + '</div>' + body + looseHtml;
  }

  function caseView(c, t) {
    var L = c.layout, kind = c.kind, filled = 0;
    var placing = S.panel === 'add' || S.panel === 'edit';
    var target = S.panel === 'add' && S.form ? S.form : (S.panel === 'edit' && S.editForm ? S.editForm : null);
    var bins = L.cells.map(function (cell, i) {
      var p = partIn(c.id, i), label = cellLabel(cell);
      var mode = kind === 'mini' ? 'big' : kind === 'tanos' ? (cell.r >= 2 ? 'big' : cell.c >= 2 ? 'wide' : 'small') : (L.cols <= 6 ? 'big' : 'small');
      var pos = 'grid-column:' + cell.x + ' / span ' + cell.c + ';grid-row:' + cell.y + ' / span ' + cell.r;
      var isTarget = target && target.cell != null && target.container_id === c.id && +target.cell === i;
      if (!p) {
        return '<button type="button" class="bin free' + (isTarget ? ' target' : '') + (t.length ? ' dim' : '') + '" style="' + pos + '" data-act="bin" data-c="' + esc(c.id) + '" data-i="' + i + '" aria-label="Fach ' + label + ' frei' + (placing ? ' – hier ablegen' : ' – Teil hinzufügen') + '">' + ic('plus', 16) + '<span class="mono">' + label + '</span></button>';
      }
      filled++;
      var m = isMatch(p, t), sel = p.id === S.sel && !S.panel, cls = 'bin ' + mode + (sel ? ' sel' : '') + (m && !sel ? ' hit' : '') + (t.length && !m && !sel ? ' dim' : '') + (isTarget ? ' target' : '');
      var aria = p.info.name + ', Fach ' + label + ', ' + p.stock + ' Stück' + (p.low ? ', knapp' : '');
      var inner;
      if (mode === 'big') inner = '<span class="between" style="gap:4px"><span class="lbl">' + label + '</span>' + (p.low ? '<span class="tag">knapp</span>' : '') + '</span>' + thumb(p, 46) +
        '<span class="between" style="gap:6px;flex-wrap:nowrap"><span class="nm">' + esc(p.info.size) + '</span><span class="ct">' + p.stock + ' Stk</span></span>';
      else if (mode === 'wide') inner = thumb(p, 48) + '<span style="display:flex;flex-direction:column;gap:2px;min-width:0"><span class="lbl">' + label + (p.low ? ' · knapp' : '') + '</span><span class="nm">' + esc(p.info.size) + '</span><span class="ct">' + p.stock + ' Stk</span></span>';
      else inner = thumb(p, 34) + '<span class="nm">' + esc(p.info.size) + '</span><span class="ct">' + p.stock + '</span>' + (p.low ? '<span class="dot" aria-hidden="true"></span>' : '');
      return '<button type="button" class="' + cls + '" style="' + pos + '" data-act="bin" data-c="' + esc(c.id) + '" data-i="' + i + '" aria-label="' + esc(aria) + '">' + inner + '</button>';
    }).join('');
    var free = L.cells.length - filled;
    return '<div class="case ' + esc(kind) + '"><div class="case-head"><div class="row" style="gap:12px"><span class="plate">' + esc(c.id) + '</span><span style="display:flex;flex-direction:column"><span class="case-title">' + esc(c.name) + '</span><span class="case-sub">' + esc(c.kindLabel) + ' · ' + filled + ' belegt · ' + free + ' frei</span></span></div>' +
      '<div class="row"><a class="cbtn" href="/label/' + encodeURIComponent(c.id) + '" target="_blank" rel="noopener">' + ic('qr', 16) + 'QR-Etikett</a><button type="button" class="cbtn" data-act="editcont">' + ic('grid', 16) + 'Bearbeiten</button></div></div>' +
      '<div class="tray" style="grid-template-columns:repeat(' + L.cols + ', minmax(0, 1fr));grid-template-rows:' + esc(L.rowsTpl) + ';height:' + L.height + 'px">' + bins + '</div>' +
      (placing ? '<p class="note" style="margin-top:10px;color:var(--sub)">Tippe auf ein freies Fach, um den Platz zu wählen.</p>' : '') + '</div>';
  }

  // ---------- Teilekarte ----------
  function partCard(p) {
    var rows = p.fitTable, fitName = C.FIT_LABEL[S.fit];
    var sum = rows.filter(function (r) { return r.values[S.fit] != null; }).map(function (r) { return esc(r.short) + ' ' + fmt(r.values[S.fit]) + ' mm'; });
    var anyMeas = rows.some(function (r) { return Object.keys(r.measured).length; });
    var table = '<table><thead><tr><th>Maß</th><th>Nenn</th>' + FITS.map(function (f) { return '<th>' + f[1].replace('-Fit', '') + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + esc(r.m) + '<span class="sub">' + esc(r.sub) + '</span></td><td class="nom">' + fN(r.nom) + '</td>' + FITS.map(function (f) {
          var v = r.values[f[0]], on = f[0] === S.fit, meas = r.measured[f[0]];
          return '<td class="' + (on ? 'on' : '') + (v == null ? ' na' : '') + '"><button type="button" data-act="fitedit" data-dim="' + esc(r.key) + '" data-fit="' + f[0] + '" class="' + (meas ? 'meas' : '') + '" aria-label="' + esc(r.short + ' ' + f[1] + ': ' + fmt(v) + (meas ? ' (gemessen)' : '') + ' – bearbeiten') + '">' + fmt(v) + '</button></td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
    var fe = '';
    if (S.fitEdit && S.fitEdit.part === p.id) {
      var row = rows.filter(function (r) { return r.key === S.fitEdit.dim; })[0], fl = C.FIT_LABEL[S.fitEdit.fit], meas = row && row.measured[S.fitEdit.fit];
      if (row) fe = '<div class="fitedit"><b style="font-size:14px">' + esc(row.short) + ' · ' + fl + '</b><div class="form">' +
        '<div class="field"><label for="fe-v">CAD-Wert in mm</label><input id="fe-v" inputmode="decimal" data-fe="value" value="' + fN(S.fitEdit.value) + '"></div>' +
        '<div class="field"><label for="fe-m">Material</label><input id="fe-m" data-fe="material" value="' + esc(S.fitEdit.material || '') + '" placeholder="z. B. PETG"></div>' +
        '<div class="field full"><label for="fe-n">Notiz</label><input id="fe-n" data-fe="note" value="' + esc(S.fitEdit.note || '') + '" placeholder="z. B. Toleranztest 25.10."></div></div>' +
        (meas ? '<p class="note">Gemessen' + (meas.material ? ' in ' + esc(meas.material) : '') + (meas.at ? ' am ' + esc(meas.at) : '') + (meas.note ? ' · ' + esc(meas.note) : '') + '</p>' : '<p class="note">Aktuell Startwert. Gespeicherte Werte gelten als gemessen.</p>') +
        '<div class="row"><button type="button" class="btn dark small" data-act="fitsave">Speichern</button>' + (meas ? '<button type="button" class="btn small" data-act="fitreset">Auf Startwert zurücksetzen</button>' : '') + '<button type="button" class="btn small" data-act="fitcancel">Abbrechen</button></div></div>';
    }
    var first = rows.filter(function (r) { return r.values[S.fit] != null; })[0];
    return '<div class="card"><div class="viewer" id="viewer"><svg id="v-main" viewBox="0 0 360 300" role="img" aria-label="' + esc('3D-Ansicht: ' + p.info.name) + '"></svg>' +
      '<span class="hint">3D · ziehen zum Drehen</span><button type="button" class="iconbtn" data-act="spin" aria-label="' + (S.spin ? 'Drehung anhalten' : 'Drehung starten') + '">' + ic(S.spin ? 'pause' : 'play', 16) + '</button>' +
      '<span class="dims">' + esc(p.info.dims) + '</span></div>' +
      '<div class="pad stack" style="gap:18px"><div class="stack" style="gap:6px"><span class="kicker">' + esc(p.info.norm) + '</span><h1>' + esc(p.info.name) + '</h1>' +
      '<div class="row" style="gap:6px;margin-top:4px"><span class="chip">' + esc(p.info.mat) + '</span><span class="chip dark">' + esc(p.location ? p.location.text : 'ohne Platz') + '</span>' + (p.low ? '<span class="chip low">unter Meldebestand</span>' : '') + '</div>' +
      (p.note ? '<p class="note">' + esc(p.note) + '</p>' : '') + '</div>' +
      '<div class="stockbox"><div style="display:flex;flex-direction:column"><span class="note" style="font-size:12px">Bestand</span><span class="n">' + p.stock + '</span><span class="note" style="font-size:12px">' + (p.min_stock ? 'Meldebestand ' + p.min_stock : 'kein Meldebestand') + '</span></div>' +
      '<div class="row"><button type="button" class="sbtn mono" data-act="stock" data-d="-10" aria-label="10 entnehmen">−10</button><button type="button" class="sbtn" data-act="stock" data-d="-1" aria-label="1 entnehmen">−</button><button type="button" class="sbtn dark" data-act="stock" data-d="1" aria-label="1 hinzufügen">+</button><button type="button" class="sbtn mono dark" data-act="stock" data-d="10" aria-label="10 hinzufügen">+10</button></div></div>' +
      '<div class="stack" style="gap:10px"><div class="between"><h2>Passungen für den 3D-Druck</h2><div class="seg" role="group" aria-label="Passungsart">' +
      FITS.map(function (f) { return '<button type="button" data-act="fit" data-fit="' + f[0] + '" aria-pressed="' + (S.fit === f[0]) + '">' + f[1] + '</button>'; }).join('') + '</div></div>' +
      '<div class="legend"><span>' + (anyMeas ? 'Grüner Punkt = gemessen' : 'Startwerte · noch nicht gemessen') + '</span><span>Wert antippen zum Eintragen</span></div>' +
      '<div class="fits">' + table + '</div>' + fe +
      '<div class="summary"><b>Im CAD für ' + fitName + '</b><span>' + (sum.length ? sum.join(' · ') : 'Für dieses Teil gibt es nur einen Presswert.') + '</span></div></div>' +
      '<div class="mcp"><span class="c">MCP · so frage ich bei der Konstruktion ab</span><span>get_fit(id: ' + p.id + ', fit: "' + S.fit + '")</span><span class="r">→ ' + esc(first ? first.short + ' ' + fmt(first.values[S.fit]) + ' mm' : '—') + '</span></div>' +
      '<div class="row"><button type="button" class="btn" data-act="editpart">' + ic('edit', 16) + 'Bearbeiten / verschieben</button><button type="button" class="btn danger" data-act="delpart">' + ic('trash', 16) + 'Löschen</button></div>' +
      '</div></div>';
  }

  function overviewCard() {
    var parts = S.data.parts, low = parts.filter(function (p) { return p.low; });
    var total = parts.reduce(function (a, p) { return a + p.stock; }, 0);
    return '<div class="card pad stack"><span class="kicker">Übersicht</span><h1>' + parts.length + ' Artikel · ' + total.toLocaleString('de-DE') + ' Teile</h1>' +
      '<p class="note">Tippe auf ein Fach für Maße, Passungen und Bestand. Freie Fächer starten das Anlegen.</p>' +
      (low.length ? '<h2>Knapp</h2><div class="lowlist">' + low.map(function (p) { return '<button type="button" data-act="sel" data-id="' + p.id + '"><span>' + esc(p.info.name) + '</span><span class="mono muted">' + p.stock + ' / ' + p.min_stock + '</span></button>'; }).join('') + '</div>' : '') +
      '<div class="mcp"><span class="c">MCP-Endpunkt für Claude & Co.</span><span>' + esc(location.origin) + '/mcp</span></div></div>';
  }

  // ---------- Teil anlegen ----------
  function newForm(mode, extra) {
    return Object.assign({ mode: mode, type: 'shcs', size: 'M3', length: '12', D: '', H: '', title: '', dims: [{ label: 'Durchmesser', value: '', kind: 'hole' }], hole: '',
      stock: '', min_stock: '', finish: '', container_id: S.cont, cell: null, note: '', intakeId: null, photoUrl: null, waiting: false, uploading: false, suggestion: null }, extra || {});
  }
  function draft(f) {
    var T = C.TYPES[f.type], params = null;
    try {
      if (f.type === 'magnet') { var D = num(f.D), H = num(f.H); if (D && H) params = { D: D, H: H }; }
      else if (f.type === 'custom') params = { title: f.title || 'Teil', dims: f.dims.map(function (d) { return { label: d.label, value: num(d.value) || 0, kind: d.kind }; }) };
      else { params = T.fromSize(f.size, num(f.length)); if (params && f.type === 'insert' && num(f.hole)) params.hole = num(f.hole); }
    } catch (e) { params = null; }
    return params ? { id: 0, type: f.type, params: params, finish: f.finish || null } : null;
  }
  function addPanel() {
    var f = S.form, T = C.TYPES[f.type];
    var head = '<div class="between"><h1>Neues Teil</h1><button type="button" class="iconbtn" data-act="close" aria-label="Schließen">' + ic('x', 16) + '</button></div>';
    if (f.mode === 'photo') {
      return '<div class="card pad stack">' + head + '<div class="seg" role="group" aria-label="Art der Erfassung"><button type="button" data-act="fmode" data-m="photo" aria-pressed="true">Per Foto</button><button type="button" data-act="fmode" data-m="catalog" aria-pressed="false">Aus dem Katalog</button></div>' +
        (f.uploading || f.waiting ? '<div class="scan">' + (f.photoUrl ? '<img class="photo" src="' + esc(f.photoUrl) + '" alt="Hochgeladenes Foto">' : '') + '</div><p class="note">' + (f.uploading ? 'Lade Foto hoch …' : 'Erkenne Teileart, Größe und Stückzahl …') + '</p>' :
          '<label class="drop" id="drop" for="photo-in">' + ic('camera', 40) + '<b>Foto der Teile aufnehmen oder hierher ziehen</b><span class="note" style="max-width:340px">Am besten auf hellem Untergrund, ein paar Teile nebeneinander und ein Lineal oder Messschieber mit im Bild.</span><span class="btn primary">Foto wählen</span></label>' +
          '<input id="photo-in" type="file" accept="image/*" capture="environment" class="sr" data-act="photo">') +
        '<p class="note">' + (S.data.vision ? 'Das Foto wird automatisch ausgewertet, danach prüfst du den Vorschlag.' : 'Das Foto landet im Eingang. Claude kann es dort per MCP auswerten und anlegen – oder du trägst die Teile gleich selbst ein.') + '</p></div>';
    }
    var sizes = T.sizes(), d = draft(f);
    var typeOpts = {}; Object.keys(C.TYPES).forEach(function (k) { var g = C.TYPES[k].group; (typeOpts[g] = typeOpts[g] || []).push(k); });
    var fields = '<div class="field full"><label for="f-type">Teileart</label><select id="f-type" data-f="type" data-rerender>' + Object.keys(typeOpts).map(function (g) {
      return '<optgroup label="' + esc(g) + '">' + typeOpts[g].map(function (k) { return '<option value="' + k + '"' + (k === f.type ? ' selected' : '') + '>' + esc(C.TYPES[k].label + ' · ' + C.TYPES[k].norm) + '</option>'; }).join('') + '</optgroup>';
    }).join('') + '</select></div>';
    if (f.type === 'magnet') fields += '<div class="field"><label for="f-D">Durchmesser (mm)</label><input id="f-D" inputmode="decimal" data-f="D" data-rerender="soft" value="' + esc(f.D) + '"></div><div class="field"><label for="f-H">Höhe (mm)</label><input id="f-H" inputmode="decimal" data-f="H" data-rerender="soft" value="' + esc(f.H) + '"></div>';
    else if (f.type === 'custom') {
      fields += '<div class="field full"><label for="f-title">Bezeichnung</label><input id="f-title" data-f="title" value="' + esc(f.title) + '" placeholder="z. B. Linearwelle 8 mm"></div>' +
        '<div class="full stack" style="gap:8px"><span class="note" style="font-size:12px">Maße – jedes bekommt eigene Passungswerte</span>' + f.dims.map(function (dm, i) {
          return '<div class="dimrow"><div class="field"><label for="dl' + i + '">Maß</label><input id="dl' + i + '" data-dim="' + i + '" data-k="label" value="' + esc(dm.label) + '"></div><div class="field"><label for="dv' + i + '">mm</label><input id="dv' + i + '" inputmode="decimal" data-dim="' + i + '" data-k="value" value="' + esc(dm.value) + '"></div>' +
            '<div class="field"><label for="dk' + i + '">Gedruckt als</label><select id="dk' + i + '" data-dim="' + i + '" data-k="kind">' + [['hole', 'Bohrung/Tasche'], ['shaft', 'Zapfen'], ['depth', 'Tiefe']].map(function (o) { return '<option value="' + o[0] + '"' + (dm.kind === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
            '<button type="button" class="iconbtn" data-act="dimdel" data-i="' + i + '" aria-label="Maß entfernen">' + ic('x', 14) + '</button></div>';
        }).join('') + '<button type="button" class="btn small" data-act="dimadd" style="align-self:flex-start">' + ic('plus', 14) + 'Maß</button></div>';
    } else {
      fields += '<div class="field"><label for="f-size">Größe</label><select id="f-size" data-f="size" data-rerender>' + sizes.map(function (s) { return '<option' + (s === f.size ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select></div>';
      if (T.needsLength) fields += '<div class="field"><label for="f-len">Länge (mm)</label><input id="f-len" inputmode="decimal" data-f="length" data-rerender="soft" value="' + esc(f.length) + '"></div>';
      else if (f.type === 'insert') fields += '<div class="field"><label for="f-hole">Bohrung laut Hersteller (mm)</label><input id="f-hole" inputmode="decimal" data-f="hole" placeholder="' + fN((T.fromSize(f.size) || {}).hole) + '" value="' + esc(f.hole) + '"></div>';
      else fields += '<div class="field"></div>';
    }
    fields += '<div class="field"><label for="f-stock">Stückzahl</label><input id="f-stock" inputmode="numeric" data-f="stock" value="' + esc(f.stock) + '"></div>' +
      '<div class="field"><label for="f-min">Meldebestand</label><input id="f-min" inputmode="numeric" data-f="min_stock" value="' + esc(f.min_stock) + '" placeholder="optional"></div>' +
      '<div class="field full"><label for="f-fin">Oberfläche / Material</label><select id="f-fin" data-f="finish" data-rerender="soft"><option value="">Standard (' + esc(C.FINISH[T.fin]) + ')</option>' + Object.keys(C.FINISH).filter(function (k) { return k !== 'plain'; }).map(function (k) { return '<option value="' + k + '"' + (f.finish === k ? ' selected' : '') + '>' + esc(C.FINISH[k]) + '</option>'; }).join('') + '</select></div>';
    var c = cont(f.container_id), loc = c && f.cell != null ? c.id + ' · Fach ' + cellLabel(c.layout.cells[f.cell]) : 'noch kein Fach gewählt';
    return '<div class="card pad stack">' + head +
      (f.photoUrl ? '<img class="photo" src="' + esc(f.photoUrl) + '" alt="Foto der Teile">' : '<div class="seg" role="group" aria-label="Art der Erfassung"><button type="button" data-act="fmode" data-m="photo" aria-pressed="false">Per Foto</button><button type="button" data-act="fmode" data-m="catalog" aria-pressed="true">Aus dem Katalog</button></div>') +
      (f.suggestion ? '<p class="warn">Vorschlag' + (f.suggestion.source ? ' von ' + esc(f.suggestion.source) : '') + ': ' + esc(f.suggestion.type + ' ' + f.suggestion.size) + (f.suggestion.count ? ' · ≈ ' + f.suggestion.count + ' Stk' : '') + (f.suggestion.notes ? ' · ' + esc(f.suggestion.notes) : '') + '. Bitte prüfen.</p>' : '') +
      (f.intakeId && !f.suggestion ? '<p class="note">Foto liegt im Eingang. Trag die Teile hier ein oder lass Claude das Foto per MCP auswerten.</p>' : '') +
      '<div class="preview3d"><svg id="v-draft" viewBox="0 0 300 180" role="img" aria-label="3D-Vorschau"></svg></div>' +
      (d ? '<p class="note mono" style="font-size:12px">' + esc(C.info(d).name + ' · ' + C.info(d).dims) + '</p>' : '<p class="note">Maße eingeben, dann erscheint die Vorschau.</p>') +
      '<div class="form">' + fields + '</div>' +
      '<div class="stack" style="gap:6px"><span class="note" style="font-size:12px">Platz</span><div class="between"><span class="chip dark">' + esc(loc) + '</span><span class="note">Freies Fach links antippen</span></div></div>' +
      '<button type="button" class="btn primary" data-act="addsave"' + (d ? '' : ' disabled') + '>Ins Lager übernehmen</button></div>';
  }

  // ---------- Teil bearbeiten ----------
  function editPanel() {
    var f = S.editForm, p = byId(f.id); if (!p) return '';
    var T = C.TYPES[p.type];
    var pf = p.type === 'custom' ? '' : T.params.filter(function (k) { return k !== 'code'; }).map(function (k) {
      return '<div class="field"><label for="e-' + k + '">' + esc({ d: 'Gewinde d', L: 'Länge L', dk: 'Kopf Ø dk', k: 'Kopfhöhe k', s: 'Schlüsselweite s', pitch: 'Steigung', m: 'Höhe m', d1: 'Innen Ø d1', d2: 'Außen Ø d2', h: 'Dicke h', D: 'Außen Ø D', B: 'Breite B', H: 'Höhe H', hole: 'Bohrung' }[k] || k) + '</label><input id="e-' + k + '" inputmode="decimal" data-ep="' + k + '" value="' + fN(f.params[k]) + '"></div>';
    }).join('');
    var c = cont(f.container_id), loc = c && f.cell != null ? c.id + ' · Fach ' + cellLabel(c.layout.cells[f.cell]) : 'ohne Platz';
    return '<div class="card pad stack"><div class="between"><h1>Bearbeiten</h1><button type="button" class="iconbtn" data-act="close" aria-label="Schließen">' + ic('x', 16) + '</button></div>' +
      '<div class="form"><div class="field full"><label for="e-name">Name (leer = automatisch)</label><input id="e-name" data-ef="name" value="' + esc(f.name || '') + '" placeholder="' + esc(p.info.name) + '"></div>' + pf +
      '<div class="field"><label for="e-min">Meldebestand</label><input id="e-min" inputmode="numeric" data-ef="min_stock" value="' + esc(f.min_stock) + '"></div>' +
      '<div class="field"><label for="e-stock">Bestand</label><input id="e-stock" inputmode="numeric" data-ef="stock" value="' + esc(f.stock) + '"></div>' +
      '<div class="field full"><label for="e-fin">Oberfläche / Material</label><select id="e-fin" data-ef="finish"><option value="">Standard</option>' + Object.keys(C.FINISH).map(function (k) { return '<option value="' + k + '"' + (f.finish === k ? ' selected' : '') + '>' + esc(C.FINISH[k]) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field full"><label for="e-note">Notiz</label><textarea id="e-note" data-ef="note">' + esc(f.note || '') + '</textarea></div></div>' +
      '<div class="stack" style="gap:6px"><span class="note" style="font-size:12px">Platz</span><div class="between"><span class="chip dark">' + esc(loc) + '</span><span class="row"><span class="note">Freies Fach links antippen</span>' + (f.container_id ? '<button type="button" class="btn small" data-act="unplace">Platz entfernen</button>' : '') + '</span></div></div>' +
      '<div class="row"><button type="button" class="btn dark" data-act="editsave">Speichern</button><button type="button" class="btn" data-act="close">Abbrechen</button></div></div>';
  }

  // ---------- Organizer ----------
  function contPanel() {
    var f = S.contForm;
    return '<div class="card pad stack"><div class="between"><h1>' + (f.isNew ? 'Neuer Organizer' : 'Organizer ' + esc(f.id)) + '</h1><button type="button" class="iconbtn" data-act="close" aria-label="Schließen">' + ic('x', 16) + '</button></div>' +
      '<div class="form">' + (f.isNew ? '<div class="field"><label for="c-id">Kürzel (leer = automatisch)</label><input id="c-id" data-cf="id" value="' + esc(f.id || '') + '" placeholder="z. B. MS-02" style="text-transform:uppercase"></div>' : '') +
      '<div class="field' + (f.isNew ? '' : ' full') + '"><label for="c-name">Name</label><input id="c-name" data-cf="name" value="' + esc(f.name || '') + '" placeholder="z. B. Schrauben M3"></div>' +
      '<div class="field full"><span class="lab">Art</span><div class="pick">' + S.data.kinds.map(function (k) { return '<button type="button" data-act="ckind" data-k="' + k.key + '" aria-pressed="' + (f.kind === k.key) + '">' + esc(k.label) + '</button>'; }).join('') + '</div></div>' +
      (f.kind === 'grid' ? '<div class="field"><label for="c-cols">Spalten</label><input id="c-cols" inputmode="numeric" data-cf="cols" value="' + esc(f.cols) + '"></div><div class="field"><label for="c-rows">Reihen</label><input id="c-rows" inputmode="numeric" data-cf="rows" value="' + esc(f.rows) + '"></div>' : '') + '</div>' +
      '<p class="note">' + ({ mini: '15 gedruckte Behälter im 5×3-Raster, obere Reihe flacher.', tanos: '22 Boxen: 10 kleine, 5 lange, 1 große, 3 hohe, 3 kleine.', grid: 'Gleich große Fächer in einem freien Raster.' }[f.kind]) + '</p>' +
      (!f.isNew && f.kind !== f.origKind ? '<p class="warn">Beim Wechsel der Einteilung behalten Teile ihr Fach nur, wenn die Nummer weiter existiert. Alle anderen landen unter „Ohne festen Platz“.</p>' : '') +
      '<div class="row"><button type="button" class="btn dark" data-act="contsave">Speichern</button>' + (!f.isNew ? '<a class="btn" href="/label/' + encodeURIComponent(f.id) + '" target="_blank" rel="noopener">' + ic('qr', 16) + 'Etikett drucken</a><button type="button" class="btn danger" data-act="contdel">' + ic('trash', 16) + 'Löschen</button>' : '') + '</div></div>';
  }

  // ---------- Filament ----------
  function spoolSvg(s, h) {
    var pct = Math.max(0, Math.min(1, (s.rest_g || 0) / (s.total_g || 1000))), fr = 25 + 30 * pct, hex = s.hex || '#9AA0A9', w = '';
    var dark = parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16) < 380;
    for (var r = 28; r < fr - 1; r += 3.5) w += '<circle cx="60" cy="60" r="' + r.toFixed(1) + '" fill="none" stroke="' + (dark ? 'rgba(255,255,255,.12)' : 'rgba(28,31,36,.12)') + '" stroke-width="0.7"/>';
    return '<svg viewBox="0 0 120 120" style="height:' + h + 'px" aria-hidden="true"><circle cx="60" cy="60" r="56" fill="#DCDAD4"/><circle cx="60" cy="60" r="' + fr.toFixed(1) + '" fill="' + esc(hex) + '" stroke="rgba(28,31,36,.18)"/>' + w + '<circle cx="60" cy="60" r="24" fill="#EFEEEA" stroke="#C9C6BF"/><circle cx="60" cy="60" r="8" fill="#1C1F24"/></svg>';
  }
  function filamentView() {
    var sp = S.data.spools, ams = sp.filter(function (s) { return s.ams_slot; }).length;
    return '<div class="between"><h1>Filamentregal</h1><span class="note">' + sp.length + ' Spulen · ' + ams + ' im AMS</span></div><div class="spools">' + sp.map(function (s) {
      var pct = Math.round(100 * (s.rest_g || 0) / (s.total_g || 1000));
      return '<button type="button" class="spool" data-act="spool" data-id="' + s.id + '" aria-current="' + (S.spool === s.id) + '" aria-label="' + esc(s.material + ' ' + (s.color || '') + ', ' + s.rest_g + ' Gramm') + '"><span class="between"><span class="slotbadge' + (s.ams_slot ? ' ams' : '') + '">' + (s.ams_slot ? 'AMS ' + s.ams_slot : esc(s.location || 'Regal')) + '</span>' + (s.rest_g < 200 ? '<span class="chip low">knapp</span>' : '') + '</span>' +
        spoolSvg(s, 130) + '<span style="display:flex;flex-direction:column;gap:2px"><b>' + esc(s.material) + '</b><span class="note">' + esc([s.color, s.vendor].filter(Boolean).join(' · ')) + '</span></span><span class="bar"><i style="width:' + pct + '%"></i></span><span class="mono" style="font-size:13px">' + s.rest_g + ' / ' + s.total_g + ' g</span></button>';
    }).join('') + '<button type="button" class="spool add" data-act="newspool">' + ic('plus', 28) + '<b>Spule hinzufügen</b></button></div>';
  }
  function spoolPanel() {
    var f = S.spoolForm; if (!f) return '<div class="card pad empty">' + ic('box', 36) + '<p>Wähle eine Spule oder lege eine neue an.</p></div>';
    var inp = function (k, label, type, extra) { return '<div class="field' + (extra || '') + '"><label for="s-' + k + '">' + label + '</label><input id="s-' + k + '" ' + (type ? 'type="' + type + '" ' : '') + 'data-sf="' + k + '" value="' + esc(f[k] == null ? '' : f[k]) + '"></div>'; };
    return '<div class="card pad stack"><div class="between"><h1>' + (f.id ? esc(f.material || 'Spule') : 'Neue Spule') + '</h1><button type="button" class="iconbtn" data-act="close" aria-label="Schließen">' + ic('x', 16) + '</button></div>' +
      '<div style="display:flex;justify-content:center">' + spoolSvg(f, 200) + '</div>' +
      '<div class="form">' + inp('material', 'Material', '', '') + inp('color', 'Farbe', '', '') + inp('hex', 'Farbton', 'color', '') + inp('vendor', 'Hersteller', '', '') +
      '<div class="field full"><label for="s-rest">Rest: ' + esc(f.rest_g) + ' g</label><input id="s-rest" type="range" min="0" max="' + esc(f.total_g || 1000) + '" step="10" data-sf="rest_g" data-rerender="soft" value="' + esc(f.rest_g) + '"></div>' +
      inp('rest_g', 'Rest (g)', '', '') + inp('total_g', 'Netto (g)', '', '') +
      '<div class="field full"><span class="lab">AMS-Slot</span><div class="pick">' + [null, 1, 2, 3, 4].map(function (n) { return '<button type="button" data-act="slot" data-n="' + (n || '') + '" aria-pressed="' + ((f.ams_slot || null) === n) + '">' + (n ? 'Slot ' + n : 'nicht im AMS') + '</button>'; }).join('') + '</div></div>' +
      inp('location', 'Lagerort', '', '') + inp('nozzle', 'Düse', '', '') + inp('bed', 'Druckbett', '', '') + '<div class="field full"><label for="s-note">Notiz</label><textarea id="s-note" data-sf="note">' + esc(f.note || '') + '</textarea></div></div>' +
      '<div class="row"><button type="button" class="btn dark" data-act="spoolsave">Speichern</button>' + (f.id ? '<button type="button" class="btn danger" data-act="spooldel">' + ic('trash', 16) + 'Löschen</button>' : '') + '</div></div>';
  }

  // ---------- Eingang ----------
  function intakeView() {
    var it = S.data.intake;
    if (!it.length) return '<div class="card empty">' + ic('camera', 40) + '<h2>Eingang ist leer</h2><p class="note">Fotos, die du über „Foto erfassen“ hochlädst, warten hier, bis sie als Teile angelegt sind.</p></div>';
    return '<div class="between"><h1>Foto-Eingang</h1><span class="note">' + it.length + ' offen</span></div><div class="intake">' + it.map(function (i) {
      var s = i.suggestion;
      return '<div class="card"><img src="/api/intake/' + i.id + '/photo" alt="Foto ' + i.id + '" loading="lazy"><div class="pad stack" style="gap:8px"><span class="kicker">#' + i.id + ' · ' + esc(i.created) + '</span>' +
        (s ? '<b>' + esc(s.type + ' ' + s.size) + (s.count ? ' · ≈ ' + s.count + ' Stk' : '') + '</b>' + (s.notes ? '<span class="note">' + esc(s.notes) + '</span>' : '') : '<span class="note">' + esc(i.status === 'analyzing' ? 'Wird ausgewertet …' : (i.note || 'Wartet auf Auswertung')) + '</span>') +
        '<div class="row"><button type="button" class="btn small dark" data-act="intakeuse" data-id="' + i.id + '">Anlegen</button><button type="button" class="btn small" data-act="intakedel" data-id="' + i.id + '">Verwerfen</button></div></div></div>';
    }).join('') + '</div><p class="note">Tipp: Sag Claude „Werte den Werkstattlager-Eingang aus“ – es sieht sich die Fotos per MCP an und legt die Teile an.</p>';
  }

  // ---------- Render ----------
  function render() {
    if (!S.data) { app.innerHTML = '<div class="empty">Lade …</div>'; return; }
    var ae = document.activeElement, aid = ae && ae.id, ss = null, se = null;
    try { ss = ae.selectionStart; se = ae.selectionEnd; } catch (e) { /* kein Textfeld */ }
    var rightEl = app.querySelector('.right'), rs = rightEl ? rightEl.scrollTop : 0;
    S.viewers = [];
    var left, right;
    if (S.view === 'filament') { left = filamentView(); right = spoolPanel(); }
    else if (S.view === 'eingang') { left = intakeView(); right = S.panel === 'add' ? addPanel() : '<div class="card pad stack"><span class="kicker">Eingang</span><p class="note">Fotos ohne Auswertung kann Claude per MCP mit list_intake und get_intake_photo ansehen und mit resolve_intake anlegen.</p></div>'; }
    else {
      left = lagerView();
      var p = S.sel ? byId(S.sel) : null;
      right = S.panel === 'add' ? addPanel() : S.panel === 'edit' ? editPanel() : S.panel === 'cont' ? contPanel() : p ? partCard(p) : overviewCard();
    }
    app.innerHTML = header() + '<main class="main"><section class="left" aria-label="Lager">' + left + '</section><aside class="right" aria-label="Details">' + right + '</aside></main>';
    if (aid) { var el = document.getElementById(aid); if (el) { el.focus({ preventScroll: true }); try { if (ss != null) el.setSelectionRange(ss, se); } catch (e) { /* */ } } }
    var r2 = app.querySelector('.right'); if (r2) r2.scrollTop = rs;
    // 3D-Ansichten registrieren
    var vm = document.getElementById('v-main'), pp = S.sel && byId(S.sel);
    if (vm && pp) S.viewers.push({ el: vm, faces: G.geom(pp, true), W: 360, H: 300 });
    var vd = document.getElementById('v-draft');
    if (vd && S.form) { var d = draft(S.form); if (d) S.viewers.push({ el: vd, faces: G.geom(d, true), W: 300, H: 180 }); }
    drawViewers();
  }
  function drawViewers() { S.viewers.forEach(function (v) { v.el.innerHTML = G.toSvgPaths(G.render(v.faces, S.yaw, S.pitch, v.W, v.H)); }); }
  var lastT = 0, drag = null;
  function tick(t) { var dt = Math.min(0.05, (t - lastT) / 1000); lastT = t; if (S.spin && !drag && S.viewers.length && !document.hidden) { S.yaw += dt * 0.7; drawViewers(); } requestAnimationFrame(tick); }
  requestAnimationFrame(tick);

  // ---------- Aktionen ----------
  function select(id) { var p = byId(id); if (!p) return; S.sel = p.id; S.panel = null; S.fitEdit = null; S.view = 'lager'; if (p.container_id) S.cont = p.container_id; setHash('#/p/' + p.id); render(); if (window.innerWidth < 1050) { var r = app.querySelector('.right'); if (r) r.scrollIntoView({ behavior: 'smooth' }); } }
  function openAdd(mode, extra) { S.panel = 'add'; S.form = newForm(mode, extra); if (S.view === 'filament') S.view = 'lager'; render(); }
  function partBody(f) {
    var b = { type: f.type, stock: parseInt(f.stock, 10) || 0, min_stock: parseInt(f.min_stock, 10) || 0, finish: f.finish || undefined, note: f.note || undefined, container_id: f.cell != null ? f.container_id : undefined, cell: f.cell != null ? f.cell : undefined };
    if (f.type === 'magnet') b.params = { D: num(f.D), H: num(f.H) };
    else if (f.type === 'custom') b.params = { title: f.title || 'Teil', dims: f.dims.filter(function (d) { return d.label && num(d.value); }) };
    else { b.size = f.size; if (C.TYPES[f.type].needsLength) b.length = num(f.length); if (f.type === 'insert' && num(f.hole)) b.params = { hole: num(f.hole) }; }
    return b;
  }
  function uploadPhoto(file) {
    if (!file) return;
    var f = S.form; f.uploading = true; f.photoUrl = URL.createObjectURL(file); render();
    var fd = new FormData(); fd.append('photo', file);
    api('POST', '/intake', fd, true).then(function (it) {
      f.uploading = false; f.intakeId = it.id;
      if (S.data.vision) { f.waiting = true; render(); pollIntake(it.id, Date.now()); }
      else { f.mode = 'catalog'; render(); load(); }
    }).catch(function (e) { f.uploading = false; render(); fail(e); });
  }
  function pollIntake(id, t0) {
    api('GET', '/intake/' + id).then(function (it) {
      var f = S.form; if (!f || f.intakeId !== id) return;
      if (it.status === 'suggested' && it.suggestion) { applySuggestion(f, it.suggestion); f.waiting = false; f.mode = 'catalog'; render(); }
      else if (it.status === 'analyzing' && Date.now() - t0 < 120000) setTimeout(function () { pollIntake(id, t0); }, 1500);
      else { f.waiting = false; f.mode = 'catalog'; if (it.note) toast(it.note); render(); }
    }).catch(fail);
  }
  function applySuggestion(f, s) {
    f.suggestion = s; if (C.TYPES[s.type]) f.type = s.type;
    var p = s.params || {};
    if (f.type === 'magnet') { f.D = fN(p.D); f.H = fN(p.H); }
    else if (C.TYPES[f.type].sizes().length) {
      var m = /^(M\d+(?:\.\d+)?)/i.exec(s.size || '');
      if (f.type === 'bearing') f.size = String(s.size || '').toUpperCase().replace(/(ZZ|2RS|2Z|RS)$/, '');
      else if (m) f.size = m[1].toUpperCase();
      if (p.L) f.length = fN(p.L);
    }
    if (s.count) f.stock = String(s.count);
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b || b.tagName === 'INPUT') return;
    var a = b.getAttribute('data-act'), ds = b.dataset;
    if (a !== 'pick' && !e.target.closest('.search')) S.showRes = false;
    switch (a) {
      case 'home': e.preventDefault(); S.view = 'lager'; S.sel = null; S.panel = null; setHash('#/'); render(); break;
      case 'view': S.view = ds.v; S.panel = null; setHash(ds.v === 'lager' ? '#/' : '#/' + ds.v); render(); break;
      case 'pick': S.showRes = false; select(ds.id); break;
      case 'cont': S.cont = ds.id; if (S.panel === 'cont') S.panel = null; setHash('#/c/' + encodeURIComponent(ds.id)); render(); break;
      case 'sel': select(ds.id); break;
      case 'bin': {
        var p = partIn(ds.c, +ds.i);
        if (S.panel === 'add' && !p) { S.form.container_id = ds.c; S.form.cell = +ds.i; render(); }
        else if (S.panel === 'edit' && !p) { S.editForm.container_id = ds.c; S.editForm.cell = +ds.i; render(); }
        else if (p) select(p.id);
        else openAdd('catalog', { container_id: ds.c, cell: +ds.i });
        break;
      }
      case 'add': openAdd(ds.mode, S.sel ? {} : {}); break;
      case 'fmode': S.form.mode = ds.m; render(); break;
      case 'close': S.panel = null; S.fitEdit = null; if (S.view === 'filament') { S.spool = null; S.spoolForm = null; } render(); break;
      case 'spin': S.spin = !S.spin; render(); break;
      case 'fit': S.fit = ds.fit; render(); break;
      case 'stock': api('POST', '/parts/' + S.sel + '/stock', { delta: +ds.d, reason: 'manuell' }).then(load).catch(fail); break;
      case 'fitedit': {
        var pp = byId(S.sel), row = pp.fitTable.filter(function (r) { return r.key === ds.dim; })[0], meas = row.measured[ds.fit] || {};
        S.fit = ds.fit; S.fitEdit = { part: pp.id, dim: ds.dim, fit: ds.fit, value: row.values[ds.fit], material: meas.material || 'PETG', note: meas.note || '' }; render();
        var inp = document.getElementById('fe-v'); if (inp) { inp.focus(); inp.select(); }
        break;
      }
      case 'fitcancel': S.fitEdit = null; render(); break;
      case 'fitsave': {
        var fe = S.fitEdit, v = num(fe.value); if (v == null) { toast('Bitte einen Wert in mm eingeben'); break; }
        api('PUT', '/parts/' + fe.part + '/fits/' + fe.dim + '/' + fe.fit, { value: v, material: fe.material, note: fe.note }).then(function () { S.fitEdit = null; toast('Passung gespeichert'); return load(); }).catch(fail); break;
      }
      case 'fitreset': { var fr = S.fitEdit; api('DELETE', '/parts/' + fr.part + '/fits/' + fr.dim + '/' + fr.fit).then(function () { S.fitEdit = null; return load(); }).catch(fail); break; }
      case 'dimadd': S.form.dims.push({ label: '', value: '', kind: 'hole' }); render(); break;
      case 'dimdel': S.form.dims.splice(+ds.i, 1); if (!S.form.dims.length) S.form.dims.push({ label: '', value: '', kind: 'hole' }); render(); break;
      case 'addsave': {
        var f = S.form, body = partBody(f), url = f.intakeId ? '/intake/' + f.intakeId + '/resolve' : '/parts';
        b.disabled = true;
        api('POST', url, body).then(function (np) { S.panel = null; S.form = null; S.sel = np.id; if (np.container_id) S.cont = np.container_id; S.view = 'lager'; toast(np.info.name + ' angelegt'); setHash('#/p/' + np.id); return load(); }).catch(function (e2) { b.disabled = false; fail(e2); });
        break;
      }
      case 'editpart': { var ep = byId(S.sel); S.editForm = { id: ep.id, name: ep.name, params: Object.assign({}, ep.params), min_stock: ep.min_stock, stock: ep.stock, finish: ep.finish || '', note: ep.note || '', container_id: ep.container_id, cell: ep.cell }; S.panel = 'edit'; render(); break; }
      case 'unplace': S.editForm.container_id = null; S.editForm.cell = null; render(); break;
      case 'editsave': {
        var ef = S.editForm, orig = byId(ef.id), patch = { name: ef.name || null, min_stock: parseInt(ef.min_stock, 10) || 0, stock: parseInt(ef.stock, 10) || 0, finish: ef.finish || null, note: ef.note || null };
        if (orig.type !== 'custom') { var pr = {}; Object.keys(ef.params).forEach(function (k) { var n = num(ef.params[k]); if (n != null) pr[k] = n; }); patch.params = pr; }
        if (ef.container_id !== orig.container_id || ef.cell !== orig.cell) { patch.container_id = ef.container_id; patch.cell = ef.cell; }
        api('PATCH', '/parts/' + ef.id, patch).then(function () { S.panel = null; toast('Gespeichert'); return load(); }).catch(fail); break;
      }
      case 'delpart': { var dp = byId(S.sel); if (confirm(dp.info.name + ' wirklich löschen?')) api('DELETE', '/parts/' + dp.id).then(function () { S.sel = null; setHash('#/'); return load(); }).catch(fail); break; }
      case 'newcont': S.view = 'lager'; S.panel = 'cont'; S.contForm = { isNew: true, id: '', name: '', kind: 'mini', cols: 4, rows: 3 }; render(); break;
      case 'editcont': { var cc = cont(S.cont); S.panel = 'cont'; S.contForm = { isNew: false, id: cc.id, name: cc.name, kind: cc.kind, origKind: cc.kind, cols: cc.layout.cols, rows: cc.layout.cells.reduce(function (m, x) { return Math.max(m, x.y + x.r - 1); }, 1) }; render(); break; }
      case 'ckind': S.contForm.kind = ds.k; render(); break;
      case 'contsave': {
        var cf = S.contForm, cb = { name: cf.name || undefined, kind: cf.kind, cols: +cf.cols, rows: +cf.rows };
        var pr2 = cf.isNew ? api('POST', '/containers', Object.assign({ id: cf.id || undefined }, cb)) : api('PATCH', '/containers/' + encodeURIComponent(cf.id), (cf.kind === cf.origKind && cf.kind !== 'grid') ? { name: cf.name } : cb);
        pr2.then(function (c2) { S.cont = c2.id; S.panel = null; toast('Organizer gespeichert'); setHash('#/c/' + encodeURIComponent(c2.id)); return load(); }).catch(fail); break;
      }
      case 'contdel': if (confirm('Organizer ' + S.contForm.id + ' löschen? Die Teile bleiben erhalten und landen unter „Ohne festen Platz“.')) api('DELETE', '/containers/' + encodeURIComponent(S.contForm.id)).then(function () { S.panel = null; S.cont = null; return load(); }).catch(fail); break;
      case 'spool': { var s = S.data.spools.filter(function (x) { return x.id === +ds.id; })[0]; S.spool = s.id; S.spoolForm = Object.assign({}, s); render(); break; }
      case 'newspool': S.spool = null; S.spoolForm = { material: 'PLA', color: '', hex: '#8A8F96', vendor: '', rest_g: 1000, total_g: 1000, location: 'Regal', ams_slot: null, nozzle: '', bed: '', note: '' }; render(); break;
      case 'slot': S.spoolForm.ams_slot = ds.n ? +ds.n : null; if (S.spoolForm.ams_slot) S.spoolForm.location = 'AMS'; render(); break;
      case 'spoolsave': {
        var sf = Object.assign({}, S.spoolForm); delete sf.updated; var sid = sf.id; delete sf.id;
        (sid ? api('PATCH', '/spools/' + sid, sf) : api('POST', '/spools', sf)).then(function (ns) { S.spool = ns.id; S.spoolForm = Object.assign({}, ns); toast('Spule gespeichert'); return load(); }).catch(fail); break;
      }
      case 'spooldel': if (confirm('Spule löschen?')) api('DELETE', '/spools/' + S.spoolForm.id).then(function () { S.spool = null; S.spoolForm = null; return load(); }).catch(fail); break;
      case 'intakeuse': {
        var it = S.data.intake.filter(function (x) { return x.id === +ds.id; })[0];
        S.panel = 'add'; S.form = newForm('catalog', { intakeId: it.id, photoUrl: '/api/intake/' + it.id + '/photo' });
        if (it.suggestion) applySuggestion(S.form, it.suggestion);
        render(); break;
      }
      case 'intakedel': api('POST', '/intake/' + ds.id + '/dismiss').then(load).catch(fail); break;
    }
  });

  document.addEventListener('input', function (e) {
    var t = e.target, ds = t.dataset, soft = ds.rerender === 'soft';
    if (t.id === 'q') { S.q = t.value; S.showRes = true; render(); return; }
    if (ds.f && S.form) { S.form[ds.f] = t.value; if (soft) render(); return; }
    if (ds.dim != null && S.form) { S.form.dims[+ds.dim][ds.k] = t.value; return; }
    if (ds.fe && S.fitEdit) { S.fitEdit[ds.fe] = t.value; return; }
    if (ds.ef && S.editForm) { S.editForm[ds.ef] = t.value; return; }
    if (ds.ep && S.editForm) { S.editForm.params[ds.ep] = t.value; return; }
    if (ds.cf && S.contForm) { S.contForm[ds.cf] = t.value; return; }
    if (ds.sf && S.spoolForm) { S.spoolForm[ds.sf] = ['rest_g', 'total_g'].indexOf(ds.sf) >= 0 ? (parseInt(t.value, 10) || 0) : t.value; if (soft || ds.sf === 'hex') render(); return; }
  });
  document.addEventListener('change', function (e) {
    var t = e.target, ds = t.dataset;
    if (ds.act === 'photo') { uploadPhoto(t.files && t.files[0]); return; }
    if (ds.f && S.form) {
      S.form[ds.f] = t.value;
      if (ds.f === 'type') { var T = C.TYPES[t.value], sz = T.sizes(); S.form.size = sz.indexOf('M3') >= 0 ? 'M3' : (sz[0] || ''); if (t.value === 'bearing') S.form.size = '608'; }
      if (ds.rerender != null) render();
      return;
    }
    if (ds.dim != null && S.form) { S.form.dims[+ds.dim][ds.k] = t.value; render(); return; }
    if (ds.sf && S.spoolForm) render();
  });
  document.addEventListener('keydown', function (e) {
    if (e.target.id === 'q' && e.key === 'Escape') { S.showRes = false; render(); }
    if (e.target.id === 'q' && e.key === 'Enter') { var t = toks(), r = S.data.parts.filter(function (p) { return isMatch(p, t); }); if (r[0]) { S.showRes = false; select(r[0].id); } }
    if (S.fitEdit && e.key === 'Enter' && e.target.dataset && e.target.dataset.fe) { var sv = document.querySelector('[data-act="fitsave"]'); if (sv) sv.click(); }
  });
  document.addEventListener('focusin', function (e) { if (e.target.id === 'q' && S.q && !S.showRes) { S.showRes = true; render(); } });
  // Drehen per Ziehen
  document.addEventListener('pointerdown', function (e) { var v = e.target.closest('.viewer'); if (!v || e.target.closest('button')) return; drag = { x: e.clientX, y: e.clientY }; v.setPointerCapture && v.setPointerCapture(e.pointerId); });
  document.addEventListener('pointermove', function (e) { if (!drag) return; S.yaw += (e.clientX - drag.x) * 0.012; S.pitch = Math.max(-1.45, Math.min(0.35, S.pitch - (e.clientY - drag.y) * 0.008)); drag = { x: e.clientX, y: e.clientY }; drawViewers(); });
  document.addEventListener('pointerup', function () { drag = null; });
  document.addEventListener('pointercancel', function () { drag = null; });
  // Foto per Drag & Drop
  document.addEventListener('dragover', function (e) { var d = e.target.closest && e.target.closest('#drop'); if (d) { e.preventDefault(); d.classList.add('over'); } });
  document.addEventListener('dragleave', function (e) { var d = e.target.closest && e.target.closest('#drop'); if (d) d.classList.remove('over'); });
  document.addEventListener('drop', function (e) { var d = e.target.closest && e.target.closest('#drop'); if (d) { e.preventDefault(); uploadPhoto(e.dataTransfer.files[0]); } });
  // Foto aus der Zwischenablage
  document.addEventListener('paste', function (e) { if (S.panel !== 'add' || !S.form || S.form.mode !== 'photo') return; var it = [].slice.call(e.clipboardData.items || []).filter(function (x) { return x.type.indexOf('image/') === 0; })[0]; if (it) uploadPhoto(it.getAsFile()); });
  window.addEventListener('hashchange', function () { if (S.data) { route(); render(); } });

  render();
  load().then(function () { route(); render(); });
})();
