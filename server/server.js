/**
 * Бекенд студії PRO PHOTO studio.
 *
 * Публічні ендпоінти (як і раніше — фронт не змінювався):
 *  GET  /api/availability?hall=&month=YYYY-MM   -> зайняті години по днях
 *  POST /api/book        { hall, slots:[{date,hour}], name, phone }
 *  POST /api/callback    { name, phone }
 *  GET  /api/health
 *
 * Адмін-ендпоінти (потрібен заголовок X-Admin-Token = ADMIN_TOKEN з .env):
 *  GET    /api/admin/bookings?from=YYYY-MM-DD&to=YYYY-MM-DD&hall=&status=
 *  DELETE /api/admin/bookings/:id            -> скасувати бронювання (слот звільняється)
 *  POST   /api/admin/bookings                -> вручну зайняти години { hall, slots, name?, note? }
 *  GET    /api/admin/ping                    -> перевірка токена
 *
 * Сховище: якщо задано DATABASE_URL — PostgreSQL (таблиця створюється сама),
 * інакше — файл bookings.json поруч із server.js.
 *
 * Скасовані бронювання не видаляються, а отримують status = 'cancelled':
 * у сітці зайнятості вони не показуються, але історія лишається.
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

const VALID_HALLS = ['tsyklorama', 'podcast', 'grymerna'];
const HALL_TITLES = { tsyklorama: 'Циклорама', podcast: 'Подкаст зала', grymerna: 'Гримерна' };
const HOUR_RE = /^\d{2}:\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* =========================================================
   Сховище: два варіанти з однаковим інтерфейсом
   ========================================================= */
const store = DATABASE_URL ? makePgStore() : makeJsonStore();

function makeJsonStore() {
  const DB_FILE = path.join(__dirname, 'bookings.json');
  const read = () => {
    if (!fs.existsSync(DB_FILE)) return { bookings: [] };
    try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return { bookings: [] }; }
  };
  const write = (db) => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  const active = (b) => (b.status || 'active') === 'active';

  return {
    kind: 'json',
    async ping() { return true; },
    async list({ hall, from, to, status }) {
      return read().bookings.filter((b) =>
        (!hall || b.hall === hall) &&
        (!from || b.date >= from) &&
        (!to || b.date <= to) &&
        (status === 'all' ? true : (b.status || 'active') === (status || 'active'))
      );
    },
    async busy({ hall, month }) {
      return read().bookings.filter((b) => active(b) && b.hall === hall && (!month || b.date.startsWith(month)));
    },
    async conflicts(hall, slots) {
      const rows = read().bookings.filter(active);
      return slots.filter((s) => rows.some((b) => b.hall === hall && b.date === s.date && b.hour === s.hour));
    },
    async insert(rows) { const db = read(); db.bookings.push(...rows); write(db); return rows; },
    async get(id) { return read().bookings.find((b) => b.id === id) || null; },
    async cancel(id, reason) {
      const db = read();
      const b = db.bookings.find((x) => x.id === id);
      if (!b) return null;
      if ((b.status || 'active') !== 'active') return b;
      b.status = 'cancelled'; b.cancelledAt = new Date().toISOString(); if (reason) b.cancelReason = reason;
      write(db); return b;
    }
  };
}

function makePgStore() {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const ready = pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id           TEXT PRIMARY KEY,
      hall         TEXT NOT NULL,
      date         TEXT NOT NULL,
      hour         TEXT NOT NULL,
      name         TEXT,
      phone        TEXT,
      note         TEXT,
      status       TEXT NOT NULL DEFAULT 'active',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      cancelled_at TIMESTAMPTZ,
      cancel_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS bookings_hall_date ON bookings (hall, date);
  `).catch((e) => console.error('[pg] init error', e));
  const rowToObj = (r) => ({
    id: r.id, hall: r.hall, date: r.date, hour: r.hour, name: r.name, phone: r.phone, note: r.note,
    status: r.status, createdAt: r.created_at, cancelledAt: r.cancelled_at, cancelReason: r.cancel_reason
  });

  return {
    kind: 'postgres',
    async ping() { await ready; await pool.query('SELECT 1'); return true; },
    async list({ hall, from, to, status }) {
      await ready;
      const w = []; const p = [];
      if (hall) { p.push(hall); w.push(`hall = $${p.length}`); }
      if (from) { p.push(from); w.push(`date >= $${p.length}`); }
      if (to) { p.push(to); w.push(`date <= $${p.length}`); }
      if (status !== 'all') { p.push(status || 'active'); w.push(`status = $${p.length}`); }
      const r = await pool.query(`SELECT * FROM bookings ${w.length ? 'WHERE ' + w.join(' AND ') : ''}`, p);
      return r.rows.map(rowToObj);
    },
    async busy({ hall, month }) {
      await ready;
      const r = await pool.query(
        `SELECT * FROM bookings WHERE status='active' AND hall=$1 ${month ? 'AND date LIKE $2' : ''}`,
        month ? [hall, month + '%'] : [hall]
      );
      return r.rows.map(rowToObj);
    },
    async conflicts(hall, slots) {
      await ready;
      const r = await pool.query(`SELECT date, hour FROM bookings WHERE status='active' AND hall=$1`, [hall]);
      return slots.filter((s) => r.rows.some((b) => b.date === s.date && b.hour === s.hour));
    },
    async insert(rows) {
      await ready;
      for (const b of rows) {
        await pool.query(
          `INSERT INTO bookings (id, hall, date, hour, name, phone, note, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8)`,
          [b.id, b.hall, b.date, b.hour, b.name, b.phone, b.note || null, b.createdAt]
        );
      }
      return rows;
    },
    async get(id) { await ready; const r = await pool.query('SELECT * FROM bookings WHERE id=$1', [id]); return r.rows[0] ? rowToObj(r.rows[0]) : null; },
    async cancel(id, reason) {
      await ready;
      const r = await pool.query(
        `UPDATE bookings SET status='cancelled', cancelled_at=now(), cancel_reason=$2 WHERE id=$1 AND status='active' RETURNING *`,
        [id, reason || null]
      );
      if (r.rows[0]) return rowToObj(r.rows[0]);
      return this.get(id);
    }
  };
}

/* =========================================================
   Telegram
   ========================================================= */
async function sendTelegramMessage(text) {
  if (!BOT_TOKEN || !CHAT_ID) { console.warn('[telegram] токен/чат не задані:\n', text); return; }
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' })
    });
    if (!res.ok) console.error('[telegram] помилка', res.status, await res.text());
  } catch (e) { console.error('[telegram] помилка', e.message); }
}
const esc = (s) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const slotsText = (slots) => slots.slice().sort((a, b) => (a.date + a.hour).localeCompare(b.date + b.hour)).map((s) => `${s.date} ${s.hour}`).join('\n');

/* =========================================================
   Публічні ендпоінти
   ========================================================= */
app.get('/api/health', async (req, res) => {
  try { await store.ping(); res.json({ ok: true, db: 'up', store: store.kind }); }
  catch (e) { res.status(500).json({ ok: false, db: 'down', error: e.message }); }
});

app.get('/api/availability', async (req, res) => {
  const { hall, month } = req.query;
  if (!VALID_HALLS.includes(hall)) return res.status(400).json({ error: 'unknown hall' });
  try {
    const rows = await store.busy({ hall, month });
    const result = {};
    rows.forEach((b) => { (result[b.date] = result[b.date] || []).push(b.hour); });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function validateSlots(hall, slots) {
  if (!VALID_HALLS.includes(hall)) return 'unknown hall';
  if (!Array.isArray(slots) || !slots.length) return 'no slots';
  for (const s of slots) if (!s || !DATE_RE.test(s.date || '') || !HOUR_RE.test(s.hour || '')) return 'invalid slot';
  return null;
}

app.post('/api/book', async (req, res) => {
  const { hall, slots, name, phone } = req.body || {};
  const err = validateSlots(hall, slots);
  if (err) return res.status(400).json({ error: err });
  if (!name || !phone) return res.status(400).json({ error: 'missing fields' });
  try {
    const conflicts = await store.conflicts(hall, slots);
    if (conflicts.length) return res.status(409).json({ error: 'slot already booked', conflicts });
    const createdAt = new Date().toISOString();
    const rows = slots.map((s) => ({ id: `${Date.now().toString(36)}-${s.date}-${s.hour}`, hall, date: s.date, hour: s.hour, name, phone, createdAt, status: 'active' }));
    await store.insert(rows);
    await sendTelegramMessage(`📸 <b>Нове бронювання</b>\nЗал: ${HALL_TITLES[hall]}\nГодини:\n${slotsText(slots)}\nІм'я: ${esc(name)}\nТелефон: ${esc(phone)}`);
    res.status(201).json({ ok: true, bookings: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/callback', async (req, res) => {
  const { name, phone } = req.body || {};
  if (!name || !phone) return res.status(400).json({ error: 'missing fields' });
  await sendTelegramMessage(`☎️ <b>Запит "передзвоніть мені"</b>\nІм'я: ${esc(name)}\nТелефон: ${esc(phone)}`);
  res.status(201).json({ ok: true });
});

/* =========================================================
   Адмін-ендпоінти (керування бронюваннями)
   ========================================================= */
function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return res.status(503).json({ error: 'ADMIN_TOKEN не задано в .env — адмінка вимкнена' });
  const token = req.get('X-Admin-Token') || (req.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  next();
}

app.get('/api/admin/ping', requireAdmin, (req, res) => res.json({ ok: true }));

app.get('/api/admin/bookings', requireAdmin, async (req, res) => {
  const { hall, from, to, status } = req.query;
  if (hall && !VALID_HALLS.includes(hall)) return res.status(400).json({ error: 'unknown hall' });
  try {
    const rows = await store.list({ hall, from, to, status });
    rows.sort((a, b) => (a.date + a.hour).localeCompare(b.date + b.hour));
    res.json(rows.map((b) => ({ ...b, hallTitle: HALL_TITLES[b.hall] || b.hall })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/bookings/:id', requireAdmin, async (req, res) => {
  try {
    const before = await store.get(req.params.id);
    if (!before) return res.status(404).json({ error: 'not found' });
    if ((before.status || 'active') !== 'active') return res.json({ ok: true, booking: before, alreadyCancelled: true });
    const b = await store.cancel(req.params.id, (req.body && req.body.reason) || (req.query.reason) || '');
    await sendTelegramMessage(`❌ <b>Бронювання скасовано</b>\nЗал: ${HALL_TITLES[b.hall]}\n${b.date} ${b.hour}\nКлієнт: ${esc(b.name)} ${esc(b.phone)}${b.cancelReason ? `\nПричина: ${esc(b.cancelReason)}` : ''}`);
    res.json({ ok: true, booking: b });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Вручну зайняти години (техперерва, власна зйомка, бронь по телефону)
app.post('/api/admin/bookings', requireAdmin, async (req, res) => {
  const { hall, slots, name, phone, note } = req.body || {};
  const err = validateSlots(hall, slots);
  if (err) return res.status(400).json({ error: err });
  try {
    const conflicts = await store.conflicts(hall, slots);
    if (conflicts.length) return res.status(409).json({ error: 'slot already booked', conflicts });
    const createdAt = new Date().toISOString();
    const rows = slots.map((s) => ({ id: `${Date.now().toString(36)}-${s.date}-${s.hour}`, hall, date: s.date, hour: s.hour, name: name || 'Адмін', phone: phone || '', note: note || '', createdAt, status: 'active' }));
    await store.insert(rows);
    res.status(201).json({ ok: true, bookings: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`Studio server on http://localhost:${PORT} (store: ${store.kind})`));
