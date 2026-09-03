# Бекенд студії — версія з керуванням бронюваннями

Замінює `server.js` і `package.json` у папці `server/` репозиторію ProPhoto-Hub
(або там, звідки деплоїться prophoto-api.onrender.com).

## Що нового

- `GET  /api/admin/bookings?from&to&hall&status` — список бронювань з іменами й телефонами
- `DELETE /api/admin/bookings/:id` — скасувати годину (слот одразу звільняється на сайті, у Telegram приходить повідомлення)
- `POST /api/admin/bookings` — зайняти години вручну (техперерва, бронь по телефону)
- `GET  /api/health`
- скасовані бронювання не зникають, а отримують `status: cancelled` — історія лишається
- сховище: PostgreSQL, якщо задано `DATABASE_URL`, інакше файл `bookings.json`

Публічні ендпоінти (`/api/availability`, `/api/book`, `/api/callback`) не змінилися — сайт працює як і раніше.

## Налаштування на Render

1. Замінити файли в репозиторії → Render сам передеплоїть.
2. Render → ваш сервіс → Environment → додати змінну **ADMIN_TOKEN** — це пароль адмінки.
   Довгий випадковий рядок, 20+ символів. Без нього адмінка не працює.
3. **Важливо про базу.** На безкоштовному Render файл `bookings.json` стирається при кожному
   деплої та перезапуску — усі бронювання пропадуть. Щоб цього не було:
   Render → New → PostgreSQL (free) → скопіювати *Internal Database URL* → додати змінну
   **DATABASE_URL** у сервіс. Таблиця створиться сама при першому запуску.

## Локально

    npm install
    cp .env.example .env   # заповнити
    npm start              # http://localhost:3000
