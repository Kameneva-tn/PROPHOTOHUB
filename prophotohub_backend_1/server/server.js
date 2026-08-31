/**
 * Бекенд студії PROPHOTO HUB.
 *
 *  GET  /api/health
 *  GET  /api/availability?hall=&month=YYYY-MM  -> { 'YYYY-MM-DD': ['10:00', ...] }
 *  POST /api/book      { hall, slots:[{date,hour}], name, phone }
 *  POST /api/callback  { name, phone }
 *
 * Зберігання: PostgreSQL (Supabase). Дані ПОСТІЙНІ — не залежать від
 * перезапусків сервера. Один слот = одна година в одному залі; унікальність
 * гарантує сама база (unique index), а не JS-перевірка — тому два клієнти
 * фізично не можуть забронювати одну годину, навіть натиснувши одночасно.
 *
 * Сповіщення: Telegram (миттєво менеджерці).
 * Дзеркало: Google Calendar — кожне бронювання дублюється подією в календар.
 *   Календар НЕ є джерелом правди: він лише відображає те, що вже в базі.
 *
 * Env (див. .env.example):
 *   DATABASE_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, ALLOWED_ORIGIN, PORT
 *   GOOGLE_CALENDAR_ID, GOOGLE_SERVICE_ACCOUNT_JSON (опційно)
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

/* ---------- CORS: дозволяємо фронт на GitHub Pages ---------- */
const allowed = (process.env.ALLOWED_ORIGIN || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || !allowed.length || allowed.includes(origin)) return cb(null, true);
    cb(new Error('CORS: origin not allowed'));
  }
}));
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, '..')));

/* ---------- PostgreSQL ---------- */
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL не задано. Див. server/.env.example');
  process.exit(1);
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false } // Supabase вимагає SSL; PGSSL=off — лише для локального Postgres
});

/* ---------- довідники ---------- */
const VALID_HALLS = ['tsyklorama', 'podcast', 'grymerna'];
const HALL_TITLES = { tsyklorama: 'Циклорама', podcast: 'Подкаст зала', grymerna: 'Гримерна' };

/* ---------- валідація ---------- */
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const isHour = (s) => /^([01]\d|2[0-3]):00$/.test(s);
const isMonth = (s) => /^\d{4}-\d{2}$/.test(s);
const clean = (s, max) => String(s || '').trim().slice(0, max);

/* ---------- Telegram ---------- */
async function sendTelegramMessage(text) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn('[telegram] токен/chat_id не задані — повідомлення не відправлено:\n', text);
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' })
    });
    if (!res.ok) console.error('[telegram] помилка:', res.status, await res.text());
  } catch (e) {
    console.error('[telegram] недоступний:', e.message);
  }
}

/* ---------- Google Calendar (дзеркало, не джерело правди) ---------- */
const GCAL_ID = process.env.GOOGLE_CALENDAR_ID;
let calendarClient = null;
(function initCalendar() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!GCAL_ID || !raw) {
    console.warn('[gcal] GOOGLE_CALENDAR_ID / GOOGLE_SERVICE_ACCOUNT_JSON не задані — дублювання в календар вимкнено');
    return;
  }
  try {
    const creds = JSON.parse(raw);
    const auth = new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ['https://www.googleapis.com/auth/calendar.events']
    });
    calendarClient = google.calendar({ version: 'v3', auth });
    console.log('[gcal] підключено, календар:', GCAL_ID);
  } catch (e) {
    console.error('[gcal] не вдалось прочитати сервісний акаунт:', e.message);
  }
})();

const TZ = 'Europe/Kyiv';

// Групуємо години одного дня в суцільні інтервали: 12:00,13:00,14:00 -> одна подія 12:00–15:00
function groupSlots(slots) {
  const byDate = {};
  for (const s of slots) (byDate[s.date] ||= []).push(parseInt(s.hour, 10));
  const events = [];
  for (const [date, hours] of Object.entries(byDate)) {
    hours.sort((a, b) => a - b);
    let start = hours[0], prev = hours[0];
    for (let i = 1; i <= hours.length; i++) {
      if (i < hours.length && hours[i] === prev + 1) { prev = hours[i]; continue; }
      events.push({ date, from: start, to: prev + 1 });
      if (i < hours.length) { start = hours[i]; prev = hours[i]; }
    }
  }
  return events;
}

async function mirrorToCalendar({ hall, slots, name, phone, bookingIds }) {
  if (!calendarClient) return [];
  const created = [];
  for (const ev of groupSlots(slots)) {
    const pad = (n) => String(n).padStart(2, '0');
    try {
      const res = await calendarClient.events.insert({
        calendarId: GCAL_ID,
        requestBody: {
          summary: `${HALL_TITLES[hall]} — ${name}`,
          description: `Телефон: ${phone}\nЗал: ${HALL_TITLES[hall]}\nID бронювань: ${bookingIds.join(', ')}\n\nСтворено сайтом. Джерело правди — база бронювань.`,
          start: { dateTime: `${ev.date}T${pad(ev.from)}:00:00`, timeZone: TZ },
          end:   { dateTime: `${ev.date}T${pad(ev.to)}:00:00`,   timeZone: TZ },
          colorId: { tsyklorama: '9', podcast: '7', grymerna: '5' }[hall]
        }
      });
      created.push(res.data.id);
    } catch (e) {
      console.error('[gcal] не вдалось створити подію:', e.message);
    }
  }
  return created;
}

const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

/* ---------- GET /api/health ---------- */
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'up' });
  } catch (e) {
    res.status(500).json({ ok: false, db: 'down', error: e.message });
  }
});

/* ---------- GET /api/availability ---------- */
app.get('/api/availability', async (req, res) => {
  const { hall, month } = req.query;
  if (!VALID_HALLS.includes(hall)) return res.status(400).json({ error: 'unknown hall' });
  if (month && !isMonth(month)) return res.status(400).json({ error: 'bad month' });

  try {
    const params = [hall];
    let sql = `SELECT to_char(date,'YYYY-MM-DD') AS date, hour
               FROM bookings WHERE hall = $1 AND status <> 'cancelled'`;
    if (month) { sql += ` AND to_char(date,'YYYY-MM') = $2`; params.push(month); }
    const { rows } = await pool.query(sql, params);

    const result = {};
    for (const r of rows) (result[r.date] ||= []).push(r.hour);
    res.json(result);
  } catch (e) {
    console.error('[availability]', e);
    res.status(500).json({ error: 'db error' });
  }
});

/* ---------- POST /api/book ---------- */
app.post('/api/book', async (req, res) => {
  const { hall, slots } = req.body || {};
  const name = clean(req.body?.name, 80);
  const phone = clean(req.body?.phone, 30);

  if (!VALID_HALLS.includes(hall)) return res.status(400).json({ error: 'unknown hall' });
  if (!Array.isArray(slots) || !slots.length || slots.length > 24 || !name || !phone) {
    return res.status(400).json({ error: 'missing fields' });
  }
  for (const s of slots) {
    if (!s || !isDate(s.date) || !isHour(s.hour)) return res.status(400).json({ error: 'invalid slot' });
  }

  // Усі слоти — однією транзакцією: або всі записались, або жоден.
  // Якщо хоч один зайнятий — база кине помилку унікальності, транзакція
  // відкотиться, клієнт отримає 409 зі списком конфліктів.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = [];
    for (const s of slots) {
      const { rows } = await client.query(
        `INSERT INTO bookings (hall, date, hour, name, phone)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, to_char(date,'YYYY-MM-DD') AS date, hour`,
        [hall, s.date, s.hour, name, phone]
      );
      inserted.push(rows[0]);
    }
    await client.query('COMMIT');

    // Дзеркало в Google Calendar — вже ПІСЛЯ збереження в базі.
    // Якщо календар недоступний — бронювання все одно збережене.
    mirrorToCalendar({ hall, slots, name, phone, bookingIds: inserted.map((b) => b.id) })
      .then(async (eventIds) => {
        if (!eventIds.length) return;
        try {
          await pool.query(
            `UPDATE bookings SET gcal_event_id = $1 WHERE id = ANY($2::bigint[])`,
            [eventIds.join(','), inserted.map((b) => b.id)]
          );
        } catch (e) { console.error('[gcal] не вдалось зберегти id події:', e.message); }
      });

    const slotsList = inserted
      .sort((a, b) => (a.date + a.hour).localeCompare(b.date + b.hour))
      .map((s) => `${s.date} ${s.hour}`).join('\n');

    sendTelegramMessage(
      `📸 <b>Нове бронювання</b>\n` +
      `Зал: ${HALL_TITLES[hall]}\n` +
      `Години:\n${esc(slotsList)}\n` +
      `Ім'я: ${esc(name)}\n` +
      `Телефон: ${esc(phone)}`
    );

    res.status(201).json({ ok: true, bookings: inserted });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') {
      // конфлікт унікальності — з'ясовуємо, які саме слоти зайняті
      const { rows } = await pool.query(
        `SELECT to_char(date,'YYYY-MM-DD') AS date, hour FROM bookings
         WHERE hall=$1 AND status<>'cancelled' AND (date, hour) IN (${slots.map((_, i) => `($${i * 2 + 2}::date,$${i * 2 + 3})`).join(',')})`,
        [hall, ...slots.flatMap((s) => [s.date, s.hour])]
      );
      return res.status(409).json({ error: 'slot already booked', conflicts: rows });
    }
    console.error('[book]', e);
    res.status(500).json({ error: 'db error' });
  } finally {
    client.release();
  }
});

/* ---------- POST /api/callback ---------- */
app.post('/api/callback', async (req, res) => {
  const name = clean(req.body?.name, 80);
  const phone = clean(req.body?.phone, 30);
  if (!name || !phone) return res.status(400).json({ error: 'missing fields' });

  try {
    await pool.query('INSERT INTO callbacks (name, phone) VALUES ($1,$2)', [name, phone]);
  } catch (e) {
    console.error('[callback db]', e); // не блокуємо — Telegram все одно піде
  }
  sendTelegramMessage(
    `☎️ <b>Запит "передзвоніть мені"</b>\n` +
    `Ім'я: ${esc(name)}\n` +
    `Телефон: ${esc(phone)}`
  );
  res.status(201).json({ ok: true });
});

app.listen(PORT, () => console.log(`PROPHOTO server → http://localhost:${PORT}`));
