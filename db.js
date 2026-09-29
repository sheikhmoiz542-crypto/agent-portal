const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'portal.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('agent','manager')),
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One shift per agent per day. date = the day the shift starts.
-- Times are minutes after 00:00 of that date; end_min goes past 1440 for overnight shifts.
CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  UNIQUE (user_id, date)
);

CREATE TABLE IF NOT EXISTS break_types (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  minutes INTEGER NOT NULL,
  per_shift INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS breaks (
  id INTEGER PRIMARY KEY,
  shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  type_id INTEGER NOT NULL REFERENCES break_types(id),
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Daily performance numbers per agent. source = 'placeholder' | 'manual' | 'api'
CREATE TABLE IF NOT EXISTS agent_stats (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  contacts_handled INTEGER,
  avg_handle_sec INTEGER,
  quality_score REAL,
  csat REAL,
  adherence_pct REAL,
  source TEXT NOT NULL DEFAULT 'placeholder',
  UNIQUE (user_id, date)
);
`);

const DEFAULT_SETTINGS = {
  max_concurrent: '2',   // agents allowed on break at the same moment
  buffer_minutes: '30',  // no breaks in the first/last N minutes of a shift
  slot_minutes: '15'     // break start times land on this grid
};

for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(k, v);
}

if (db.prepare('SELECT COUNT(*) c FROM break_types').get().c === 0) {
  const ins = db.prepare('INSERT INTO break_types (name, minutes, per_shift) VALUES (?, ?, ?)');
  ins.run('Short break', 15, 2);
  ins.run('Meal break', 45, 1);
}

function getSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = Number(r.value);
  return out;
}

// First run: create a manager account so someone can sign in.
function bootstrapManager() {
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) return;
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString('base64url');
  const username = process.env.ADMIN_USERNAME || 'manager';
  db.prepare(
    'INSERT INTO users (name, username, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, 1)'
  ).run('Manager', username, bcrypt.hashSync(password, 10), 'manager');
  console.log('\n=== First run: manager account created ===');
  console.log(`Username: ${username}`);
  console.log(`Password: ${password}`);
  console.log('You will be asked to change this password at first sign-in.\n');
}

module.exports = { db, getSettings, bootstrapManager, DATA_DIR };
