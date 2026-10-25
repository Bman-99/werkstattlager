'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(path.join(DATA_DIR, 'photos'), { recursive: true });

const db = new Database(path.join(DATA_DIR, 'werkstattlager.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS containers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  layout TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  params TEXT NOT NULL,
  name TEXT,
  finish TEXT,
  stock INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  container_id TEXT REFERENCES containers(id) ON DELETE SET NULL,
  cell INTEGER,
  fits TEXT NOT NULL DEFAULT '{}',
  created TEXT NOT NULL DEFAULT (datetime('now')),
  updated TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS spools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material TEXT NOT NULL,
  color TEXT,
  hex TEXT,
  vendor TEXT,
  rest_g INTEGER NOT NULL DEFAULT 1000,
  total_g INTEGER NOT NULL DEFAULT 1000,
  location TEXT,
  ams_slot INTEGER,
  nozzle TEXT,
  bed TEXT,
  note TEXT,
  updated TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS intake (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file TEXT NOT NULL,
  mime TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  suggestion TEXT,
  note TEXT,
  created TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id INTEGER,
  delta INTEGER NOT NULL,
  reason TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Migrationen für bestehende Datenbanken
const partCols = db.prepare('PRAGMA table_info(parts)').all().map((c) => c.name);
if (!partCols.includes('links')) db.exec("ALTER TABLE parts ADD COLUMN links TEXT NOT NULL DEFAULT '[]'"); // 1.1.0: Bezugsquellen

module.exports = { db, DATA_DIR };
