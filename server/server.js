/**
 * Мінімальний бекенд студії:
 *  - GET  /api/availability?hall=&month=YYYY-MM   -> зайняті години по днях
 *  - POST /api/book        { hall, slots: [{date,hour}, ...], name, phone }
 *  - POST /api/callback    { name, phone }
 *
 * Both booking and callback forward the request to a Telegram chat
 * so менеджерка бачить заявки миттєво, без окремої CRM.
 *
 * Запуск:
 *   cd server && npm install && cp .env.example .env
 *   (заповнити TELEGRAM_BOT_TOKEN і TELEGRAM_CHAT_ID)
 *   npm start
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..'))); // роздає index.html/css/js/public

const DB_FILE = path.join(__dirname, 'bookings.json');
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const VALID_HALLS = ['tsyklorama', 'podcast', 'grymerna'];
const HALL_TITLES = {
  tsyklorama: 'Циклорама',
  podcast: 'Подкаст зала',
  grymerna: 'Гримерна'
};

/* ---------- проста "база" у json-файлі ---------- */
function readDb() {
  if (!fs.existsSync(DB_FILE)) return { bookings: [] };
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { bookings: [] }; }
}
function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

/* ---------- Telegram ---------- */
async function sendTelegramMessage(text) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID не задані — повідомлення НЕ відправлено:\n', text);
    return;
  }
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' })
  });
  if (!res.ok) {
    const body = await res.text();
    console.error('[telegram] помилка відправки:', res.status, body);
  }
}

/* ---------- GET /api/availability ---------- */
app.get('/api/availability', (req, res) => {
  const { hall, month } = req.query; // month = 'YYYY-MM'
  if (!VALID_HALLS.includes(hall)) return res.status(400).json({ error: 'unknown hall' });

  const db = readDb();
  const result = {}; // { 'YYYY-MM-DD': ['10:00', '14:00', ...] }

  db.bookings
    .filter((b) => b.hall === hall && (!month || b.date.startsWith(month)))
    .forEach((b) => {
      if (!result[b.date]) result[b.date] = [];
      result[b.date].push(b.hour);
    });

  res.json(result);
});

/* ---------- POST /api/book ---------- */
// Приймає ОДРАЗУ кілька комірок (мультивибір годин на календарі-сітці).
// Перевіряємо конфлікти по ВСІХ слотах перед записом — щоб не вийшло
// напівзаброньованого запиту, якщо один із слотів зайняли за секунду до нас.
app.post('/api/book', async (req, res) => {
  const { hall, slots, name, phone } = req.body || {};

  if (!VALID_HALLS.includes(hall)) return res.status(400).json({ error: 'unknown hall' });
  if (!Array.isArray(slots) || !slots.length || !name || !phone) {
    return res.status(400).json({ error: 'missing fields' });
  }
  for (const s of slots) {
    if (!s || !s.date || !s.hour) return res.status(400).json({ error: 'invalid slot' });
  }

  const db = readDb();
  const conflicts = slots.filter((s) =>
    db.bookings.some((b) => b.hall === hall && b.date === s.date && b.hour === s.hour)
  );
  if (conflicts.length) return res.status(409).json({ error: 'slot already booked', conflicts });

  const createdAt = new Date().toISOString();
  const bookings = slots.map((s) => ({
    id: `${Date.now().toString(36)}-${s.date}-${s.hour}`,
    hall, date: s.date, hour: s.hour, name, phone, createdAt
  }));
  db.bookings.push(...bookings);
  writeDb(db);

  const slotsList = slots
    .slice()
    .sort((a, b) => (a.date + a.hour).localeCompare(b.date + b.hour))
    .map((s) => `${s.date} ${s.hour}`)
    .join('\n');

  await sendTelegramMessage(
    `📸 <b>Нове бронювання</b>\n` +
    `Зал: ${HALL_TITLES[hall] || hall}\n` +
    `Години:\n${slotsList}\n` +
    `Ім'я: ${name}\n` +
    `Телефон: ${phone}`
  );

  res.status(201).json({ ok: true, bookings });
});

/* ---------- POST /api/callback ---------- */
app.post('/api/callback', async (req, res) => {
  const { name, phone } = req.body || {};
  if (!name || !phone) return res.status(400).json({ error: 'missing fields' });

  await sendTelegramMessage(
    `☎️ <b>Запит "передзвоніть мені"</b>\n` +
    `Ім'я: ${name}\n` +
    `Телефон: ${phone}`
  );

  res.status(201).json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Studio server running on http://localhost:${PORT}`);
});
