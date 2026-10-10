process.env.TZ = 'Asia/Karachi'; // Portal timezone: Pakistan Time (PKT, UTC+5)
const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const app = express();

// Signed auth cookies: COOKIE_SECRET must be set in production (Railway variables)
// so login cookies cannot be forged. Otherwise a secret is generated once and
// saved to the persistent volume (survives restarts); as a last resort a random
// boot secret is used (everyone is logged out on restart) — local dev only.
function loadCookieSecret() {
    if (process.env.COOKIE_SECRET) return process.env.COOKIE_SECRET;
    try {
        const dataDir = process.env.DATA_DIR;
        if (dataDir && fs.existsSync(dataDir)) {
            const secretFile = path.join(dataDir, '.cookie_secret');
            if (fs.existsSync(secretFile)) {
                const saved = fs.readFileSync(secretFile, 'utf8').trim();
                if (saved) return saved;
            }
            const fresh = crypto.randomBytes(32).toString('hex');
            fs.writeFileSync(secretFile, fresh, { mode: 0o600 });
            console.log('Generated and saved a persistent cookie secret.');
            return fresh;
        }
    } catch (e) {
        console.error('Cookie secret setup failed:', e.message);
    }
    console.log('WARNING: COOKIE_SECRET is not set — using a random boot secret. Set COOKIE_SECRET in Railway variables.');
    return crypto.randomBytes(32).toString('hex');
}
const COOKIE_SECRET = loadCookieSecret();

// Persistent database: use the Railway volume at DATA_DIR when available
// (survives redeploys); otherwise fall back to the bundled database file.
let DB_PATH = path.join(__dirname, 'database.db');
try {
    const dataDir = process.env.DATA_DIR;
    if (dataDir && fs.existsSync(dataDir)) {
        const volPath = path.join(dataDir, 'database.db');
        if (!fs.existsSync(volPath)) {
            fs.copyFileSync(path.join(__dirname, 'database.db'), volPath);
            console.log('Seeded persistent database from bundled copy.');
        }
        DB_PATH = volPath;
    }
} catch (e) {
    console.error('Persistent DB setup failed, using bundled DB:', e.message);
}

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) console.error('DB Error:', err.message);
    else console.log('Connected to SQLite database at ' + DB_PATH);
});

// Agents Data with Unique Passwords
const agentsData = [
    { username: 'hugo', name: 'Hugo Schmidt', password: 'Hugo#9214', schedule: ['17:00 - 02:00', '17:00 - 02:00', '17:00 - 02:00', '17:00 - 02:00', '17:00 - 02:00', 'OFF', 'OFF'] },
    { username: 'carter', name: 'Carter Casey', password: 'Carter$3851', schedule: ['23:00 - 08:00', '23:00 - 08:00', '23:00 - 08:00', '23:00 - 08:00', 'OFF', 'OFF', '23:00 - 08:00'] },
    { username: 'jared', name: 'Jared', password: 'Jared&7429', schedule: ['00:00 - 09:00', '00:00 - 09:00', 'OFF', 'OFF', '00:00 - 09:00', '00:00 - 09:00', '00:00 - 09:00'] },
    { username: 'john', name: 'John Jones', password: 'John*6105', schedule: ['OFF', 'OFF', '17:00 - 02:00', '17:00 - 02:00', '17:00 - 02:00', '17:00 - 02:00', '17:00 - 02:00'] },
    { username: 'mia', name: 'Mia Mall', password: 'Mia@4932', schedule: ['20:00 - 05:00', '20:00 - 05:00', '20:00 - 05:00', '20:00 - 05:00', '20:00 - 05:00', 'OFF', 'OFF'] },
    { username: 'xavier', name: 'Xavier David', password: 'Xavier#8017', schedule: ['17:00 - 02:00', '17:00 - 05:00', '17:00 - 02:00', '17:00 - 02:00', '17:00 - 02:00', 'OFF', 'OFF'] },
    { username: 'shawn', name: 'Shawn Smith', password: 'Shawn!2564', schedule: ['17:00 - 02:00', '17:00 - 02:00', '17:00 - 02:00', 'OFF', 'OFF', '17:00 - 02:00', '17:00 - 02:00'] }
];

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        full_name TEXT,
        role TEXT,
        mon TEXT, tue TEXT, wed TEXT, thu TEXT, fri TEXT, sat TEXT, sun TEXT
    )`, () => {
        db.get(`SELECT * FROM users WHERE username = 'manager'`, (err, row) => {
            if (!row) {
                // Fresh install: the app owner's login, created with the Owner role.
                db.run(`INSERT INTO users (username, password, full_name, role) VALUES ('manager', ?, 'System Manager', 'owner')`,
                    [bcrypt.hashSync('Ft37kFOT', 10)]);
            } else if (row.role === 'manager') {
                // One-time migration: promote the original manager login to Owner.
                db.run(`UPDATE users SET role = 'owner' WHERE username = 'manager'`);
            }
        });

        // Seed defaults ONLY for users that don't exist yet. Never overwrite
        // existing rows here — schedules edited via the dashboard must persist
        // across restarts/redeploys.
        agentsData.forEach(agent => {
            db.get(`SELECT * FROM users WHERE username = ?`, [agent.username], (err, row) => {
                if (!row) {
                    db.run(`INSERT INTO users (username, password, full_name, role, mon, tue, wed, thu, fri, sat, sun) 
                        VALUES (?, ?, ?, 'agent', ?, ?, ?, ?, ?, ?, ?)`,
                        [agent.username, bcrypt.hashSync(agent.password, 10), agent.name, agent.schedule[0], agent.schedule[1], agent.schedule[2], agent.schedule[3], agent.schedule[4], agent.schedule[5], agent.schedule[6]]);
                }
            });
        });
    });

    db.run(`CREATE TABLE IF NOT EXISTS links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        full_name TEXT,
        link TEXT,
        date TEXT
    )`);
    // Migration: exact submission time, used for the agent-shift duplicate check.
    // Runs on every boot; the error is ignored when the column already exists.
    db.run(`ALTER TABLE links ADD COLUMN submitted_at INTEGER`, () => {});
    // Multi-week schedules: one row per agent per week (week_start = Monday).
    db.run(`CREATE TABLE IF NOT EXISTS schedules (
        username TEXT NOT NULL,
        week_start TEXT NOT NULL,
        mon TEXT, tue TEXT, wed TEXT, thu TEXT, fri TEXT, sat TEXT, sun TEXT,
        PRIMARY KEY (username, week_start)
    )`);
    // One-time backfill: copy every agent's live mon..sun into the schedules
    // table for the current week, so the new system starts from the schedule
    // already in use. INSERT OR IGNORE keeps it idempotent across boots.
    db.run(`INSERT OR IGNORE INTO schedules (username, week_start, mon, tue, wed, thu, fri, sat, sun)
            SELECT username, ?, mon, tue, wed, thu, fri, sat, sun FROM users WHERE role = 'agent'`,
        [getWeekStart(new Date())], () => {});
    // Migration: follow-up flag for links logged via the Follow Up button.
    // Runs on every boot; the error is ignored when the column already exists.
    db.run(`ALTER TABLE links ADD COLUMN is_followup INTEGER DEFAULT 0`, () => {});

    db.run(`CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
    )`, () => {
        db.get(`SELECT * FROM meta WHERE key = 'schedule_range'`, (err, row) => {
            if (!row) {
                db.run(`INSERT INTO meta (key, value) VALUES ('schedule_range', 'Mon 28 Sep 2026 - Sun 04 Oct 2026')`);
            }
        });
    });
});

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser(COOKIE_SECRET));
app.use(express.static(path.join(__dirname, 'public')));

// --- Role-based auth helpers ---
// Roles: 'owner' (app owner, full access), 'manager' (day-to-day management),
// 'agent' (own page only). Auth cookies are signed, so they cannot be forged.
function getAuth(req) {
    const c = req.signedCookies || {};
    return { user: c.auth_user || null, role: c.auth_role || null };
}
function requireLogin(req, res, next) {
    if (!getAuth(req).user) return res.redirect('/login');
    next();
}
function requireManager(req, res, next) {  // manager OR owner
    const { role } = getAuth(req);
    if (role === 'manager' || role === 'owner') return next();
    return res.redirect('/login');
}
function requireOwner(req, res, next) {
    if (getAuth(req).role === 'owner') return next();
    return res.redirect('/login');
}

// Agents may only use the portal from a desktop/laptop ("system").
// Managers and owners are exempt from this rule.
function isMobileUA(ua) {
    return /mobi|android|iphone|ipod|ipad|tablet|blackberry|iemobile|opera mini|windows phone/i.test(ua || '');
}
function blockAgentOnMobile(req, res, next) {
    const { role } = getAuth(req);
    if (role === 'agent' && isMobileUA(req.get('User-Agent'))) {
        return res.status(403).render('desktop-only');
    }
    next();
}

// One-time-style account recovery code for the Owner (shown on the owner
// dashboard; usable on the "Forgot password?" page if the owner is locked out).
// 12 chars from an unambiguous alphabet: ~60 bits of entropy.
function generateRecoveryCode() {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const bytes = crypto.randomBytes(12);
    let s = '';
    for (let i = 0; i < 12; i++) s += alphabet[bytes[i] % alphabet.length];
    return s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8, 12);
}

function getShiftDate() {
    const d = new Date();
    if (d.getHours() < 12) {
        d.setDate(d.getDate() - 1);
    }
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Weekday keys indexed by Date.getDay() (0=Sunday).
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Monday ('YYYY-MM-DD') of the week containing `d`, in portal time (PKT).
// Weeks run Monday->Sunday.
function getWeekStart(d) {
    const x = new Date(d);
    const diff = (x.getDay() + 6) % 7; // days since Monday
    x.setDate(x.getDate() - diff);
    const y = x.getFullYear(), m = String(x.getMonth() + 1).padStart(2, '0'), dd = String(x.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

// Add n days to a 'YYYY-MM-DD' date string.
function addDaysStr(dateStr, n) {
    const parts = dateStr.split('-').map(Number);
    const x = new Date(parts[0], parts[1] - 1, parts[2]);
    x.setDate(x.getDate() + n);
    const y = x.getFullYear(), m = String(x.getMonth() + 1).padStart(2, '0'), dd = String(x.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

// Human label for a week: 'Mon 12 Oct - Sun 18 Oct'.
function formatWeekLabel(weekStart) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const parts = weekStart.split('-').map(Number);
    const mon = new Date(parts[0], parts[1] - 1, parts[2]);
    const sun = new Date(parts[0], parts[1] - 1, parts[2] + 6);
    return 'Mon ' + mon.getDate() + ' ' + months[mon.getMonth()] + ' - Sun ' + sun.getDate() + ' ' + months[sun.getMonth()];
}

// Schedule row for one agent + one week (Monday 'YYYY-MM-DD'). Falls back to
// the users table (the pre-multi-week schedule) when no row exists yet.
function getScheduleForWeek(username, weekStart, cb) {
    db.get(`SELECT mon, tue, wed, thu, fri, sat, sun FROM schedules WHERE username = ? AND week_start = ?`,
        [username, weekStart], (err, row) => {
            if (row) return cb(row);
            db.get(`SELECT mon, tue, wed, thu, fri, sat, sun FROM users WHERE username = ?`, [username], (err, u) => cb(u || {}));
        });
}

// Builds schedFor(date) -> schedule string for that date's weekday. Loads the
// schedule rows for the weeks containing `now` and yesterday (they can differ
// across a Monday boundary), so overnight shifts at week edges stay correct.
function loadSchedFor(username, now, cb) {
    const wsToday = getWeekStart(now);
    const yest = new Date(now); yest.setDate(yest.getDate() - 1);
    const wsYest = getWeekStart(yest);
    getScheduleForWeek(username, wsToday, (schedToday) => {
        if (wsYest === wsToday) {
            cb((d) => schedToday[DAY_KEYS[d.getDay()]]);
        } else {
            getScheduleForWeek(username, wsYest, (schedYest) => {
                cb((d) => (getWeekStart(d) === wsToday ? schedToday : schedYest)[DAY_KEYS[d.getDay()]]);
            });
        }
    });
}

// Shift key for the break reset: changes when the agent's shift ENDS (not only
// when the next one starts), so breaks refresh even in the gap between shifts.
// Returns 'shift:<startMs>' while inside a shift, 'ended:<endMs>' after it ended,
// and 'sys:<date>' when the schedule is OFF/unparseable (falls back to system shift).
function getAgentShiftKey(schedFor, now) {
    const parseShift = (sched) => {
        if (typeof sched !== 'string') return null;
        const m = sched.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
        if (!m) return null;
        return { sh: parseInt(m[1], 10), sm: parseInt(m[2], 10), eh: parseInt(m[3], 10), em: parseInt(m[4], 10) };
    };
    const atTime = (d, h, mi) => {
        const x = new Date(d);
        x.setHours(h, mi, 0, 0);
        return x.getTime();
    };
    const nowMs = now.getTime();
    for (const offset of [0, 1]) {
        const d = new Date(now);
        d.setDate(d.getDate() - offset);
        const t = parseShift(schedFor(d));
        if (!t) continue;
        const S = atTime(d, t.sh, t.sm);
        let E = atTime(d, t.eh, t.em);
        if (E <= S) E += 24 * 3600 * 1000; // overnight shift ends next day
        if (S > nowMs) continue; // today's shift hasn't started yet
        if (nowMs <= E) return 'shift:' + S;
        return 'ended:' + E;
    }
    return 'sys:' + getShiftDate();
}

// Shift progress for the portal rings: which shift matters right now and how far
// along it is. Returns { state, startMs, endMs, startLabel, endLabel } where state
// is 'in' (shift running), 'ended' (shift finished), 'upcoming' (today's shift
// hasn't started yet) or 'off' (no shift today/yesterday).
function getShiftProgressInfo(schedFor, now) {
    const parseShift = (sched) => {
        if (typeof sched !== 'string') return null;
        const m = sched.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
        if (!m) return null;
        return { sh: parseInt(m[1], 10), sm: parseInt(m[2], 10), eh: parseInt(m[3], 10), em: parseInt(m[4], 10) };
    };
    const atTime = (d, h, mi) => {
        const x = new Date(d);
        x.setHours(h, mi, 0, 0);
        return x.getTime();
    };
    const fmt = (ms) => {
        const d = new Date(ms);
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    };
    const nowMs = now.getTime();
    const windowOf = (d) => {
        const t = parseShift(schedFor(d));
        if (!t) return null;
        const S = atTime(d, t.sh, t.sm);
        let E = atTime(d, t.eh, t.em);
        if (E <= S) E += 24 * 3600 * 1000;
        return { S, E };
    };
    const info = (S, E) => ({ startMs: S, endMs: E, startLabel: fmt(S), endLabel: fmt(E) });
    const yest = new Date(now);
    yest.setDate(yest.getDate() - 1);
    const yw = windowOf(yest);
    const today = new Date(now);
    const tw = windowOf(today);
    // Overnight first: yesterday's shift may still be running past midnight
    if (yw && nowMs <= yw.E && (!tw || nowMs < tw.S)) {
        return { state: 'in', ...info(yw.S, yw.E) };
    }
    if (tw) {
        if (nowMs < tw.S) return { state: 'upcoming', ...info(tw.S, tw.E) };
        if (nowMs <= tw.E) return { state: 'in', ...info(tw.S, tw.E) };
        return { state: 'ended', ...info(tw.S, tw.E) };
    }
    if (yw) return { state: 'ended', ...info(yw.S, yw.E) };
    return { state: 'off' };
}

// Agent's own shift: timestamp (ms) of when the agent's current shift started,
// derived from their schedule (e.g. "17:00 - 02:00"). "Current shift" means the
// most recently started shift. Returns null when the schedule is OFF or
// unparseable — callers then fall back to the system shift date.
function getAgentShiftStartMs(schedFor, now) {
    const parseStart = (sched) => {
        const m = typeof sched === 'string' && sched.match(/(\d{1,2}):(\d{2})/);
        return m ? { h: parseInt(m[1], 10), m: parseInt(m[2], 10) } : null;
    };
    const atTime = (d, t) => {
        const x = new Date(d);
        x.setHours(t.h, t.m, 0, 0);
        return x.getTime();
    };
    const todayStart = parseStart(schedFor(now));
    if (todayStart && now.getTime() >= atTime(now, todayStart)) {
        return atTime(now, todayStart);
    }
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    const yStart = parseStart(schedFor(y));
    if (yStart) return atTime(y, yStart);
    return null;
}

app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (err || !user) {
            return res.render('login', { error: 'Invalid username or password' });
        }

        const stored = user.password || '';
        const isHash = /^\$2[aby]\$/.test(stored);
        const ok = isHash ? bcrypt.compareSync(password, stored) : password === stored;

        if (!ok) {
            return res.render('login', { error: 'Invalid username or password' });
        }

        if (user.role === 'agent' && isMobileUA(req.get('User-Agent'))) {
            return res.render('login', { error: "This page isn't supported on mobile devices." });
        }

        if (!isHash) {
            // Transparent migration: upgrade this plaintext password to a bcrypt hash
            db.run(`UPDATE users SET password = ? WHERE id = ?`, [bcrypt.hashSync(password, 10), user.id]);
        }

        res.cookie('auth_user', user.username, { httpOnly: true, signed: true });
        res.cookie('auth_role', user.role, { httpOnly: true, signed: true });

        if (user.role === 'owner' || user.role === 'manager') {
            res.redirect('/manager');
        } else {
            res.redirect(`/agent/${user.username}`);
        }
    });
});

app.get('/logout', (req, res) => {
    res.clearCookie('auth_user');
    res.clearCookie('auth_role');
    res.redirect('/login');
});

app.get('/agent/:username', blockAgentOnMobile, (req, res) => {
    const requestedUsername = req.params.username;
    const { user: loggedUser, role: loggedRole } = getAuth(req);

    if (!loggedUser || (loggedRole === 'agent' && loggedUser !== requestedUsername)) {
        return res.redirect('/login');
    }

    // Effective schedule for the current week: future weeks auto-activate by
    // date, so the agent portal always follows the right week's schedule.
    const schedNow = new Date();
    getScheduleForWeek(requestedUsername, getWeekStart(schedNow), (schedWeek) => {
    loadSchedFor(requestedUsername, schedNow, (schedFor) => {
    db.get(`SELECT * FROM users WHERE username = ? AND role = 'agent'`, [requestedUsername], (err, user) => {
        if (!user) return res.redirect('/login');

        const shiftDate = getShiftDate();
        const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        const todayDayKey = days[new Date().getDay()];

        // Breaks reset with the agent's own shift. break_shift_<username> records which
        // shift the break cookies belong to; a new shift means fresh 30/15/15 breaks,
        // whether the browser stayed open or was closed.
        const breakShiftKey = getAgentShiftKey(schedFor, schedNow);
        const ownBreaks = loggedRole === 'agent' && loggedUser === requestedUsername;
        let b1Rem, b2Rem, b3Rem, breakStatus, breakStartTime, breakExceed;
        if (ownBreaks && req.cookies[`break_shift_${user.username}`] !== breakShiftKey) {
            b1Rem = 30; b2Rem = 15; b3Rem = 15;
            breakStatus = 'off'; breakStartTime = null; breakExceed = 0;
            res.clearCookie(`break_${user.username}`);
            res.clearCookie(`break_start_${user.username}`);
            res.clearCookie(`b1_rem_${user.username}`);
            res.clearCookie(`b2_rem_${user.username}`);
            res.clearCookie(`b3_rem_${user.username}`);
            res.clearCookie(`exceed_${user.username}`);
            res.cookie(`break_shift_${user.username}`, breakShiftKey, { httpOnly: true });
        } else {
            b1Rem = req.cookies[`b1_rem_${user.username}`] !== undefined ? parseInt(req.cookies[`b1_rem_${user.username}`]) : 30;
            b2Rem = req.cookies[`b2_rem_${user.username}`] !== undefined ? parseInt(req.cookies[`b2_rem_${user.username}`]) : 15;
            b3Rem = req.cookies[`b3_rem_${user.username}`] !== undefined ? parseInt(req.cookies[`b3_rem_${user.username}`]) : 15;
            breakStatus = req.cookies[`break_${user.username}`] || 'off';
            breakStartTime = req.cookies[`break_start_${user.username}`] || null;
            breakExceed = req.cookies[`exceed_${user.username}`] !== undefined ? parseInt(req.cookies[`exceed_${user.username}`]) : 0;
        }

        db.get(`SELECT value FROM meta WHERE key = 'schedule_range'`, (err, metaRow) => {
            const scheduleRange = metaRow ? metaRow.value : 'Current Week Schedule';

            db.get(`SELECT COUNT(*) as count FROM links WHERE username = ? AND date = ? AND COALESCE(is_followup,0) = 0`, [user.username, shiftDate], (err, row) => {
                const userLinksCount = row ? row.count : 0;

                db.all(`SELECT full_name, SUM(CASE WHEN COALESCE(is_followup,0)=0 THEN 1 ELSE 0 END) as count, SUM(CASE WHEN COALESCE(is_followup,0)=1 THEN 1 ELSE 0 END) as followups FROM links WHERE date = ? GROUP BY username ORDER BY count DESC`, [shiftDate], (err, leaderboard) => {
                    db.all(`SELECT id, link, is_followup FROM links WHERE username = ? AND date = ? ORDER BY id DESC`, [user.username, shiftDate], (err, recentLinks) => {
                        db.get(`SELECT value FROM meta WHERE key = ?`, [`recovery_code_${requestedUsername}`], (err, rcRow) => {
                        const ownPage = loggedRole === 'agent' && loggedUser === requestedUsername;
                        const recoveryCode = ownPage && rcRow && rcRow.value ? rcRow.value : null;
                        res.render('agent', {
                            username: user.username,
                            fullName: user.full_name,
                            userLinksCount: userLinksCount,
                            leaderboard: leaderboard || [],
                            mySchedule: schedWeek,
                            scheduleRange: scheduleRange,
                            todayDayKey: todayDayKey,
                            breakStatus: breakStatus,
                            breakStartTime: breakStartTime,
                            b1Rem: b1Rem,
                            b2Rem: b2Rem,
                            b3Rem: b3Rem,
                            error: req.query.error || null,
                            success: req.query.success || null,
                            isFollowupMsg: !!req.query.followup,
                            breaknotice: req.query.breaknotice || null,
                            breakExceed: breakExceed,
                            shiftInfo: getShiftProgressInfo(schedFor, schedNow),
                            recentLinks: recentLinks || [],
                            recoveryCode: recoveryCode
                        });
                        });
                    });
                });
            });
        });
    });
    }); // end getScheduleForWeek
    }); // end loadSchedFor
});

app.post('/submit-link/:username', blockAgentOnMobile, (req, res) => {
    const requestedUsername = req.params.username;
    const { user: loggedUser } = getAuth(req);

    if (!loggedUser || loggedUser !== requestedUsername) {
        return res.redirect('/login');
    }

    const { link } = req.body;
    const shiftDate = getShiftDate();

    db.get(`SELECT * FROM users WHERE username = ?`, [requestedUsername], (err, user) => {
        if (!user) return res.redirect('/login');

        db.run(`INSERT INTO links (username, full_name, link, date, submitted_at, is_followup) VALUES (?, ?, ?, ?, ?, 0)`,
            [user.username, user.full_name, link, shiftDate, Date.now()], (err) => {
            res.redirect(`/agent/${requestedUsername}?success=` + encodeURIComponent('Link successfully logged!'));
        });
    });
});

// Log a follow-up link via the Follow Up button (same form, different endpoint).
// Follow-ups are tracked separately: they don't count toward link totals and
// skip the duplicate check (a follow-up is inherently a re-post of a link).
app.post('/submit-followup/:username', blockAgentOnMobile, (req, res) => {
    const requestedUsername = req.params.username;
    const { user: loggedUser } = getAuth(req);

    if (!loggedUser || loggedUser !== requestedUsername) {
        return res.redirect('/login');
    }

    const { link } = req.body;
    const shiftDate = getShiftDate();

    db.get(`SELECT * FROM users WHERE username = ?`, [requestedUsername], (err, user) => {
        if (!user) return res.redirect('/login');

        db.run(`INSERT INTO links (username, full_name, link, date, submitted_at, is_followup) VALUES (?, ?, ?, ?, ?, 1)`,
            [user.username, user.full_name, link, shiftDate, Date.now()], (err) => {
            res.redirect(`/agent/${requestedUsername}?success=` + encodeURIComponent('Follow-up logged!') + `&followup=1`);
        });
    });
});

// Live duplicate check for the agent link form (same agent, current shift)
app.get('/api/check-duplicate', requireLogin, blockAgentOnMobile, (req, res) => {
    const { user: loggedUser, role: loggedRole } = getAuth(req);
    if (loggedRole !== 'agent') return res.json({ duplicate: false });
    const link = req.query.link || '';
    if (!link) return res.json({ duplicate: false });
    const dupNow = new Date();
    loadSchedFor(loggedUser, dupNow, (schedFor) => {
    db.get(`SELECT * FROM users WHERE username = ?`, [loggedUser], (err, user) => {
        if (err || !user) return res.json({ duplicate: false });
        const shiftStartMs = getAgentShiftStartMs(schedFor, dupNow);
        if (shiftStartMs === null) {
            // No usable schedule (OFF / unparseable): fall back to the system shift date
            const shiftDate = getShiftDate();
            db.get(`SELECT id FROM links WHERE link = ? AND username = ? AND date = ?`,
                [link, loggedUser, shiftDate], (err, row) => res.json({ duplicate: !!row }));
            return;
        }
        // Same agent + same link + submitted since this agent's shift started.
        // (The IS NULL branch covers links saved before submitted_at existed.)
        db.get(`SELECT id FROM links WHERE link = ? AND username = ?
                AND (submitted_at >= ? OR (submitted_at IS NULL AND date = ?))`,
            [link, loggedUser, shiftStartMs, getShiftDate()], (err, row) => res.json({ duplicate: !!row }));
    });
    }); // end loadSchedFor
});

// Delete one of the agent's own links (e.g. wrongly entered)
app.post('/delete-link/:username', blockAgentOnMobile, (req, res) => {
    const requestedUsername = req.params.username;
    const { user: loggedUser } = getAuth(req);
    if (!loggedUser || loggedUser !== requestedUsername) {
        return res.redirect('/login');
    }
    const linkId = parseInt(req.body.link_id);
    if (!linkId) return res.redirect(`/agent/${requestedUsername}`);
    db.run(`DELETE FROM links WHERE id = ? AND username = ?`, [linkId, requestedUsername], () => {
        res.redirect(`/agent/${requestedUsername}?success=` + encodeURIComponent('Link deleted.'));
    });
});

app.post('/toggle-break/:username', blockAgentOnMobile, (req, res) => {
    const requestedUsername = req.params.username;
    const { user: loggedUser, role: loggedRole } = getAuth(req);

    if (!loggedUser || (loggedRole === 'agent' && loggedUser !== requestedUsername)) {
        return res.redirect('/login');
    }

    const newStatus = req.body.status || 'off';
    const currentStatus = req.cookies[`break_${requestedUsername}`] || 'off';
    const startTime = req.cookies[`break_start_${requestedUsername}`];

    if (currentStatus !== 'off' && newStatus === 'off' && startTime) {
        const elapsedSecs = Math.floor((Date.now() - parseInt(startTime)) / 1000);
        const elapsedMins = Math.ceil(elapsedSecs / 60);

        let remKey = currentStatus === 'break1' ? `b1_rem_${requestedUsername}` : (currentStatus === 'break2' ? `b2_rem_${requestedUsername}` : `b3_rem_${requestedUsername}`);
        let currentRem = req.cookies[remKey] !== undefined ? parseInt(req.cookies[remKey]) : (currentStatus === 'break1' ? 30 : 15);
        const breakTotal = currentStatus === 'break1' ? 30 : 15;
        const breakLabel = currentStatus === 'break1' ? 'Break 1' : (currentStatus === 'break2' ? 'Break 2' : 'Break 3');
        const exceededMins = Math.max(0, elapsedMins - currentRem);

        currentRem = Math.max(0, currentRem - elapsedMins);
        res.cookie(remKey, currentRem, { httpOnly: true });
        res.clearCookie(`break_start_${requestedUsername}`);

        if (exceededMins > 0) {
            const prevExceed = req.cookies[`exceed_${requestedUsername}`] !== undefined ? parseInt(req.cookies[`exceed_${requestedUsername}`]) : 0;
            res.cookie(`exceed_${requestedUsername}`, prevExceed + exceededMins, { httpOnly: true });
            res.cookie(`break_${requestedUsername}`, 'off', { httpOnly: true });
            return res.redirect(`/agent/${requestedUsername}?breaknotice=` + encodeURIComponent(`Break ended — you went ${exceededMins} min over your ${breakLabel} (${breakTotal} min). ${exceededMins} min deducted from overall break time.`));
        }
    }

    if (newStatus !== 'off') {
        res.cookie(`break_start_${requestedUsername}`, Date.now(), { httpOnly: true });
    }

    res.cookie(`break_${requestedUsername}`, newStatus, { httpOnly: true });
    res.redirect(`/agent/${requestedUsername}`);
});

app.get('/manager', requireManager, (req, res) => {
    const { user: loggedUser, role: loggedRole } = getAuth(req);
    const isOwner = loggedRole === 'owner';

    const selectedDate = req.query.date || '';
    const selectedAgent = req.query.agent || '';

    let query = `SELECT * FROM links WHERE 1=1`;
    let params = [];

    if (selectedDate) {
        query += ` AND date = ?`;
        params.push(selectedDate);
    }
    if (selectedAgent) {
        query += ` AND username = ?`;
        params.push(selectedAgent);
    }

    query += ` ORDER BY id DESC`;
    
    db.all(query, params, (err, filteredLinks) => {
        db.all(`SELECT * FROM users WHERE role = 'agent' ORDER BY full_name`, (err, agents) => {
            db.all(`SELECT username, full_name, date, COUNT(*) as total_links FROM links GROUP BY username, date ORDER BY date DESC, total_links DESC`, (err, dailyStats) => {
                db.get(`SELECT value FROM meta WHERE key = 'schedule_range'`, (err, metaRow) => {
                    db.all(`SELECT username, full_name, email, role FROM users WHERE role IN ('owner', 'manager') ORDER BY full_name`, (err, managers) => {
                        db.get(`SELECT value FROM meta WHERE key = ?`, [`recovery_code_${loggedUser}`], (err, rcRow) => {
                            db.get(`SELECT value FROM meta WHERE key = 'recovery_code'`, (err, legacyRow) => {
                                // Legacy fallback: codes generated before per-user keys (owner only)
                                const legacyCode = (loggedRole === 'owner' && legacyRow && legacyRow.value) ? legacyRow.value : null;
                                const recoveryCode = (rcRow && rcRow.value) || legacyCode || null;
                                // Week tabs for multi-week scheduling: current week onward.
                                // ?week=YYYY-MM-DD selects the week being edited (defaults to current).
                                const selectedWeek = (/^\d{4}-\d{2}-\d{2}$/.test(req.query.week || '')) ? req.query.week : getWeekStart(new Date());
                                const curWeek = getWeekStart(new Date());
                                db.all(`SELECT DISTINCT week_start FROM schedules WHERE week_start >= ? ORDER BY week_start`, [curWeek], (err, weekRows) => {
                                    const weeks = (weekRows || []).map(r => ({ week_start: r.week_start, label: formatWeekLabel(r.week_start), isCurrent: r.week_start === curWeek }));
                                    if (!weeks.some(w => w.week_start === selectedWeek)) {
                                        weeks.unshift({ week_start: selectedWeek, label: formatWeekLabel(selectedWeek), isCurrent: selectedWeek === curWeek });
                                        weeks.sort((a, b) => a.week_start < b.week_start ? -1 : 1);
                                    }
                                    db.all(`SELECT username, mon, tue, wed, thu, fri, sat, sun FROM schedules WHERE week_start = ?`, [selectedWeek], (err, schedRows) => {
                                        const weekSchedules = {};
                                        (schedRows || []).forEach(r => { weekSchedules[r.username] = r; });
                                        // Fall back to the users row for agents with no row this week yet.
                                        (agents || []).forEach(a => {
                                            if (!weekSchedules[a.username]) {
                                                weekSchedules[a.username] = { mon: a.mon, tue: a.tue, wed: a.wed, thu: a.thu, fri: a.fri, sat: a.sat, sun: a.sun };
                                            }
                                        });
                                res.render('manager', {
                                    links: filteredLinks || [],
                                    agents: agents || [],
                                    managers: managers || [],
                                    recoveryCode: recoveryCode,
                                    dailyStats: dailyStats || [],
                                    scheduleRange: metaRow ? metaRow.value : '',
                                    selectedDate: selectedDate,
                                    selectedAgent: selectedAgent,
                                    isOwner: isOwner,
                                    userRole: loggedRole,
                                    success: req.query.success || null,
                                    error: req.query.error || null,
                                    selectedWeek: selectedWeek,
                                    weeks: weeks,
                                    weekSchedules: weekSchedules
                                });
                                    }); // end week schedules
                                }); // end weeks
                            });
                        });
                    });
                });
            });
        });
    });
});

// Printable team schedule preview for any week (?week=YYYY-MM-DD, Monday).
app.get('/manager/preview-schedule', requireManager, (req, res) => {
    const week = (/^\d{4}-\d{2}-\d{2}$/.test(req.query.week || '')) ? req.query.week : getWeekStart(new Date());
    const curWeek = getWeekStart(new Date());
    db.all(`SELECT * FROM users WHERE role = 'agent' ORDER BY full_name`, (err, agents) => {
        db.all(`SELECT username, mon, tue, wed, thu, fri, sat, sun FROM schedules WHERE week_start = ?`, [week], (err, schedRows) => {
            const map = {};
            (schedRows || []).forEach(r => { map[r.username] = r; });
            (agents || []).forEach(a => {
                const w = map[a.username];
                if (w) ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].forEach(k => { a[k] = w[k]; });
            });
            db.all(`SELECT DISTINCT week_start FROM schedules WHERE week_start >= ? ORDER BY week_start`, [curWeek], (err, weekRows) => {
                const weeks = (weekRows || []).map(r => ({ week_start: r.week_start, label: formatWeekLabel(r.week_start), isCurrent: r.week_start === curWeek }));
                res.render('schedule-preview', {
                    agents: agents || [],
                    scheduleRange: formatWeekLabel(week),
                    selectedWeek: week,
                    weeks: weeks
                });
            });
        });
    });
});

// Live leaderboard for agent pages: any agent's submission refreshes everyone's
// leaderboard counts without a page reload (polled every 10s).
app.get('/api/leaderboard-live', requireLogin, (req, res) => {
    db.all(`SELECT username, full_name,
            SUM(CASE WHEN COALESCE(is_followup,0)=0 THEN 1 ELSE 0 END) AS count,
            SUM(CASE WHEN COALESCE(is_followup,0)=1 THEN 1 ELSE 0 END) AS followups
            FROM links WHERE date = ? GROUP BY username ORDER BY count DESC`, [getShiftDate()], (err, rows) => {
        res.json({ ok: true, agents: rows || [] });
    });
});

// Live link feed for the manager dashboard: the page polls this every 10s so
// new agent submissions appear without a manual refresh. since_id lets the
// client fetch only what arrived after its newest row.
app.get('/api/manager-live', requireManager, (req, res) => {
    const sinceId = parseInt(req.query.since_id || '0', 10) || 0;
    db.all(`SELECT id, username, full_name, link, date, is_followup FROM links WHERE id > ? ORDER BY id DESC`, [sinceId], (err, rows) => {
        db.get(`SELECT COUNT(*) AS c FROM links`, (err, row) => {
            res.json({ ok: true, total: row ? row.c : 0, links: rows || [] });
        });
    });
});

app.post('/update-agent-schedule', requireManager, (req, res) => {

    const { username, mon, tue, wed, thu, fri, sat, sun } = req.body;

    db.run(`UPDATE users SET mon = ?, tue = ?, wed = ?, thu = ?, fri = ?, sat = ?, sun = ? WHERE username = ?`,
        [mon, tue, wed, thu, fri, sat, sun, username], (err) => {
            if (err) {
                return res.redirect('/manager?error=' + encodeURIComponent('Failed to update schedule!'));
            }
            res.redirect('/manager?success=' + encodeURIComponent(`Schedule successfully updated for ${username}!`));
        });
});

// Save ALL agents' schedules for one week in a single submit (one form -> one
// save). Body: week_start ('YYYY-MM-DD', Monday) and sched[username][mon..sun].
// When the saved week is the current week, users.mon..sun is refreshed too so
// the legacy fallback stays in sync.
app.post('/update-week-schedule', requireManager, (req, res) => {
    const weekStart = (req.body.week_start || '').trim();
    const sched = req.body.sched || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
        return res.redirect('/manager?error=' + encodeURIComponent('Invalid week selected.'));
    }
    db.all(`SELECT username FROM users WHERE role = 'agent'`, (err, agentRows) => {
        const valid = new Set((agentRows || []).map(r => r.username));
        const usernames = Object.keys(sched).filter(u => valid.has(u));
        if (usernames.length === 0) {
            return res.redirect('/manager?week=' + weekStart);
        }
        const isCurrentWeek = weekStart === getWeekStart(new Date());
        let pending = usernames.length;
        let failed = false;
        const finishOne = () => {
            if (--pending === 0) {
                const qs = '/manager?week=' + weekStart + (failed
                    ? '&error=' + encodeURIComponent('Some schedules failed to save.')
                    : '&success=' + encodeURIComponent('Schedules saved for week of ' + formatWeekLabel(weekStart) + '!'));
                res.redirect(qs);
            }
        };
        usernames.forEach((un) => {
            const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
                .map(k => ((sched[un] && sched[un][k]) || '').trim());
            db.run(`INSERT OR REPLACE INTO schedules (username, week_start, mon, tue, wed, thu, fri, sat, sun)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [un, weekStart, ...days], (err) => {
                    if (err) { failed = true; return finishOne(); }
                    if (isCurrentWeek) {
                        db.run(`UPDATE users SET mon = ?, tue = ?, wed = ?, thu = ?, fri = ?, sat = ?, sun = ? WHERE username = ?`,
                            [...days, un], () => finishOne());
                    } else {
                        finishOne();
                    }
                });
        });
    });
});

// Create the next schedule week (after the latest existing week), pre-filled as
// a copy of the latest week so the manager edits rather than retypes. No limit
// on how many future weeks can be added.
app.post('/add-schedule-week', requireManager, (req, res) => {
    const curWeek = getWeekStart(new Date());
    db.get(`SELECT MAX(week_start) AS m FROM schedules`, (err, row) => {
        const latest = (row && row.m && row.m >= curWeek) ? row.m : curWeek;
        const next = addDaysStr(latest, 7);
        db.all(`SELECT username, mon, tue, wed, thu, fri, sat, sun FROM schedules WHERE week_start = ?`, [latest], (err, schedRows) => {
            db.all(`SELECT username, mon, tue, wed, thu, fri, sat, sun FROM users WHERE role = 'agent'`, (err, agents) => {
                const map = {};
                (schedRows || []).forEach(r => { map[r.username] = r; });
                const list = agents || [];
                if (list.length === 0) return res.redirect('/manager?week=' + next);
                let pending = list.length;
                list.forEach(a => {
                    const src = map[a.username] || a;
                    db.run(`INSERT OR IGNORE INTO schedules (username, week_start, mon, tue, wed, thu, fri, sat, sun)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [a.username, next, src.mon, src.tue, src.wed, src.thu, src.fri, src.sat, src.sun], () => {
                            if (--pending === 0) {
                                res.redirect('/manager?week=' + next + '&success=' + encodeURIComponent('New week added: ' + formatWeekLabel(next) + ' (copied from previous week).'));
                            }
                        });
                });
            });
        });
    });
});

app.post('/update-schedule-range', requireManager, (req, res) => {

    const { schedule_range } = req.body;

    db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('schedule_range', ?)`, [schedule_range], (err) => {
        if (err) {
            return res.redirect('/manager?error=' + encodeURIComponent('Failed to update schedule date range!'));
        }
        res.redirect('/manager?success=' + encodeURIComponent('Schedule date range successfully updated!'));
    });
});


const PORT = process.env.PORT || 3000;

// --- Add New Agent (manager only) ---
// New agents are stored in the SQLite users table (not in-memory) so they
// survive restarts/redeploys. The /manager schedule page and /login route
// already read from this table, so new agents appear automatically.

let emailColumnEnsured = false;
function ensureEmailColumn(cb) {
    if (emailColumnEnsured) return cb();
    db.run(`ALTER TABLE users ADD COLUMN email TEXT`, () => {
        // ignore error when the column already exists
        emailColumnEnsured = true;
        cb();
    });
}

function buildUniqueUsername(base, attempt, cb, onError) {
    const candidate = attempt === 0 ? base : base + attempt;
    db.get(`SELECT id FROM users WHERE username = ?`, [candidate], (err, row) => {
        if (err) return onError(err);
        if (row) return buildUniqueUsername(base, attempt + 1, cb, onError);
        cb(candidate);
    });
}

app.post('/add-agent', requireManager, (req, res) => {

    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    if (!name || !email || !password) {
        return res.redirect('/manager?error=' + encodeURIComponent('Please fill in name, email and password.'));
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.redirect('/manager?error=' + encodeURIComponent('Please enter a valid email address.'));
    }
    if (password.length < 4) {
        return res.redirect('/manager?error=' + encodeURIComponent('Password must be at least 4 characters long.'));
    }

    ensureEmailColumn(() => {
        db.get(`SELECT id FROM users WHERE email = ?`, [email], (err, existing) => {
            if (existing) {
                return res.redirect('/manager?error=' + encodeURIComponent('This email is already registered to another agent.'));
            }

            let base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!base) base = 'agent';
            if (base.length > 20) base = base.slice(0, 20);

            buildUniqueUsername(base, 0, (username) => {
            const hash = bcrypt.hashSync(password, 10);
            db.run(`INSERT INTO users (username, password, full_name, email, role, mon, tue, wed, thu, fri, sat, sun)
                    VALUES (?, ?, ?, ?, 'agent', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF')`,
                [username, hash, name, email],
                (err) => {
                    if (err) {
                        return res.redirect('/manager?error=' + encodeURIComponent('Could not add agent. Please try again.'));
                    }
                    db.run(`INSERT OR IGNORE INTO schedules (username, week_start, mon, tue, wed, thu, fri, sat, sun)
                            VALUES (?, ?, 'OFF', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF')`,
                        [username, getWeekStart(new Date())], () => {
                            res.redirect('/manager?success=' + encodeURIComponent(`Agent "${name}" added! Login username: ${username}`));
                        });
                });
        }, () => {
            res.redirect('/manager?error=' + encodeURIComponent('Could not add agent. Please try again.'));
        });
        });
    });
});

// --- Add Manager (owner only) ---
// Managers get their own login with day-to-day powers (schedules, agents,
// password resets) but cannot touch the Owner account or create managers.
app.post('/add-manager', requireOwner, (req, res) => {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    if (!name || !email || !password) {
        return res.redirect('/manager?error=' + encodeURIComponent('Please fill in name, email and password.'));
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.redirect('/manager?error=' + encodeURIComponent('Please enter a valid email address.'));
    }
    if (password.length < 4) {
        return res.redirect('/manager?error=' + encodeURIComponent('Password must be at least 4 characters long.'));
    }

    ensureEmailColumn(() => {
        db.get(`SELECT id FROM users WHERE email = ?`, [email], (err, existing) => {
            if (existing) {
                return res.redirect('/manager?error=' + encodeURIComponent('This email is already registered.'));
            }

            let base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!base) base = 'manager';
            if (base.length > 20) base = base.slice(0, 20);

            buildUniqueUsername(base, 0, (username) => {
                const hash = bcrypt.hashSync(password, 10);
                db.run(`INSERT INTO users (username, password, full_name, email, role) VALUES (?, ?, ?, ?, 'manager')`,
                    [username, hash, name, email],
                    (err) => {
                        if (err) {
                            return res.redirect('/manager?error=' + encodeURIComponent('Could not add manager. Please try again.'));
                        }
                        res.redirect('/manager?success=' + encodeURIComponent(`Manager "${name}" added! Login username: ${username}`));
                    });
            }, () => {
                res.redirect('/manager?error=' + encodeURIComponent('Could not add manager. Please try again.'));
            });
        });
    });
});

// --- Delete Manager (owner only) ---
app.post('/delete-manager', requireOwner, (req, res) => {
    const { user: loggedUser } = getAuth(req);
    const username = (req.body.username || '').trim();

    if (!username) {
        return res.redirect('/manager?error=' + encodeURIComponent('No manager specified.'));
    }
    if (username === loggedUser) {
        return res.redirect('/manager?error=' + encodeURIComponent('You cannot delete your own account.'));
    }

    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, target) => {
        if (err || !target || target.role !== 'manager') {
            return res.redirect('/manager?error=' + encodeURIComponent('Manager not found.'));
        }
        db.run(`DELETE FROM users WHERE username = ?`, [username], (err) => {
            if (err) {
                return res.redirect('/manager?error=' + encodeURIComponent('Could not delete manager.'));
            }
            res.redirect('/manager?success=' + encodeURIComponent(`Manager "${target.full_name}" (${username}) deleted.`));
        });
    });
});

// --- Generate Recovery Code (any logged-in user; per-user code) ---
// Shown on the user's own dashboard. If they ever forget their password,
// this code unlocks the "Forgot password?" page — no email needed.
app.post('/generate-recovery-code', requireLogin, blockAgentOnMobile, (req, res) => {
    const { user: loggedUser, role: loggedRole } = getAuth(req);
    const back = loggedRole === 'agent' ? `/agent/${loggedUser}` : '/manager';
    const code = generateRecoveryCode();
    db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [`recovery_code_${loggedUser}`, code], (err) => {
        if (err) {
            return res.redirect(back + '?error=' + encodeURIComponent('Could not generate recovery code.'));
        }
        res.redirect(back + '?success=' + encodeURIComponent('New recovery code generated! Write it down somewhere safe — it is your lifeline if you forget your password.'));
    });
});

// --- Reset Manager Password (owner only) ---
// For when a manager forgets their password: the owner sets a new one and
// shares it privately. The Owner account itself cannot be reset this way.
app.post('/reset-manager-password', requireOwner, (req, res) => {
    const username = (req.body.username || '').trim();
    const newPassword = req.body.new_password || '';

    if (!username || !newPassword) {
        return res.redirect('/manager?error=' + encodeURIComponent('Username and new password are required.'));
    }
    if (newPassword.length < 4) {
        return res.redirect('/manager?error=' + encodeURIComponent('Password must be at least 4 characters long.'));
    }

    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, target) => {
        if (err || !target || target.role !== 'manager') {
            return res.redirect('/manager?error=' + encodeURIComponent('Manager not found.'));
        }
        db.run(`UPDATE users SET password = ? WHERE username = ?`, [bcrypt.hashSync(newPassword, 10), username], (err) => {
            if (err) {
                return res.redirect('/manager?error=' + encodeURIComponent('Could not reset password.'));
            }
            res.redirect('/manager?success=' + encodeURIComponent(`Password reset for manager "${target.full_name}". Share the new password with them privately.`));
        });
    });
});

// --- Forgot Password (public; per-user recovery code) ---
app.get('/forgot-password', (req, res) => {
    res.render('forgot-password', { error: null });
});

app.post('/forgot-password', (req, res) => {
    const username = (req.body.username || '').trim();
    const code = (req.body.code || '').trim().toUpperCase();
    const newPassword = req.body.new_password || '';
    const confirmPassword = req.body.confirm_password || '';

    const fail = (msg) => res.render('forgot-password', { error: msg });

    if (!username || !code || !newPassword || !confirmPassword) {
        return fail('Please fill in all fields.');
    }
    if (newPassword.length < 4) {
        return fail('New password must be at least 4 characters long.');
    }
    if (newPassword !== confirmPassword) {
        return fail('New passwords do not match.');
    }

    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (err || !user) {
            return fail('Invalid username or recovery code.');
        }
        db.get(`SELECT value FROM meta WHERE key = ?`, [`recovery_code_${username}`], (err, rcRow) => {
            if (rcRow && rcRow.value && rcRow.value.toUpperCase() === code) {
                return doReset();
            }
            // Legacy fallback: codes generated before per-user keys (owner only)
            if (user.role !== 'owner') {
                return fail('Invalid username or recovery code.');
            }
            db.get(`SELECT value FROM meta WHERE key = 'recovery_code'`, (err, legacyRow) => {
                if (err || !legacyRow || !legacyRow.value || legacyRow.value.toUpperCase() !== code) {
                    return fail('Invalid username or recovery code.');
                }
                doReset();
            });
        });

        function doReset() {
            db.run(`UPDATE users SET password = ? WHERE username = ?`, [bcrypt.hashSync(newPassword, 10), username], (err) => {
                if (err) {
                    return fail('Could not reset password. Please try again.');
                }
                res.redirect('/login');
            });
        }
    });
});

// --- Delete Agent (manager or owner) ---
// The agent's login and schedule are removed immediately. Their previously
// submitted links are kept as historical records.
app.post('/delete-agent', requireManager, (req, res) => {

    const username = (req.body.username || '').trim();
    if (!username) {
        return res.redirect('/manager?error=' + encodeURIComponent('No agent specified.'));
    }

    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, target) => {
        if (err || !target) {
            return res.redirect('/manager?error=' + encodeURIComponent('Agent not found.'));
        }
        if (target.role !== 'agent') {
            return res.redirect('/manager?error=' + encodeURIComponent('Only agent accounts can be deleted here.'));
        }
        db.run(`DELETE FROM users WHERE username = ?`, [username], (err) => {
            if (err) {
                return res.redirect('/manager?error=' + encodeURIComponent('Could not delete agent.'));
            }
            res.redirect('/manager?success=' + encodeURIComponent(`Agent "${target.full_name}" (${username}) deleted.`));
        });
    });
});

// --- Reset Agent Password (manager or owner) ---
// For when an agent forgets their password: the manager sets a new one and
// shares it with the agent (e.g. via WhatsApp/Slack).
app.post('/reset-agent-password', requireManager, (req, res) => {

    const username = (req.body.username || '').trim();
    const newPassword = req.body.new_password || '';

    if (!username || !newPassword) {
        return res.redirect('/manager?error=' + encodeURIComponent('Username and new password are required.'));
    }
    if (newPassword.length < 4) {
        return res.redirect('/manager?error=' + encodeURIComponent('Password must be at least 4 characters long.'));
    }

    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, target) => {
        if (err || !target) {
            return res.redirect('/manager?error=' + encodeURIComponent('Agent not found.'));
        }
        if (target.role !== 'agent') {
            return res.redirect('/manager?error=' + encodeURIComponent('Only agent passwords can be reset here.'));
        }
        db.run(`UPDATE users SET password = ? WHERE username = ?`, [bcrypt.hashSync(newPassword, 10), username], (err) => {
            if (err) {
                return res.redirect('/manager?error=' + encodeURIComponent('Could not reset password.'));
            }
            res.redirect('/manager?success=' + encodeURIComponent(`Password reset for "${target.full_name}". Share the new password with them.`));
        });
    });
});

// --- Change Password (self-service, any logged-in user) ---
app.post('/change-password', requireLogin, blockAgentOnMobile, (req, res) => {
    const { user: loggedUser, role: loggedRole } = getAuth(req);
    const back = loggedRole === 'agent' ? `/agent/${loggedUser}` : '/manager';

    const currentPassword = req.body.current_password || '';
    const newPassword = req.body.new_password || '';
    const confirmPassword = req.body.confirm_password || '';

    if (!currentPassword || !newPassword || !confirmPassword) {
        return res.redirect(back + '?error=' + encodeURIComponent('Please fill in all password fields.'));
    }
    if (newPassword.length < 4) {
        return res.redirect(back + '?error=' + encodeURIComponent('New password must be at least 4 characters long.'));
    }
    if (newPassword !== confirmPassword) {
        return res.redirect(back + '?error=' + encodeURIComponent('New passwords do not match.'));
    }

    db.get(`SELECT * FROM users WHERE username = ?`, [loggedUser], (err, user) => {
        if (err || !user) {
            return res.redirect('/login');
        }
        const stored = user.password || '';
        const isHash = /^\$2[aby]\$/.test(stored);
        const ok = isHash ? bcrypt.compareSync(currentPassword, stored) : currentPassword === stored;
        if (!ok) {
            return res.redirect(back + '?error=' + encodeURIComponent('Current password is incorrect.'));
        }
        db.run(`UPDATE users SET password = ? WHERE username = ?`, [bcrypt.hashSync(newPassword, 10), loggedUser], (err) => {
            if (err) {
                return res.redirect(back + '?error=' + encodeURIComponent('Could not change password.'));
            }
            res.redirect(back + '?success=' + encodeURIComponent('Password changed successfully.'));
        });
    });
});

app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("Server is running smoothly on port " + (process.env.PORT || 3000));
});
