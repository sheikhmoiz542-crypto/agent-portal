const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const app = express();

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
                db.run(`INSERT INTO users (username, password, full_name, role) VALUES ('manager', ?, 'System Manager', 'manager')`,
                    [bcrypt.hashSync('Ft37kFOT', 10)]);
            }
        });

        agentsData.forEach(agent => {
            db.get(`SELECT * FROM users WHERE username = ?`, [agent.username], (err, row) => {
                if (!row) {
                    db.run(`INSERT INTO users (username, password, full_name, role, mon, tue, wed, thu, fri, sat, sun) 
                        VALUES (?, ?, ?, 'agent', ?, ?, ?, ?, ?, ?, ?)`,
                        [agent.username, bcrypt.hashSync(agent.password, 10), agent.name, agent.schedule[0], agent.schedule[1], agent.schedule[2], agent.schedule[3], agent.schedule[4], agent.schedule[5], agent.schedule[6]]);
                } else {
                    // NOTE: password is intentionally NOT overwritten here anymore.
                    // Existing passwords migrate to bcrypt hashes on next login.
                    // Only the weekly schedule is synced from the seed data.
                    db.run(`UPDATE users SET mon = ?, tue = ?, wed = ?, thu = ?, fri = ?, sat = ?, sun = ? WHERE username = ?`,
                        [agent.schedule[0], agent.schedule[1], agent.schedule[2], agent.schedule[3], agent.schedule[4], agent.schedule[5], agent.schedule[6], agent.username]);
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
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

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

        if (!isHash) {
            // Transparent migration: upgrade this plaintext password to a bcrypt hash
            db.run(`UPDATE users SET password = ? WHERE id = ?`, [bcrypt.hashSync(password, 10), user.id]);
        }

        res.cookie('auth_user', user.username, { httpOnly: true });
        res.cookie('auth_role', user.role, { httpOnly: true });

        if (user.role === 'manager') {
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

app.get('/agent/:username', (req, res) => {
    const requestedUsername = req.params.username;
    const loggedUser = req.cookies.auth_user;
    const loggedRole = req.cookies.auth_role;

    if (!loggedUser || (loggedRole === 'agent' && loggedUser !== requestedUsername)) {
        return res.redirect('/login');
    }

    db.get(`SELECT * FROM users WHERE username = ? AND role = 'agent'`, [requestedUsername], (err, user) => {
        if (!user) return res.redirect('/login');

        const shiftDate = getShiftDate();
        const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        const todayDayKey = days[new Date().getDay()];

        const b1Rem = req.cookies[`b1_rem_${user.username}`] !== undefined ? parseInt(req.cookies[`b1_rem_${user.username}`]) : 30;
        const b2Rem = req.cookies[`b2_rem_${user.username}`] !== undefined ? parseInt(req.cookies[`b2_rem_${user.username}`]) : 15;
        const b3Rem = req.cookies[`b3_rem_${user.username}`] !== undefined ? parseInt(req.cookies[`b3_rem_${user.username}`]) : 15;

        db.get(`SELECT value FROM meta WHERE key = 'schedule_range'`, (err, metaRow) => {
            const scheduleRange = metaRow ? metaRow.value : 'Current Week Schedule';

            db.get(`SELECT COUNT(*) as count FROM links WHERE username = ? AND date = ?`, [user.username, shiftDate], (err, row) => {
                const userLinksCount = row ? row.count : 0;

                db.all(`SELECT full_name, COUNT(*) as count FROM links WHERE date = ? GROUP BY username ORDER BY count DESC`, [shiftDate], (err, leaderboard) => {
                    db.all(`SELECT link FROM links WHERE username = ? AND date = ? ORDER BY id DESC`, [user.username, shiftDate], (err, recentLinks) => {
                        res.render('agent', {
                            username: user.username,
                            fullName: user.full_name,
                            userLinksCount: userLinksCount,
                            leaderboard: leaderboard || [],
                            mySchedule: user,
                            scheduleRange: scheduleRange,
                            todayDayKey: todayDayKey,
                            breakStatus: req.cookies[`break_${user.username}`] || 'off',
                            breakStartTime: req.cookies[`break_start_${user.username}`] || null,
                            b1Rem: b1Rem,
                            b2Rem: b2Rem,
                            b3Rem: b3Rem,
                            error: req.query.error || null,
                            success: req.query.success || null,
                            recentLinks: recentLinks || []
                        });
                    });
                });
            });
        });
    });
});

app.post('/submit-link/:username', (req, res) => {
    const requestedUsername = req.params.username;
    const loggedUser = req.cookies.auth_user;

    if (!loggedUser || loggedUser !== requestedUsername) {
        return res.redirect('/login');
    }

    const { link } = req.body;
    const shiftDate = getShiftDate();

    db.get(`SELECT * FROM users WHERE username = ?`, [requestedUsername], (err, user) => {
        if (!user) return res.redirect('/login');

        db.get(`SELECT * FROM links WHERE link = ?`, [link], (err, existingLink) => {
            if (existingLink) {
                return res.redirect(`/agent/${requestedUsername}?error=` + encodeURIComponent('Duplicate Link Alert: This link has already been submitted!'));
            }

            db.run(`INSERT INTO links (username, full_name, link, date) VALUES (?, ?, ?, ?)`, 
                [user.username, user.full_name, link, shiftDate], (err) => {
                res.redirect(`/agent/${requestedUsername}?success=` + encodeURIComponent('Link successfully logged!'));
            });
        });
    });
});

app.post('/toggle-break/:username', (req, res) => {
    const requestedUsername = req.params.username;
    const newStatus = req.body.status || 'off';
    const currentStatus = req.cookies[`break_${requestedUsername}`] || 'off';
    const startTime = req.cookies[`break_start_${requestedUsername}`];

    if (currentStatus !== 'off' && newStatus === 'off' && startTime) {
        const elapsedSecs = Math.floor((Date.now() - parseInt(startTime)) / 1000);
        const elapsedMins = Math.ceil(elapsedSecs / 60);

        let remKey = currentStatus === 'break1' ? `b1_rem_${requestedUsername}` : (currentStatus === 'break2' ? `b2_rem_${requestedUsername}` : `b3_rem_${requestedUsername}`);
        let currentRem = req.cookies[remKey] !== undefined ? parseInt(req.cookies[remKey]) : (currentStatus === 'break1' ? 30 : 15);
        
        currentRem = Math.max(0, currentRem - elapsedMins);
        res.cookie(remKey, currentRem, { httpOnly: true });
        res.clearCookie(`break_start_${requestedUsername}`);
    }

    if (newStatus !== 'off') {
        res.cookie(`break_start_${requestedUsername}`, Date.now(), { httpOnly: true });
    }

    res.cookie(`break_${requestedUsername}`, newStatus, { httpOnly: true });
    res.redirect(`/agent/${requestedUsername}`);
});

app.get('/manager', (req, res) => {
    const loggedUser = req.cookies.auth_user;
    const loggedRole = req.cookies.auth_role;

    if (!loggedUser || loggedRole !== 'manager') {
        return res.redirect('/login');
    }

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
        db.all(`SELECT * FROM users WHERE role = 'agent'`, (err, agents) => {
            db.all(`SELECT username, full_name, date, COUNT(*) as total_links FROM links GROUP BY username, date ORDER BY date DESC, total_links DESC`, (err, dailyStats) => {
                db.get(`SELECT value FROM meta WHERE key = 'schedule_range'`, (err, metaRow) => {
                    res.render('manager', {
                        links: filteredLinks || [],
                        agents: agents || [],
                        dailyStats: dailyStats || [],
                        scheduleRange: metaRow ? metaRow.value : '',
                        selectedDate: selectedDate,
                        selectedAgent: selectedAgent,
                        success: req.query.success || null,
                        error: req.query.error || null
                    });
                });
            });
        });
    });
});

app.get('/manager/preview-schedule', (req, res) => {
    const loggedUser = req.cookies.auth_user;
    const loggedRole = req.cookies.auth_role;

    if (!loggedUser || loggedRole !== 'manager') {
        return res.redirect('/login');
    }

    db.all(`SELECT * FROM users WHERE role = 'agent'`, (err, agents) => {
        db.get(`SELECT value FROM meta WHERE key = 'schedule_range'`, (err, metaRow) => {
            res.render('schedule-preview', { 
                agents: agents || [],
                scheduleRange: metaRow ? metaRow.value : ''
            });
        });
    });
});

app.post('/update-agent-schedule', (req, res) => {
    const loggedUser = req.cookies.auth_user;
    const loggedRole = req.cookies.auth_role;

    if (!loggedUser || loggedRole !== 'manager') {
        return res.redirect('/login');
    }

    const { username, mon, tue, wed, thu, fri, sat, sun } = req.body;

    db.run(`UPDATE users SET mon = ?, tue = ?, wed = ?, thu = ?, fri = ?, sat = ?, sun = ? WHERE username = ?`,
        [mon, tue, wed, thu, fri, sat, sun, username], (err) => {
            if (err) {
                return res.redirect('/manager?error=' + encodeURIComponent('Failed to update schedule!'));
            }
            res.redirect('/manager?success=' + encodeURIComponent(`Schedule successfully updated for ${username}!`));
        });
});

app.post('/update-schedule-range', (req, res) => {
    const loggedUser = req.cookies.auth_user;
    const loggedRole = req.cookies.auth_role;

    if (!loggedUser || loggedRole !== 'manager') {
        return res.redirect('/login');
    }

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

app.post('/add-agent', (req, res) => {
    const loggedUser = req.cookies.auth_user;
    const loggedRole = req.cookies.auth_role;

    if (!loggedUser || loggedRole !== 'manager') {
        return res.redirect('/login');
    }

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
                    res.redirect('/manager?success=' + encodeURIComponent(`Agent "${name}" added! Login username: ${username}`));
                });
        }, () => {
            res.redirect('/manager?error=' + encodeURIComponent('Could not add agent. Please try again.'));
        });
    });
});

// --- Delete Agent (manager only) ---
// The agent's login and schedule are removed immediately. Their previously
// submitted links are kept as historical records.
app.post('/delete-agent', (req, res) => {
    const loggedUser = req.cookies.auth_user;
    const loggedRole = req.cookies.auth_role;

    if (!loggedUser || loggedRole !== 'manager') {
        return res.redirect('/login');
    }

    const username = (req.body.username || '').trim();
    if (!username) {
        return res.redirect('/manager?error=' + encodeURIComponent('No agent specified.'));
    }

    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, target) => {
        if (err || !target) {
            return res.redirect('/manager?error=' + encodeURIComponent('Agent not found.'));
        }
        if (target.role === 'manager') {
            return res.redirect('/manager?error=' + encodeURIComponent('Manager accounts cannot be deleted.'));
        }
        db.run(`DELETE FROM users WHERE username = ?`, [username], (err) => {
            if (err) {
                return res.redirect('/manager?error=' + encodeURIComponent('Could not delete agent.'));
            }
            res.redirect('/manager?success=' + encodeURIComponent(`Agent "${target.full_name}" (${username}) deleted.`));
        });
    });
});

// --- Reset Agent Password (manager only) ---
// For when an agent forgets their password: the manager sets a new one and
// shares it with the agent (e.g. via WhatsApp/Slack).
app.post('/reset-agent-password', (req, res) => {
    const loggedUser = req.cookies.auth_user;
    const loggedRole = req.cookies.auth_role;

    if (!loggedUser || loggedRole !== 'manager') {
        return res.redirect('/login');
    }

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
        if (target.role === 'manager') {
            return res.redirect('/manager?error=' + encodeURIComponent('Use Change Password below for manager accounts.'));
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
app.post('/change-password', (req, res) => {
    const loggedUser = req.cookies.auth_user;
    const loggedRole = req.cookies.auth_role;

    if (!loggedUser) {
        return res.redirect('/login');
    }
    const back = loggedRole === 'manager' ? '/manager' : `/agent/${loggedUser}`;

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
