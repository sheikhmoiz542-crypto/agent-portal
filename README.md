# Shift Desk

A small web app for a support team.

- **Agents** sign in, see their weekly schedule and book breaks.
- **Managers** set the weekly schedule, see who is on break (roster board), manage the team, change break rules and view agent stats.
- Login, roles and a real database (SQLite). Built for a team of about 6 to 30 people.

## Run it on your computer

You need Node.js 18 or newer.

```bash
npm install
cp .env.example .env      # optional, see "Settings" below
npm start
```

Open http://localhost:3000. On the very first start the terminal prints a **manager username and password**. Sign in with those and choose a new password.

To look around with sample data first (6 demo agents, shifts and placeholder stats):

```bash
npm run seed:demo
```

Demo agents are `agent1` to `agent6`, password `demo-pass-123`. Do not run this on the live site.

## Set up your team

1. Sign in as the manager, open **Team**, add each agent with a temporary password. They must change it at their first sign-in.
2. Open **Schedule**, select a cell to set a shift. Overnight shifts work: if the end time is earlier than the start time, the shift ends the next day. "Copy last week" repeats a schedule.
3. Open **Settings** to choose how many people may be on break at once (default 2), how far breaks must stay from the shift start and end (default 30 minutes), and the break types (default: 2 × short break of 15 minutes, 1 × meal break of 45 minutes).
4. Agents sign in, open **My week** and use **Book break**. Times that would put too many people on break are greyed out.

## Put it online

The database is a single file, so the host must give the app a **persistent disk** (a folder that survives restarts and redeploys). Without one, all data is lost on every deploy. Free plans usually do not include this, so check current pricing on the host you choose. Render, Railway and Fly.io all offer volumes or disks, and any small VPS works too.

Settings to add on the host:

| Name | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | a long random string (keep it secret) |
| `DATA_DIR` | the mount path of the persistent disk, for example `/data` |
| `ADMIN_PASSWORD` | the first manager password (optional; otherwise it is printed in the logs) |
| `TZ_NAME` | your team's time zone, default `Asia/Karachi` |
| `APP_NAME` | the name shown in the app, default `Shift Desk` |

Build command: `npm install`. Start command: `npm start`. A `Dockerfile` is included if your host prefers containers (mount the disk at `/data`).

Always serve the site over HTTPS. Render, Railway and Fly do this automatically.

**Backups:** copy `portal.db` from the data folder regularly.

## Connect real stats later

The Agent stats page shows empty columns (or sample numbers if you loaded the demo). When you have a data source, set `STATS_API_KEY` on the server and send daily numbers to it:

```bash
curl -X POST https://YOUR-SITE/api/stats/ingest \
  -H "content-type: application/json" \
  -H "x-api-key: YOUR_STATS_API_KEY" \
  -d '{"rows":[{"username":"agent1","date":"2026-09-24","contacts_handled":62,"avg_handle_sec":310,"quality_score":91,"csat":4.6,"adherence_pct":96}]}'
```

`username` must match an agent's username. Sending the same agent and date again overwrites the earlier row. Then use **Remove sample numbers** on the stats page to clear any placeholder rows.

## Tests

```bash
npm test
```

This runs about 30 checks against a throwaway database (sign-in, permissions, break limits, overnight shifts, stats import).

## Files

- `server.js`: API and rules
- `db.js`: database tables and first-run setup
- `public/`: the web pages (`index.html`, `app.js`, `style.css`)
- `seed-demo.js`, `test.js`: demo data and tests
