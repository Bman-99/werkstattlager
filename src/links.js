'use strict';
// Bezugsquellen: Links zu Produktseiten normalisieren und (best effort) Titel, Preis und Bild auslesen.
const crypto = require('crypto');

const TRACKING = /^(utm_\w+|ref|ref_|tag|psc|th|spm|scm|gclid|fbclid|msclkid|_encoding|pd_rd_\w+|pf_rd_\w+|qid|sr|crid|sprefix|dib|dib_tag|linkCode|linkId|camp|creative|creativeASIN|ascsubtag|aff_\w+|algo_\w+|gatewayAdapt|_randl_\w+|srcSns|social_params|businessType|mc_\w+)$/i;

function canonical(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch (e) { throw new Error('Ungültiger Link: ' + raw); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Nur http- und https-Links sind erlaubt');
  u.hash = '';
  const host = u.hostname.replace(/^www\./, '');
  // Amazon: auf /dp/ASIN kürzen
  if (/(^|\.)amazon\.[a-z.]+$/.test(host)) {
    const m = /\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/ASIN)\/([A-Z0-9]{10})/i.exec(u.pathname);
    if (m) return 'https://' + u.hostname + '/dp/' + m[1].toUpperCase();
  }
  // AliExpress: auf /item/<id>.html kürzen
  if (/(^|\.)aliexpress\.[a-z.]+$/.test(host)) {
    const m = /\/item\/(\d+)\.html/.exec(u.pathname);
    if (m) return 'https://' + u.hostname + '/item/' + m[1] + '.html';
  }
  [...u.searchParams.keys()].forEach((k) => { if (TRACKING.test(k)) u.searchParams.delete(k); });
  return u.toString();
}

const SHOPS = [[/(^|\.)amazon\./, 'Amazon'], [/(^|\.)amzn\./, 'Amazon'], [/(^|\.)aliexpress\./, 'AliExpress'], [/(^|\.)ebay\./, 'eBay'],
  [/(^|\.)temu\./, 'Temu'], [/(^|\.)bambulab\./, 'Bambu Lab'], [/(^|\.)reichelt\./, 'reichelt'], [/(^|\.)conrad\./, 'Conrad'],
  [/(^|\.)berrybase\./, 'BerryBase'], [/(^|\.)voelkner\./, 'voelkner'], [/(^|\.)mcmaster\./, 'McMaster-Carr'], [/(^|\.)misumi/, 'MISUMI'],
  [/(^|\.)wuerth\./, 'Würth'], [/(^|\.)hornbach\./, 'Hornbach'], [/(^|\.)obi\./, 'OBI'], [/(^|\.)bauhaus\./, 'Bauhaus'], [/(^|\.)festool\./, 'Festool'],
  [/(^|\.)kugellager-express\./, 'Kugellager-Express'], [/(^|\.)schraubenking\./, 'Schraubenking'], [/(^|\.)schrauben-normteile\./, 'Schrauben & Normteile']];
function shopName(url) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  const hit = SHOPS.find(([re]) => re.test(host));
  return hit ? hit[1] : host;
}

const SHORT = /^(amzn\.[a-z]+|a\.co|a\.aliexpress\.com|s\.click\.aliexpress\.com|ebay\.us|bit\.ly|tinyurl\.com|t\.co)$/i;
const str = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max) || null);
const today = () => new Date().toISOString().slice(0, 10);

// Ein Link-Objekt in die gespeicherte Form bringen (ohne Netzwerk)
function normalize(l) {
  if (typeof l === 'string') l = { url: l };
  if (!l || !l.url) throw new Error('Link fehlt');
  const url = canonical(l.url);
  let image = str(l.image, 1000);
  if (image) { try { if (!/^https?:$/.test(new URL(image).protocol)) image = null; } catch (e) { image = null; } }
  return {
    id: l.id || crypto.randomBytes(4).toString('hex'),
    url, shop: str(l.shop, 60) || shopName(url), title: str(l.title, 200), price: str(l.price, 40),
    image, note: str(l.note, 300), added: l.added || today()
  };
}

// ---------- Metadaten der Produktseite ----------
function decode(s) {
  return s.replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d))
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
async function readCapped(res, max) {
  const reader = res.body.getReader(), chunks = []; let n = 0;
  while (n < max) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); n += value.length; }
  try { await reader.cancel(); } catch (e) { /* egal */ }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}
function parse(html, baseUrl) {
  const meta = (name) => {
    const tag = new RegExp('<meta[^>]+(?:property|name|itemprop)\\s*=\\s*["\']' + name.replace(/[.:]/g, '\\$&') + '["\'][^>]*>', 'i').exec(html);
    if (!tag) return null; const c = /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(tag[0]);
    return c ? decode(c[1] != null ? c[1] : c[2]) : null;
  };
  let title = meta('og:title') || meta('twitter:title');
  if (!title) { const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html); if (t) title = decode(t[1]); }
  if (title) {
    title = title.replace(/^Amazon\.[a-z.]+\s*:\s*/i, '').replace(/\s*:\s*(Baumarkt|Gewerbe, Industrie & Wissenschaft|Business, Industry & Science|Computer & Zubehör|Elektronik & Foto)$/i, '')
      .replace(/\s*[-|–]\s*AliExpress(\s*\d+)?$/i, '').trim();
    if (/^(amazon\.[a-z.]+|robot check|captcha|access denied|just a moment\.*|attention required.*|aliexpress)$/i.test(title)) title = null;
  }
  let image = meta('og:image') || meta('twitter:image');
  if (image) { try { image = new URL(image, baseUrl).toString(); } catch (e) { image = null; } }
  let price = meta('product:price:amount') || meta('og:price:amount') || meta('price');
  let cur = meta('product:price:currency') || meta('og:price:currency') || meta('priceCurrency');
  if (!price) {
    const ld = /"price"\s*:\s*"?(\d+(?:[.,]\d{1,2})?)"?/.exec(html);
    if (ld) { price = ld[1]; const c = /"priceCurrency"\s*:\s*"([A-Z]{3})"/.exec(html); if (c) cur = c[1]; }
  }
  if (price) { const n = parseFloat(String(price).replace(',', '.')); price = isFinite(n) && n > 0 ? n.toFixed(2).replace('.', ',') + (cur === 'EUR' || !cur ? ' €' : ' ' + cur) : null; }
  return { title, image, price };
}
async function fetchMeta(url) {
  const res = await fetch(url, {
    redirect: 'follow', signal: AbortSignal.timeout(8000),
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'de-DE,de;q=0.9,en;q=0.6' }
  });
  const out = { final: res.url || url };
  if (!res.ok || !/html/i.test(res.headers.get('content-type') || '')) { try { await res.body.cancel(); } catch (e) { /* */ } return out; }
  return Object.assign(out, parse(await readCapped(res, 1500000), out.final));
}

// Link normalisieren und fehlende Angaben von der Produktseite ergänzen. Schlägt das Auslesen fehl, bleibt der Link trotzdem erhalten.
async function enrich(l, opts) {
  const n = normalize(l);
  if (opts && opts.fetch === false) return n;
  if (n.title && n.price && n.image) return n;
  try {
    const m = await fetchMeta(n.url);
    // Kurzlinks (amzn.eu/d/…, a.aliexpress.com/…) durch die eigentliche Produktseite ersetzen
    if (m.final && m.final !== n.url && SHORT.test(new URL(n.url).hostname)) {
      try { const c = canonical(m.final); n.url = c; if (!l.shop) n.shop = shopName(c); } catch (e) { /* Kurzlink behalten */ }
    }
    if (!n.title && m.title) n.title = m.title.slice(0, 200);
    if (!n.price && m.price) n.price = m.price;
    if (!n.image && m.image) n.image = m.image;
  } catch (e) { /* Seite nicht erreichbar oder blockiert – Link bleibt ohne Metadaten */ }
  return n;
}

module.exports = { canonical, shopName, normalize, enrich, parse };
