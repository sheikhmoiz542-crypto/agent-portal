const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 3000;

const db = new sqlite3.Database('./database.db', (err) => {
    if (err) console.error('DB Error:', err.message);
    else console.log('Connected to SQLite database.');
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
                db.run(`INSERT INTO users (username, password, full_name, role) VALUES ('manager', 'Ft37kFOT', 'System Manager', 'manager')`);
            }
        });

        agentsData.forEach(agent => {
            db.get(`SELECT * FROM users WHERE username = ?`, [agent.username], (err, row) => {
                if (!row) {
                    db.run(`INSERT INTO users (username, password, full_name, role, mon, tue, wed, thu, fri, sat, sun) 
                        VALUES (?, ?, ?, 'agent', ?, ?, ?, ?, ?, ?, ?)`,
                        [agent.username, agent.password, agent.name, agent.schedule[0], agent.schedule[1], agent.schedule[2], agent.schedule[3], agent.schedule[4], agent.schedule[5], agent.schedule[6]]);
                } else {
                    db.run(`UPDATE users SET password = ?, mon = ?, tue = ?, wed = ?, thu = ?, fri = ?, sat = ?, sun = ? WHERE username = ?`,
                        [agent.password, agent.schedule[0], agent.schedule[1], agent.schedule[2], agent.schedule[3], agent.schedule[4], agent.schedule[5], agent.schedule[6], agent.username]);
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
    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, password], (err, user) => {
        if (user) {
            res.cookie('auth_user', user.username, { httpOnly: true });
            res.cookie('auth_role', user.role, { httpOnly: true });
            
            if (user.role === 'manager') {
                res.redirect('/manager');
            } else {
                res.redirect(`/agent/${user.username}`);
            }
        } else {
            res.render('login', { error: 'Invalid username or password' });
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

PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(Server is running on port \)) => {
    console.log(`Server running at http://localhost:${PORT}/login`);
});
