'use strict';
// Optionale Foto-Erkennung über ein OpenAI-kompatibles Vision-Modell
// (z. B. Ollama mit qwen2.5vl oder llava: VISION_URL=http://ollama:11434/v1).
// Ohne VISION_URL bleiben Fotos im Eingang und werden per MCP (z. B. von Claude) ausgewertet.
const fs = require('fs');
const path = require('path');
const C = require('../public/shared/catalog.js');
const store = require('./store');
const { DATA_DIR } = require('./db');

const URL_ = process.env.VISION_URL;
const MODEL = process.env.VISION_MODEL || 'qwen2.5vl:7b';
const KEY = process.env.VISION_API_KEY;

const enabled = () => !!URL_;

const PROMPT = `Du siehst ein Foto von Kleinteilen aus einer Werkstatt (Schrauben, Muttern, Scheiben, Kugellager, Einschmelzmuttern, Magnete).
Bestimme die Teileart und Größe. Antworte NUR mit JSON in genau dieser Form:
{"type": "<einer von: ${Object.keys(C.TYPES).join(', ')}>", "size": "<z. B. M4x16, M3, 608, 6x3>", "count": <geschätzte Stückzahl>, "confidence": <0 bis 1>, "notes": "<kurz: was sicher, was geschätzt>"}
Typen: shcs = Zylinderkopf mit Innensechskant (DIN 912), button = Linsenkopf (ISO 7380), csk = Senkkopf (DIN 7991), nut = Sechskantmutter, nyloc = Sicherungsmutter mit Nylonring, washer = Unterlegscheibe, insert = Einschmelzmutter aus Messing, bearing = Kugellager, magnet = Scheibenmagnet, custom = alles andere.
Schätze Längen anhand von Lineal oder Messschieber im Bild, wenn vorhanden.`;

async function analyze(intake) {
  if (!enabled()) return null;
  store.updateIntake(intake.id, { status: 'analyzing' });
  try {
    const b64 = fs.readFileSync(path.join(DATA_DIR, 'photos', intake.file)).toString('base64');
    const res = await fetch(URL_.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, KEY ? { Authorization: 'Bearer ' + KEY } : {}),
      body: JSON.stringify({
        model: MODEL, temperature: 0.1,
        messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: `data:${intake.mime};base64,${b64}` } }] }]
      }),
      signal: AbortSignal.timeout(120000)
    });
    if (!res.ok) throw new Error('Vision-Modell antwortet mit ' + res.status);
    const j = await res.json();
    const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    const m = /\{[\s\S]*\}/.exec(text); if (!m) throw new Error('Keine JSON-Antwort');
    const s = JSON.parse(m[0]);
    if (!C.TYPES[s.type]) s.type = 'custom';
    let params = null;
    try { params = store.resolveParams(s.type, s.size); } catch (e) { s.notes = (s.notes ? s.notes + ' · ' : '') + e.message; }
    const suggestion = { type: s.type, size: s.size || '', count: Math.max(0, parseInt(s.count, 10) || 0), confidence: +s.confidence || null, notes: s.notes || '', params, source: MODEL };
    return store.updateIntake(intake.id, { status: 'suggested', suggestion });
  } catch (e) {
    return store.updateIntake(intake.id, { status: 'new', note: 'Automatische Erkennung fehlgeschlagen: ' + e.message });
  }
}

module.exports = { enabled, analyze, MODEL };
