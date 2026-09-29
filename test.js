// Run with: npm test   (uses a throwaway database, leaves your real data alone)
const os = require('os');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-test-'));
process.env.SESSION_SECRET = 'test-secret';
process.env.ADMIN_PASSWORD = 'first-pass-1';
process.env.STATS_API_KEY = 'test-key';

const { app, addDays } = require('./server');

const server = app.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const client = () => {
    let cookie = '';
    return async (method, url, body, headers = {}) => {
      const r = await fetch(base + url, {
        method, headers: { 'content-type': 'application/json', cookie, ...headers },
        body: body ? JSON.stringify(body) : undefined
      });
      const sc = r.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
  };
  let passed = 0;
  const ok = (name, cond) => { assert.ok(cond, name); passed++; console.log('  ✓', name); };

  try {
    const mgr = client();
    let r = await mgr('POST', '/login', { username: 'manager', password: 'nope' });
    ok('wrong password is rejected', r.status === 401);
    r = await mgr('POST', '/login', { username: 'manager', password: 'first-pass-1' });
    ok('manager can sign in and must change password', r.status === 200 && r.body.must_change_password);
    r = await mgr('GET', '/week');
    ok('data is locked until the password is changed', r.status === 403);
    r = await mgr('POST', '/password', { current: 'first-pass-1', next: 'manager-pass-2' });
    ok('password change works', r.status === 200);

    for (const n of [1, 2, 3]) {
      r = await mgr('POST', '/users', { name: `Agent ${n}`, username: `agent${n}`, password: 'temp-pass-1' });
      ok(`agent ${n} created`, r.status === 200);
    }
    r = await mgr('POST', '/users', { name: 'Dup', username: 'AGENT1', password: 'temp-pass-1' });
    ok('usernames are unique regardless of case', r.status === 400);

    const users = (await mgr('GET', '/users')).body.filter(u => u.role === 'agent');
    const date = addDays(new Date().toISOString().slice(0, 10), 3);
    for (const u of users) {
      r = await mgr('PUT', '/shifts', { user_id: u.id, dates: [date], start_min: 19 * 60, end_min: 28 * 60 });
      ok(`overnight shift saved for ${u.name}`, r.status === 200);
    }
    r = await mgr('PUT', '/shifts', { user_id: users[0].id, dates: [date], start_min: 600, end_min: 500 });
    ok('end before start is rejected', r.status === 400);

    const agents = [];
    for (const n of [1, 2, 3]) {
      const c = client();
      await c('POST', '/login', { username: `agent${n}`, password: 'temp-pass-1' });
      await c('POST', '/password', { current: 'temp-pass-1', next: `agent-pass-${n}${n}` });
      agents.push(c);
    }
    const types = (await agents[0]('GET', '/settings')).body.break_types;
    const short = types.find(t => t.name === 'Short break');
    ok('default break types exist', !!short && short.minutes === 15);

    r = await agents[0]('GET', `/availability?date=${date}&type_id=${short.id}`);
    ok('availability lists slots inside the shift', r.body.slots.length > 0 && r.body.slots[0].start_min === 19 * 60);
    ok('buffer blocks the first slot', r.body.slots[0].ok === false && r.body.slots[0].reason === 'BUFFER');

    const at = 21 * 60;
    r = await agents[0]('POST', '/breaks', { date, start_min: at, type_id: short.id });
    ok('agent 1 books a break', r.status === 200);
    r = await agents[1]('POST', '/breaks', { date, start_min: at, type_id: short.id });
    ok('agent 2 books the same time (2 allowed)', r.status === 200);
    r = await agents[2]('POST', '/breaks', { date, start_min: at, type_id: short.id });
    ok('agent 3 is blocked by the concurrency cap', r.status === 409 && r.body.code === 'CAP');
    r = await agents[2]('POST', '/breaks', { date, start_min: at + 15, type_id: short.id });
    ok('agent 3 can book the next free slot', r.status === 200);
    r = await agents[0]('POST', '/breaks', { date, start_min: at + 5, type_id: short.id });
    ok('off-grid start times are rejected', r.status === 409 || r.status === 400);
    const meal = types.find(t => t.name === 'Meal break');
    r = await agents[0]('POST', '/breaks', { date, start_min: at - 15, type_id: meal.id });
    ok('own overlapping breaks are rejected', r.status === 409 && r.body.code === 'OVERLAP');
    r = await agents[0]('POST', '/breaks', { date, start_min: 23 * 60, type_id: short.id });
    ok('agent 1 books a second short break', r.status === 200);
    r = await agents[0]('POST', '/breaks', { date, start_min: 25 * 60, type_id: short.id });
    ok('per-shift limit is enforced', r.status === 409 && r.body.code === 'LIMIT');

    const week = (await agents[0]('GET', '/week?start=' + date)).body;
    ok('agents only see their own rows', week.users.length === 1 && week.breaks.every(b => b.user_id === week.users[0].id));
    const otherBreak = (await mgr('GET', '/week?start=' + date)).body.breaks.find(b => b.user_id !== week.users[0].id);
    r = await agents[0]('DELETE', `/breaks/${otherBreak.id}`);
    ok("agents can't cancel someone else's break", r.status === 403);
    r = await agents[0]('GET', '/users');
    ok('agents cannot list users', r.status === 403);
    r = await agents[0]('GET', '/stats');
    ok('agents cannot see stats', r.status === 403);

    r = await mgr('PUT', '/shifts', { user_id: users[0].id, dates: [date], start_min: 19 * 60, end_min: 22 * 60 });
    ok('shrinking a shift drops breaks that no longer fit', r.body.removed_breaks === 1);

    r = await mgr('POST', '/shifts/copy-week', { from_start: date, to_start: addDays(date, 7) });
    ok('copy week duplicates shifts', r.status === 200 && r.body.copied === 3);

    r = await mgr('POST', '/stats/ingest', { rows: [] }, { 'x-api-key': 'wrong' });
    ok('stats import rejects a bad key', r.status === 401);
    r = await mgr('POST', '/stats/ingest', { rows: [{ username: 'agent1', date, contacts_handled: 50, avg_handle_sec: 300, quality_score: 90, csat: 4.5, adherence_pct: 95 }] }, { 'x-api-key': 'test-key' });
    ok('stats import saves rows', r.status === 200 && r.body.saved === 1);
    r = await mgr('GET', `/stats?from=${date}&to=${date}`);
    ok('manager sees stats', r.status === 200 && r.body.rows.find(x => x.name === 'Agent 1').contacts === 50);

    console.log(`\nAll ${passed} checks passed.`);
    server.close(); process.exit(0);
  } catch (e) {
    console.error('\nFAILED:', e.message); server.close(); process.exit(1);
  }
});
