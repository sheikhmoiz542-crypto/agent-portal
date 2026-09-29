(() => {
  'use strict';

  /* ================= helpers ================= */

  const $ = (sel, el = document) => el.querySelector(sel);
  const pad = n => String(n).padStart(2, '0');

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (['value', 'checked', 'disabled', 'selected'].includes(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : String(kid));
    }
    return el;
  }

  const state = {
    me: null, config: null, settings: null,
    h24: localStorage.getItem('h24') === '1',
    weekStart: null, rosterDate: null, statsDays: 7
  };

  async function api(method, url, body) {
    const r = await fetch('/api' + url, {
      method, headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(data.error || 'Something went wrong. Try again.');
      e.status = r.status; e.code = data.code;
      if (r.status === 401 && url !== '/login') { state.me = null; render(); }
      if (r.status === 403 && data.code === 'PASSWORD_CHANGE_REQUIRED') { state.me.must_change_password = true; render(); }
      throw e;
    }
    return data;
  }

  let toastTimer;
  function toast(msg, bad = false) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
  }

  function modal(build, onClose) {
    const dlg = document.createElement('dialog');
    const close = () => { if (dlg.open) dlg.close(); };
    dlg.addEventListener('close', () => { dlg.remove(); if (onClose) onClose(); });
    dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
    dlg.append(build(close));
    document.body.append(dlg);
    dlg.showModal();
    return close;
  }

  function confirmBox(title, text, label, danger = false) {
    return new Promise(resolve => {
      let answer = false;
      modal(close => h('div', { class: 'dlg' },
        h('h2', {}, title), h('p', { class: 'sub' }, text),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', type: 'button', onclick: close }, 'Go back'),
          h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'button', onclick: () => { answer = true; close(); } }, label))
      ), () => resolve(answer));
    });
  }

  function field(label, input, hint) {
    const id = 'f' + Math.random().toString(36).slice(2, 8);
    input.id = id;
    return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('p', { class: 'small muted' }, hint) : null);
  }

  function select(options, value, attrs) {
    const el = h('select', attrs);
    for (const [v, text] of options) el.append(h('option', { value: v, selected: String(v) === String(value) }, text));
    return el;
  }

  /* ---- dates and times ---- */

  const dnum = s => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
  const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  const weekStartOf = s => { const [y, m, d] = s.split('-').map(Number); const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return addDays(s, -((dow + 6) % 7)); };
  const utc = s => new Date(s + 'T00:00:00Z');
  const dowShort = s => utc(s).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
  const dateShort = s => utc(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dayLong = s => utc(s).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

  function fmt(min) {
    const m = ((min % 1440) + 1440) % 1440, hh = Math.floor(m / 60), mm = m % 60;
    if (state.h24) return `${pad(hh)}:${pad(mm)}`;
    return `${hh % 12 || 12}:${pad(mm)} ${hh >= 12 ? 'PM' : 'AM'}`;
  }
  const range = (a, b) => `${fmt(a)} – ${fmt(b)}`;
  function hourLabel(hh) {
    const x = ((hh % 24) + 24) % 24;
    return state.h24 ? `${pad(x)}:00` : `${x % 12 || 12} ${x >= 12 ? 'PM' : 'AM'}`;
  }
  const toMin = v => { const [a, b] = v.split(':').map(Number); return a * 60 + b; };
  const fromMin = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

  /* ================= shell ================= */

  const TABS = {
    manager: [['roster', 'Roster'], ['schedule', 'Schedule'], ['stats', 'Agent stats'], ['team', 'Team'], ['settings', 'Settings']],
    agent: [['week', 'My week']]
  };

  function render() {
    const app = $('#app');
    if (!state.me) return app.replaceChildren(loginView());
    if (state.me.must_change_password) return app.replaceChildren(forcedPasswordView());
    app.replaceChildren(shell());
    tickClock();
    route();
  }

  function shell() {
    const tabs = TABS[state.me.role];
    return h('div', {},
      h('header', { class: 'topbar' }, h('div', { class: 'topbar-in' },
        h('span', { class: 'brand' }, state.config.app_name),
        h('span', { class: 'clock num', id: 'clock' }),
        h('button', { class: 'btn quiet small', type: 'button', title: 'Switch time format', onclick: () => { state.h24 = !state.h24; localStorage.setItem('h24', state.h24 ? '1' : '0'); tickClock(); route(); } }, state.h24 ? 'Use 12-hour' : 'Use 24-hour'),
        h('span', { class: 'who' }, state.me.name),
        h('button', { class: 'btn quiet small', type: 'button', onclick: openPassword }, 'Password'),
        h('button', { class: 'btn small', type: 'button', onclick: signOut }, 'Sign out'))),
      tabs.length > 1 ? h('div', { class: 'tabs-wrap' }, h('nav', { class: 'tabs', 'aria-label': 'Sections' },
        tabs.map(([id, label]) => h('a', { href: '#/' + id, 'data-tab': id }, label)))) : null,
      h('main', { id: 'view' }));
  }

  function tickClock() {
    const el = $('#clock');
    if (!el || !state.config) return;
    const city = state.config.time_zone.split('/').pop().replace('_', ' ');
    const t = new Date().toLocaleTimeString('en-US', { timeZone: state.config.time_zone, hour: 'numeric', minute: '2-digit', hour12: !state.h24, hourCycle: state.h24 ? 'h23' : undefined });
    el.textContent = `${city} ${t}`;
  }
  setInterval(tickClock, 20000);

  async function signOut() {
    try { await api('POST', '/logout'); } catch { /* already signed out */ }
    state.me = null; state.rosterDate = null; state.weekStart = null;
    location.hash = '';
    render();
  }

  function openPassword() {
    modal(close => h('div', { class: 'dlg' },
      h('h2', {}, 'Change password'), h('p', { class: 'sub' }, 'Use at least 8 characters.'),
      passwordForm({ forced: false, onDone: () => { close(); toast('Password updated.'); } })));
  }

  /* ================= sign in / password ================= */

  function loginView() {
    const err = h('p', { class: 'error', role: 'alert' });
    const user = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true });
    const pass = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    return h('form', {
      class: 'gate', onsubmit: async e => {
        e.preventDefault(); err.textContent = '';
        try { state.me = await api('POST', '/login', { username: user.value, password: pass.value }); render(); }
        catch (x) { err.textContent = x.message; }
      }
    },
      h('h1', {}, state.config.app_name),
      h('p', { class: 'muted' }, 'Sign in to see your schedule and book breaks.'),
      field('Username', user), field('Password', pass),
      h('button', { class: 'btn primary', type: 'submit' }, 'Sign in'), err);
  }

  function passwordForm({ forced, onDone }) {
    const err = h('p', { class: 'error', role: 'alert' });
    const cur = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const nw = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: '8' });
    const cf = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: '8' });
    return h('form', {
      onsubmit: async e => {
        e.preventDefault(); err.textContent = '';
        if (nw.value !== cf.value) { err.textContent = 'The new passwords do not match.'; return; }
        try { await api('POST', '/password', { current: cur.value, next: nw.value }); await onDone(); }
        catch (x) { err.textContent = x.message; }
      }
    },
      field(forced ? 'Temporary password' : 'Current password', cur),
      field('New password', nw, 'At least 8 characters.'),
      field('Confirm new password', cf),
      h('button', { class: 'btn primary', type: 'submit' }, 'Save password'), err);
  }

  function forcedPasswordView() {
    return h('div', { class: 'gate' },
      h('h1', {}, 'Choose a new password'),
      h('p', { class: 'muted' }, `Welcome, ${state.me.name}. Replace the temporary password before you continue.`),
      passwordForm({ forced: true, onDone: async () => { state.me = await api('GET', '/me'); render(); } }),
      h('p', { style: 'margin-top:20px' }, h('button', { class: 'btn quiet small', type: 'button', onclick: signOut }, 'Sign out')));
  }

  /* ================= router ================= */

  const views = {};

  async function route() {
    if (!state.me || state.me.must_change_password) return;
    const tabs = TABS[state.me.role];
    let name = location.hash.replace('#/', '') || tabs[0][0];
    if (!tabs.some(t => t[0] === name)) name = tabs[0][0];
    document.querySelectorAll('.tabs a').forEach(a => {
      if (a.dataset.tab === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    const main = $('#view');
    if (!main) return;
    try {
      state.settings = await api('GET', '/settings');
      const node = await views[name]();
      main.replaceChildren(node);
    } catch (e) {
      if (e.status !== 401 && e.code !== 'PASSWORD_CHANGE_REQUIRED') main.replaceChildren(h('div', { class: 'panel empty' }, e.message));
    }
  }
  window.addEventListener('hashchange', route);

  const navBtn = (label, aria, fn) => h('button', { class: 'btn', type: 'button', 'aria-label': aria, onclick: fn }, label);

  /* ================= booking dialog (agents and managers) ================= */

  const REASONS = {
    BUFFER: 'Too close to the start or end of the shift',
    PAST: 'That time has passed',
    OVERLAP: 'Overlaps another break on this shift',
    LIMIT: 'All breaks of this type are already booked for this shift',
    CAP: 'Break limit reached at that time',
    RANGE: 'Outside the shift'
  };

  function bookDialog({ date, userId, userName, onDone }) {
    const isMgr = state.me.role === 'manager';
    const types = state.settings.break_types.filter(t => t.active);
    if (!types.length) { toast('No break types are turned on. Ask a manager.', true); return; }
    let typeId = types[0].id;
    const sub = h('p', { class: 'sub' });
    const slotsEl = h('div', { class: 'slots', role: 'group', 'aria-label': 'Start times' });
    const note = h('p', { class: 'small muted', style: 'margin-top:12px' });
    const err = h('p', { class: 'error', role: 'alert' });

    modal(close => {
      async function load() {
        err.textContent = '';
        slotsEl.replaceChildren(h('p', { class: 'muted' }, 'Loading times…'));
        try {
          const a = await api('GET', `/availability?date=${date}&type_id=${typeId}` + (isMgr && userId ? `&user_id=${userId}` : ''));
          if (!a.shift) { slotsEl.replaceChildren(h('p', { class: 'muted' }, 'No shift on this day.')); return; }
          sub.textContent = `${dayLong(date)} · shift ${range(a.shift.start_min, a.shift.end_min)}`;
          const openCount = a.slots.filter(s => s.ok).length;
          slotsEl.replaceChildren(...a.slots.map(s => {
            const usable = s.ok || (isMgr && s.reason === 'CAP');
            return h('button', {
              class: 'slot' + (s.on_break ? ' busy' : ''), type: 'button', disabled: !usable,
              title: usable ? '' : (REASONS[s.reason] || ''),
              onclick: () => book(s.start_min, false)
            }, fmt(s.start_min), s.on_break ? h('small', {}, `${s.on_break} of ${a.max_concurrent} out`) : h('small', {}, ' '));
          }));
          if (!openCount) {
            const counts = {};
            a.slots.forEach(s => { counts[s.reason] = (counts[s.reason] || 0) + 1; });
            const top = Object.entries(counts).sort((x, y) => y[1] - x[1])[0];
            note.textContent = top && REASONS[top[0]] ? `No start times are open. ${REASONS[top[0]]}.` : 'No start times are open.';
          } else {
            note.textContent = `“x of ${a.max_concurrent} out” shows how many people are already on break at that time. Greyed times are not available.`;
          }
        } catch (e) { slotsEl.replaceChildren(h('p', { class: 'error' }, e.message)); }
      }

      async function book(start, force) {
        err.textContent = '';
        try {
          await api('POST', '/breaks', { date, start_min: start, type_id: typeId, user_id: isMgr ? userId : undefined, force });
          close(); toast(`Break booked for ${fmt(start)}.`); onDone();
        } catch (e) {
          if (e.code === 'CAP' && isMgr && !force) {
            const yes = await confirmBox('Over the break limit', `${e.message} Add this break anyway?`, 'Add break');
            if (yes) return book(start, true);
          } else { err.textContent = e.message; load(); }
        }
      }

      const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Break type' },
        types.map((t, i) => h('label', {},
          h('input', { type: 'radio', name: 'btype', value: t.id, checked: i === 0, onchange: () => { typeId = t.id; load(); } }),
          h('span', {}, `${t.name} · ${t.minutes} min`))));

      load();
      return h('div', { class: 'dlg' },
        h('h2', {}, userName && isMgr ? `Add a break for ${userName}` : 'Book a break'), sub, seg, slotsEl, note, err,
        h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Close')));
    });
  }

  /* ================= agent: my week ================= */

  views.week = async () => {
    if (!state.weekStart) state.weekStart = weekStartOf((await api('GET', '/config')).today);
    const w = await api('GET', `/week?start=${state.weekStart}`);
    const nowAbs = dnum(w.now.date) * 1440 + w.now.minutes;
    const thisWeek = weekStartOf(w.now.date);
    const s = state.settings;
    const types = s.break_types.filter(t => t.active).map(t => `${t.per_shift} × ${t.name.toLowerCase()} (${t.minutes} min)`).join(', ');

    const go = n => () => { state.weekStart = addDays(state.weekStart, n * 7); route(); };
    const head = h('div', { class: 'head' },
      h('div', {}, h('h1', {}, 'My week'), h('p', { class: 'muted num' }, `${dateShort(w.days[0])} – ${dateShort(w.days[6])}`)),
      h('div', { class: 'nav' },
        navBtn('‹', 'Previous week', go(-1)),
        h('button', { class: 'btn', type: 'button', disabled: state.weekStart === thisWeek, onclick: () => { state.weekStart = thisWeek; route(); } }, 'This week'),
        navBtn('›', 'Next week', go(1))));

    const rows = w.days.map(date => {
      const shift = w.shifts.find(x => x.date === date);
      const brks = w.breaks.filter(b => b.date === date);
      const dayBase = dnum(date) * 1440;
      const canBook = shift && dayBase + shift.end_min > nowAbs;
      return h('div', { class: 'day' + (date === w.now.date ? ' today' : '') + (shift ? '' : ' off') },
        h('div', { class: 'label' }, h('div', { class: 'dow' }, dowShort(date)), h('div', { class: 'date' }, dateShort(date))),
        h('div', {},
          h('div', { class: 'shift time' }, shift ? [range(shift.start_min, shift.end_min), shift.end_min > 1440 ? h('small', {}, '  ends next day') : null] : 'Day off'),
          brks.length ? h('div', { class: 'chips' }, brks.map(b => h('span', { class: 'chip time' },
            h('span', b.start_min + dayBase > nowAbs ? {} : { class: 'pad-r' }, `${b.type_name} ${range(b.start_min, b.end_min)}`),
            dayBase + b.start_min > nowAbs
              ? h('button', {
                type: 'button', 'aria-label': `Cancel ${b.type_name} at ${fmt(b.start_min)}`, title: 'Cancel this break', onclick: async () => {
                  if (!(await confirmBox('Cancel this break?', `${b.type_name}, ${dayLong(date)}, ${range(b.start_min, b.end_min)}.`, 'Cancel break', true))) return;
                  try { await api('DELETE', `/breaks/${b.id}`); toast('Break cancelled.'); route(); } catch (e) { toast(e.message, true); }
                }
              }, '×')
              : null))) : null),
        canBook ? h('button', { class: 'btn primary', type: 'button', onclick: () => bookDialog({ date, onDone: route }) }, 'Book break') : h('span'));
    });

    return h('div', {}, head,
      h('p', { class: 'muted small', style: 'margin-bottom:14px' }, `Up to ${s.max_concurrent} people can be on break at once. Each shift: ${types || 'no break types are on'}.`),
      h('div', { class: 'panel days' }, rows));
  };

  /* ================= manager: roster ================= */

  async function defaultRosterDate() {
    const { today } = await api('GET', '/config');
    const now = await api('GET', `/week?start=${today}`);
    if (now.now.minutes < 12 * 60) {
      const y = addDays(today, -1);
      const wk = y < now.start ? await api('GET', `/week?start=${y}`) : now;
      if (wk.shifts.some(s => s.date === y && s.end_min > 1440 + now.now.minutes)) return y;
    }
    return today;
  }

  views.roster = async () => {
    if (!state.rosterDate) state.rosterDate = await defaultRosterDate();
    const date = state.rosterDate;
    const w = await api('GET', `/week?start=${date}`);
    const nameOf = id => (w.users.find(u => u.id === id) || {}).name || 'Agent';
    const shifts = w.shifts.filter(s => s.date === date).sort((a, b) => a.start_min - b.start_min || nameOf(a.user_id).localeCompare(nameOf(b.user_id)));
    const dayBreaks = w.breaks.filter(b => b.date === date).sort((a, b) => a.start_min - b.start_min);
    const rel = (dnum(w.now.date) - dnum(date)) * 1440 + w.now.minutes;
    const setDate = d => { state.rosterDate = d; route(); };

    const head = h('div', { class: 'head' },
      h('div', {}, h('h1', {}, 'Roster'), h('p', { class: 'muted' }, dayLong(date))),
      h('div', { class: 'nav' },
        navBtn('‹', 'Previous day', () => setDate(addDays(date, -1))),
        h('input', { type: 'date', value: date, 'aria-label': 'Pick a day', style: 'width:auto', onchange: e => e.target.value && setDate(e.target.value) }),
        navBtn('›', 'Next day', () => setDate(addDays(date, 1))),
        h('button', { class: 'btn', type: 'button', disabled: date === w.now.date, onclick: () => setDate(w.now.date) }, 'Today')));

    async function cancelBreak(b) {
      if (!(await confirmBox('Cancel this break?', `${nameOf(b.user_id)}, ${b.type_name}, ${range(b.start_min, b.end_min)}.`, 'Cancel break', true))) return;
      try { await api('DELETE', `/breaks/${b.id}`); toast('Break cancelled.'); route(); } catch (e) { toast(e.message, true); }
    }

    if (!shifts.length) {
      return h('div', {}, head, h('div', { class: 'panel empty' }, 'No shifts on this day. Add them under Schedule.'));
    }

    const ws = Math.floor(Math.min(...shifts.map(s => s.start_min)) / 60) * 60;
    const we = Math.ceil(Math.max(...shifts.map(s => s.end_min)) / 60) * 60;
    const span = we - ws, hours = span / 60;
    const pos = m => (m - ws) / span * 100;
    const live = rel >= ws && rel < we;
    const onNow = live ? dayBreaks.filter(b => b.start_min <= rel && rel < b.end_min) : [];

    const ticks = h('div', { class: 'board-row ticks' }, h('div', { class: 'board-name' }),
      h('div', { class: 'tickline' }, Array.from({ length: hours }, (_, i) => h('span', {}, hourLabel(ws / 60 + i)))));

    const rows = shifts.map(s => {
      const name = nameOf(s.user_id);
      return h('div', { class: 'board-row' },
        h('div', { class: 'board-name' }, h('span', { title: name }, name),
          h('button', { class: 'btn quiet small', type: 'button', 'aria-label': `Add break for ${name}`, title: 'Add a break', onclick: () => bookDialog({ date, userId: s.user_id, userName: name, onDone: route }) }, '+')),
        h('div', { class: 'lane' },
          h('div', { class: 'bar', style: `left:${pos(s.start_min)}%;width:${(s.end_min - s.start_min) / span * 100}%`, title: `${name}: ${range(s.start_min, s.end_min)}` }),
          dayBreaks.filter(b => b.shift_id === s.id).map(b => h('button', {
            class: 'brk', type: 'button', style: `left:${pos(b.start_min)}%;width:${(b.end_min - b.start_min) / span * 100}%`,
            title: `${b.type_name} ${range(b.start_min, b.end_min)}`, 'aria-label': `${name}, ${b.type_name} ${range(b.start_min, b.end_min)}. Select to cancel.`,
            onclick: () => cancelBreak(b)
          })),
          live ? h('div', { class: 'now', style: `left:${pos(rel)}%`, title: 'Now' }) : null));
    });

    const offNames = w.users.filter(u => !shifts.some(s => s.user_id === u.id)).map(u => u.name);

    const board = h('div', { class: 'panel board', style: `--hours:${hours}` },
      h('div', { class: 'board-inner' }, ticks, rows,
        h('div', { class: 'legend' },
          h('span', {}, h('i', { style: 'background:var(--shift)' }), 'Shift'),
          h('span', {}, h('i', { style: 'background:var(--break)' }), 'Break (select to cancel)'),
          live ? h('span', {}, h('i', { style: 'background:var(--alert);width:3px;height:12px' }), 'Now') : null)));

    const list = dayBreaks.length
      ? h('div', { class: 'panel scroll', style: 'margin-top:20px' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Time'), h('th', {}, 'Agent'), h('th', {}, 'Break'), h('th', {}))),
        h('tbody', {}, dayBreaks.map(b => h('tr', {},
          h('td', { class: 'time' }, range(b.start_min, b.end_min)), h('td', {}, nameOf(b.user_id)), h('td', {}, b.type_name),
          h('td', { class: 'num' }, h('button', { class: 'btn quiet small danger', type: 'button', onclick: () => cancelBreak(b) }, 'Cancel')))))))
      : h('p', { class: 'muted', style: 'margin-top:16px' }, 'No breaks booked for this day yet.');

    return h('div', {}, head,
      live ? h('p', { style: 'margin-bottom:12px' }, onNow.length
        ? `On break now (${onNow.length} of ${state.settings.max_concurrent}): ${onNow.map(b => nameOf(b.user_id)).join(', ')}`
        : 'No one is on break right now.') : null,
      board,
      offNames.length ? h('p', { class: 'muted small', style: 'margin-top:12px' }, `Off this day: ${offNames.join(', ')}`) : null,
      list);
  };

  /* ================= manager: schedule ================= */

  views.schedule = async () => {
    if (!state.weekStart) state.weekStart = weekStartOf((await api('GET', '/config')).today);
    const w = await api('GET', `/week?start=${state.weekStart}`);
    const thisWeek = weekStartOf(w.now.date);
    const go = n => () => { state.weekStart = addDays(state.weekStart, n * 7); route(); };

    const head = h('div', { class: 'head' },
      h('div', {}, h('h1', {}, 'Schedule'), h('p', { class: 'muted num' }, `${dateShort(w.days[0])} – ${dateShort(w.days[6])}`)),
      h('div', { class: 'nav' },
        navBtn('‹', 'Previous week', go(-1)),
        h('button', { class: 'btn', type: 'button', disabled: state.weekStart === thisWeek, onclick: () => { state.weekStart = thisWeek; route(); } }, 'This week'),
        navBtn('›', 'Next week', go(1)),
        h('button', {
          class: 'btn', type: 'button', onclick: async () => {
            const ok = await confirmBox('Copy last week?', 'Shifts from the previous week are added to this week. Days that already have a shift stay as they are. Breaks are not copied.', 'Copy shifts');
            if (!ok) return;
            try {
              const r = await api('POST', '/shifts/copy-week', { from_start: addDays(state.weekStart, -7), to_start: state.weekStart });
              toast(`Copied ${r.copied} shift${r.copied === 1 ? '' : 's'}${r.kept_existing ? `. Left ${r.kept_existing} existing as they were` : ''}.`); route();
            } catch (e) { toast(e.message, true); }
          }
        }, 'Copy last week')));

    if (!w.users.length) return h('div', {}, head, h('div', { class: 'panel empty' }, 'No agents yet. Add your team under Team.'));

    const table = h('table', { class: 'sched' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Agent'),
        w.days.map(d => h('th', { class: d === w.now.date ? 'today' : '' }, `${dowShort(d)} ${dateShort(d)}`)))),
      h('tbody', {}, w.users.map(u => h('tr', {}, h('th', { scope: 'row' }, u.name),
        w.days.map(d => {
          const s = w.shifts.find(x => x.user_id === u.id && x.date === d);
          return h('td', {}, h('button', {
            class: 'cell' + (s ? '' : ' off'), type: 'button',
            'aria-label': `${u.name}, ${dowShort(d)} ${dateShort(d)}: ${s ? range(s.start_min, s.end_min) : 'day off'}. Edit.`,
            onclick: () => shiftDialog(u, d, s, w.days)
          }, s ? `${fmt(s.start_min)}–${fmt(s.end_min)}` : 'Off'));
        })))));

    return h('div', {}, head,
      h('div', { class: 'panel scroll' }, table),
      h('p', { class: 'muted small', style: 'margin-top:12px' }, 'Select a cell to change a shift. A shift that ends after midnight counts as part of the day it starts on.'));
  };

  const lastShift = { start: '10:00', end: '19:00' };

  function shiftDialog(user, date, shift, days) {
    modal(close => {
      let working = !!shift || true;
      const start = h('input', { type: 'time', required: true, value: shift ? fromMin(shift.start_min) : lastShift.start });
      const end = h('input', { type: 'time', required: true, value: shift ? fromMin(shift.end_min) : lastShift.end });
      const apply = select([['one', 'This day only'], ['weekdays', 'Monday to Friday of this week'], ['week', 'Every day this week']], 'one');
      const hint = h('p', { class: 'small muted' });
      const err = h('p', { class: 'error', role: 'alert' });
      const times = h('div', { class: 'row' }, field('Starts', start), field('Ends', end));
      const mode = value => { working = value === 'work'; times.hidden = !working; upd(); };
      const upd = () => {
        hint.textContent = !working ? '' : (start.value && end.value && toMin(end.value) <= toMin(start.value)) ? 'This shift ends the next day.' : '';
      };
      start.addEventListener('input', upd); end.addEventListener('input', upd);

      const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Working or day off' },
        h('label', {}, h('input', { type: 'radio', name: 'mode', checked: true, onchange: () => mode('work') }), h('span', {}, 'Working')),
        h('label', {}, h('input', { type: 'radio', name: 'mode', onchange: () => mode('off') }), h('span', {}, 'Day off')));
      upd();

      const form = h('form', {
        onsubmit: async e => {
          e.preventDefault(); err.textContent = '';
          const dates = apply.value === 'one' ? [date] : apply.value === 'weekdays' ? days.slice(0, 5) : days;
          const body = { user_id: user.id, dates };
          if (working) {
            const a = toMin(start.value); let b = toMin(end.value);
            if (b === a) { err.textContent = 'Start and end times must be different.'; return; }
            if (b < a) b += 1440;
            body.start_min = a; body.end_min = b;
            lastShift.start = start.value; lastShift.end = end.value;
          } else body.off = true;
          try {
            const r = await api('PUT', '/shifts', body);
            close();
            toast(r.removed_breaks ? `Saved. ${r.removed_breaks} break${r.removed_breaks === 1 ? '' : 's'} no longer fit the shift and ${r.removed_breaks === 1 ? 'was' : 'were'} removed.` : 'Schedule saved.');
            route();
          } catch (x) { err.textContent = x.message; }
        }
      }, seg, times, hint, field('Apply to', apply), err,
        h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Close'), h('button', { class: 'btn primary', type: 'submit' }, 'Save schedule')));

      return h('div', { class: 'dlg' }, h('h2', {}, user.name), h('p', { class: 'sub' }, dayLong(date)), form);
    });
  }

  /* ================= manager: stats ================= */

  const aht = s => s == null ? '—' : `${Math.floor(s / 60)}:${pad(Math.round(s % 60))}`;
  const dec = (v, d, suffix = '') => v == null ? '—' : `${Number(v).toFixed(d)}${suffix}`;

  views.stats = async () => {
    const to = (await api('GET', '/config')).today;
    const from = addDays(to, -(state.statsDays - 1));
    const r = await api('GET', `/stats?from=${from}&to=${to}`);
    const head = h('div', { class: 'head' },
      h('div', {}, h('h1', {}, 'Agent stats'), h('p', { class: 'muted num' }, `${dateShort(from)} – ${dateShort(to)}`)),
      select([[7, 'Last 7 days'], [14, 'Last 14 days'], [30, 'Last 30 days']], state.statsDays, {
        'aria-label': 'Date range', style: 'width:auto',
        onchange: e => { state.statsDays = Number(e.target.value); route(); }
      }));

    let notice = null;
    if (r.placeholder) {
      notice = h('div', { class: 'notice' }, h('span', {}, 'These are sample numbers, not real performance. Real figures replace them once a data source is connected.'),
        h('button', {
          class: 'btn small', type: 'button', onclick: async () => {
            if (!(await confirmBox('Remove sample numbers?', 'This clears the placeholder stats. Real data from a connected source is not affected.', 'Remove sample numbers', true))) return;
            try { await api('DELETE', '/stats/placeholder'); toast('Sample numbers removed.'); route(); } catch (e) { toast(e.message, true); }
          }
        }, 'Remove sample numbers'));
    } else if (!r.live) {
      notice = h('div', { class: 'notice' }, 'No stats source is connected yet. The columns fill in once daily numbers start arriving.');
    }

    const table = h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Agent'), h('th', { class: 'num' }, 'Days'), h('th', { class: 'num' }, 'Contacts'),
        h('th', { class: 'num' }, 'Avg handle time'), h('th', { class: 'num' }, 'Quality'), h('th', { class: 'num' }, 'CSAT'), h('th', { class: 'num' }, 'Adherence'))),
      h('tbody', {}, r.rows.length ? r.rows.map(x => h('tr', {},
        h('td', {}, x.name), h('td', { class: 'num' }, x.days || '—'), h('td', { class: 'num' }, x.contacts ?? '—'),
        h('td', { class: 'num' }, aht(x.avg_handle_sec)), h('td', { class: 'num' }, dec(x.quality, 1)),
        h('td', { class: 'num' }, dec(x.csat, 2)), h('td', { class: 'num' }, dec(x.adherence, 1, '%'))))
        : h('tr', {}, h('td', { colspan: '7', class: 'muted' }, 'No agents yet.'))));

    return h('div', {}, head, notice, h('div', { class: 'panel scroll' }, table),
      h('p', { class: 'muted small', style: 'margin-top:12px' }, 'Quality, CSAT and adherence are averages over the days that have data. Avg handle time is weighted by contacts.'));
  };

  /* ================= manager: team ================= */

  views.team = async () => {
    const users = await api('GET', '/users');
    const err = h('p', { class: 'error', role: 'alert' });
    const name = h('input', { type: 'text', required: true, autocomplete: 'off' });
    const uname = h('input', { type: 'text', required: true, autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
    const pw = h('input', { type: 'text', required: true, minlength: '8', autocomplete: 'off' });
    const role = select([['agent', 'Agent'], ['manager', 'Manager']], 'agent');

    const addForm = h('form', {
      class: 'panel pad', onsubmit: async e => {
        e.preventDefault(); err.textContent = '';
        try {
          await api('POST', '/users', { name: name.value, username: uname.value, password: pw.value, role: role.value });
          toast(`${name.value} added. Share the username and temporary password with them.`); route();
        } catch (x) { err.textContent = x.message; }
      }
    },
      h('h2', { style: 'margin-bottom:14px' }, 'Add a person'),
      h('div', { class: 'row' }, field('Full name', name), field('Username', uname, 'Letters, numbers, dot, dash or underscore.')),
      h('div', { class: 'row' }, field('Temporary password', pw, 'They must change it at first sign-in.'), field('Role', role)),
      h('button', { class: 'btn primary', type: 'submit' }, 'Add person'), err);

    const resetPw = u => modal(close => {
      const p = h('input', { type: 'text', required: true, minlength: '8', autocomplete: 'off' });
      const e2 = h('p', { class: 'error', role: 'alert' });
      return h('form', {
        class: 'dlg', onsubmit: async e => {
          e.preventDefault();
          try { await api('PATCH', `/users/${u.id}`, { password: p.value }); close(); toast(`Temporary password set for ${u.name}.`); }
          catch (x) { e2.textContent = x.message; }
        }
      }, h('h2', {}, `Reset password for ${u.name}`), h('p', { class: 'sub' }, 'They will choose a new password when they next sign in.'),
        field('Temporary password', p, 'At least 8 characters.'), e2,
        h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Close'), h('button', { class: 'btn primary', type: 'submit' }, 'Set password')));
    });

    const table = h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Username'), h('th', {}, 'Role'), h('th', {}, 'Status'), h('th', {}))),
      h('tbody', {}, users.map(u => h('tr', {},
        h('td', {}, u.name), h('td', {}, u.username), h('td', {}, u.role === 'manager' ? 'Manager' : 'Agent'),
        h('td', {}, h('span', { class: 'pill' + (u.active ? '' : ' off') }, u.active ? 'Active' : 'Deactivated')),
        h('td', { class: 'num', style: 'white-space:nowrap' },
          h('button', { class: 'btn quiet small', type: 'button', onclick: () => resetPw(u) }, 'Reset password'),
          u.id === state.me.id ? null : h('button', {
            class: 'btn quiet small' + (u.active ? ' danger' : ''), type: 'button', onclick: async () => {
              if (u.active && !(await confirmBox(`Deactivate ${u.name}?`, 'They can no longer sign in and disappear from the roster. Their history is kept.', 'Deactivate', true))) return;
              try { await api('PATCH', `/users/${u.id}`, { active: !u.active }); route(); } catch (x) { toast(x.message, true); }
            }
          }, u.active ? 'Deactivate' : 'Reactivate'))))));

    return h('div', { class: 'stack' },
      h('div', { class: 'head', style: 'margin-bottom:0' }, h('h1', {}, 'Team')),
      h('div', { class: 'panel scroll' }, table), addForm);
  };

  /* ================= manager: settings ================= */

  views.settings = async () => {
    const s = state.settings;
    const num = (v, min, max) => h('input', { type: 'number', min, max, step: '1', required: true, value: v });
    const maxC = num(s.max_concurrent, 1, 50), buf = num(s.buffer_minutes, 0, 240), slot = num(s.slot_minutes, 5, 60);
    const err = h('p', { class: 'error', role: 'alert' });

    const rules = h('form', {
      class: 'panel pad', onsubmit: async e => {
        e.preventDefault(); err.textContent = '';
        try { await api('PUT', '/settings', { max_concurrent: Number(maxC.value), buffer_minutes: Number(buf.value), slot_minutes: Number(slot.value) }); toast('Rules saved.'); route(); }
        catch (x) { err.textContent = x.message; }
      }
    },
      h('h2', { style: 'margin-bottom:14px' }, 'Break rules'),
      field('People allowed on break at once', maxC, 'Agents cannot book a break that would push the team past this number.'),
      field('Keep breaks away from shift edges (minutes)', buf, 'No breaks in the first or last part of a shift. Managers can override.'),
      field('Start times land every (minutes)', slot, 'For example 15 gives 7:00, 7:15, 7:30.'),
      h('button', { class: 'btn primary', type: 'submit' }, 'Save rules'), err);

    const typeRow = t => {
      const n = h('input', { type: 'text', value: t ? t.name : '', required: true, 'aria-label': 'Break name', placeholder: 'e.g. Tea break' });
      const m = h('input', { type: 'number', min: '5', max: '180', value: t ? t.minutes : 15, required: true, 'aria-label': 'Length in minutes' });
      const p = h('input', { type: 'number', min: '1', max: '10', value: t ? t.per_shift : 1, required: true, 'aria-label': 'Allowed per shift' });
      const a = h('input', { type: 'checkbox', checked: t ? !!t.active : true, 'aria-label': 'Turned on' });
      return h('tr', {}, h('td', {}, n), h('td', { style: 'width:90px' }, m), h('td', { style: 'width:90px' }, p),
        h('td', {}, t ? a : null),
        h('td', { class: 'num' }, h('button', {
          class: 'btn small' + (t ? '' : ' primary'), type: 'button', onclick: async () => {
            try {
              if (t) await api('PATCH', `/break-types/${t.id}`, { name: n.value, minutes: Number(m.value), per_shift: Number(p.value), active: a.checked });
              else await api('POST', '/break-types', { name: n.value, minutes: Number(m.value), per_shift: Number(p.value) });
              toast(t ? 'Break type saved.' : 'Break type added.'); route();
            } catch (x) { toast(x.message, true); }
          }
        }, t ? 'Save' : 'Add')));
    };

    const types = h('div', { class: 'panel scroll' }, h('table', { class: 'inline-form' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Break'), h('th', {}, 'Minutes'), h('th', {}, 'Per shift'), h('th', {}, 'On'), h('th', {}))),
      h('tbody', {}, s.break_types.map(typeRow), typeRow(null))));

    return h('div', { class: 'stack' },
      h('div', { class: 'head', style: 'margin-bottom:0' }, h('h1', {}, 'Settings')),
      h('div', { class: 'split two' }, rules,
        h('div', {}, h('h2', { style: 'margin-bottom:12px' }, 'Break types'), types,
          h('p', { class: 'muted small', style: 'margin-top:10px' }, 'Turning a break off hides it from new bookings. Existing bookings stay.'))));
  };

  /* ================= start ================= */

  (async function boot() {
    try { state.config = await api('GET', '/config'); }
    catch { $('#app').replaceChildren(h('div', { class: 'gate' }, h('h1', {}, 'Cannot reach the server'), h('p', { class: 'muted' }, 'Check your connection and reload the page.'))); return; }
    document.title = state.config.app_name;
    try { state.me = await api('GET', '/me'); } catch { state.me = null; }
    render();
  })();
})();
