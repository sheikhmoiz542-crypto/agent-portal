// Fills the database with 6 demo agents, two weeks of shifts and placeholder stats.
// Usage: npm run seed:demo   (safe to run more than once)
const bcrypt = require('bcryptjs');
const { db, bootstrapManager } = require('./db');

bootstrapManager();

const PASSWORD = process.env.DEMO_PASSWORD || 'demo-pass-123';
const hash = bcrypt.hashSync(PASSWORD, 10);
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const today = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.TZ_NAME || 'Asia/Karachi' }).format(new Date());
const monday = (() => { const [y, m, d] = today.split('-').map(Number); const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return addDays(today, -((dow + 6) % 7)); })();

const insUser = db.prepare("INSERT OR IGNORE INTO users (name, username, password_hash, role, must_change_password) VALUES (?, ?, ?, 'agent', 0)");
const insShift = db.prepare('INSERT OR IGNORE INTO shifts (user_id, date, start_min, end_min) VALUES (?, ?, ?, ?)');
const insStat = db.prepare(`INSERT OR IGNORE INTO agent_stats
  (user_id, date, contacts_handled, avg_handle_sec, quality_score, csat, adherence_pct, source)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'placeholder')`);

const rnd = (lo, hi) => lo + Math.random() * (hi - lo);

db.transaction(() => {
  for (let i = 1; i <= 6; i++) {
    insUser.run(`Demo Agent ${i}`, `agent${i}`, hash);
    const u = db.prepare('SELECT id FROM users WHERE username = ?').get(`agent${i}`);
    const night = i > 3;
    for (let d = 0; d < 14; d++) {
      const date = addDays(monday, d);
      const dow = d % 7;
      if (dow === 5 + (i % 2)) continue; // one weekend day off, alternating
      if (night) insShift.run(u.id, date, 19 * 60, 28 * 60);   // 19:00–04:00 next day
      else insShift.run(u.id, date, 10 * 60, 19 * 60);          // 10:00–19:00
    }
    for (let d = -13; d <= 0; d++) {
      insStat.run(u.id, addDays(today, d), Math.round(rnd(45, 90)), Math.round(rnd(240, 420)),
        +rnd(78, 98).toFixed(1), +rnd(3.8, 4.9).toFixed(2), +rnd(88, 99).toFixed(1));
    }
  }
})();

console.log('Demo data ready. Agents: agent1 … agent6, password:', PASSWORD);
