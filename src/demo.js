'use strict';
// Beispieldaten zum Ausprobieren (SEED_DEMO=1), nur wenn noch keine Teile existieren
const store = require('./store');
const { db } = require('./db');

function seed() {
  if (db.prepare('SELECT COUNT(*) n FROM parts').get().n) return;
  if (!store.getContainer('MS-02')) store.createContainer({ id: 'MS-02', name: 'Schrauben M4 / M5', kind: 'mini' });
  store.updateContainer('MS-01', { name: 'Schrauben M3' });
  store.updateContainer('TO-01', { name: 'Lager & Magnete' });
  const add = (type, size, stock, min, cont, cell, extra) => store.createPart(Object.assign({ type, size, stock, min_stock: min, container_id: cont, cell }, extra || {}));
  [['M3x6', 60], ['M3x8', 52], ['M3x10', 47], ['M3x12', 38], ['M3x16', 33], ['M3x20', 24], ['M3x25', 14], ['M3x30', 6]].forEach((s, i) => add('shcs', s[0], s[1], i > 5 ? 10 : 20, 'MS-01', i));
  add('button', 'M3x8', 45, 20, 'MS-01', 8); add('button', 'M3x12', 28, 15, 'MS-01', 9);
  add('nut', 'M3', 120, 40, 'MS-01', 10); add('washer', 'M3', 150, 40, 'MS-01', 11); add('insert', 'M3x5.7', 80, 30, 'MS-01', 12);
  add('shcs', 'M4x12', 30, 15, 'MS-02', 0); add('shcs', 'M4x20', 18, 10, 'MS-02', 1); add('button', 'M4x10', 20, 10, 'MS-02', 2); add('shcs', 'M5x16', 9, 10, 'MS-02', 4);
  add('nut', 'M4', 60, 20, 'MS-02', 5); add('washer', 'M4', 70, 20, 'MS-02', 6); add('nut', 'M5', 35, 15, 'MS-02', 7);
  add('magnet', '6x3', 40, 20, 'TO-01', 0); add('magnet', '10x2', 20, 10, 'TO-01', 1);
  add('bearing', 'MR105', 3, 4, 'TO-01', 5); add('bearing', '625', 10, 4, 'TO-01', 6); add('bearing', '608', 16, 8, 'TO-01', 10);
  [['PLA Basic', 'Schwarz', '#1E1F22', 640, 1, '220 °C', '55 °C'], ['PETG HF', 'Grau', '#8A8F96', 820, 2, '250 °C', '70 °C'], ['PLA Matte', 'Elfenbein', '#E9E2D0', 310, 3, '220 °C', '55 °C'],
    ['PETG HF', 'Signalorange', '#D9541E', 1000, 4, '250 °C', '70 °C'], ['TPU 95A', 'Transparent', '#CFE3E6', 450, null, '230 °C', '35 °C'], ['PETG-CF', 'Schwarz', '#2B2C2E', 150, null, '260 °C', '70 °C']]
    .forEach((s) => store.createSpool({ material: s[0], color: s[1], hex: s[2], rest_g: s[3], total_g: 1000, ams_slot: s[4], location: s[4] ? 'AMS' : 'Regal', nozzle: s[5], bed: s[6] }));
}
module.exports = { seed };
