# Деплой бекенду бронювання — покроково

Архітектура (усе безкоштовно):

```
GitHub Pages (фронт)  →  Render (Express API)  →  Supabase (PostgreSQL — ДЖЕРЕЛО ПРАВДИ)
                                              →  Telegram (сповіщення менеджерці)
                                              →  Google Calendar (дзеркало для зручності)
```

**Джерело правди — база на сервері** (PostgreSQL на Supabase). Сітка зайнятості на
сайті читається з неї, бронювання пишуться в неї. Дані не зникають при перезапусках.
Подвійне бронювання неможливе на рівні бази.

**Google Calendar — лише дзеркало:** кожне бронювання після запису в базу дублюється
подією в календар, щоб менеджерка бачила розклад у звичному вигляді. Календар нічого
не диктує серверу; якщо він недоступний — бронювання все одно збережене.

Час на все: ~20 хвилин (календар — опційний крок, +5 хв).

---

## Крок 1. База даних — Supabase (5 хв)

1. Зайди на https://supabase.com → **Start your project** → увійди через GitHub.
2. **New project**: назва `prophoto`, придумай і **збережи пароль** бази, регіон — `Central EU (Frankfurt)`.
3. Дочекайся створення (~1 хв). Зліва відкрий **SQL Editor** → **New query**.
4. Скопіюй увесь вміст файлу `server/schema.sql` → встав → **Run**. Має з'явитись `Success`.
5. Візьми рядок підключення: **Project Settings** (шестерня зліва внизу) → **Database** →
   блок **Connection string** → вкладка **URI** → перемикач **Transaction** (порт `6543`).
   Скопіюй, підстав свій пароль замість `[YOUR-PASSWORD]`. Це `DATABASE_URL`.

## Крок 2. Telegram-бот (3 хв)

1. У Telegram відкрий **@BotFather** → `/newbot` → назва (напр. `PROPHOTO Booking`) →
   username (напр. `prophoto_booking_bot`). Отримаєш **токен** — це `TELEGRAM_BOT_TOKEN`.
2. Знайди свого бота в Telegram і натисни **Start**, напиши йому будь-що.
3. Відкрий у браузері (підставивши токен):
   `https://api.telegram.org/bot<ТОКЕН>/getUpdates`
   У відповіді знайди `"chat":{"id":123456789` — це число і є `TELEGRAM_CHAT_ID`.

> Щоб сповіщення приходили в **групу** менеджерів — додай бота в групу, напиши там
> повідомлення й повтори п. 3: id групи буде з мінусом (напр. `-100123456789`).

## Крок 3. Google Calendar — дзеркало (5 хв, опційно)

Можна пропустити — без цього все працює. Повернутись і додати можна будь-коли.

1. Відкрий https://console.cloud.google.com → створи проєкт (напр. `prophoto`).
2. **APIs & Services → Library** → знайди **Google Calendar API** → **Enable**.
3. **APIs & Services → Credentials → Create Credentials → Service account** →
   назва `prophoto-booking` → **Done**.
4. Відкрий створений акаунт → вкладка **Keys → Add key → Create new key → JSON** →
   файл завантажиться. Запам'ятай **email** акаунта (вигляд `prophoto-booking@...iam.gserviceaccount.com`).
5. У **Google Calendar** (звичайний) створи окремий календар «Бронювання PROPHOTO»
   (або візьми існуючий) → його **Settings → Share with specific people** → додай email
   сервісного акаунта з правом **Make changes to events**.
6. Там же нижче **Integrate calendar → Calendar ID** — скопіюй. Це `GOOGLE_CALENDAR_ID`.
7. Відкрий завантажений JSON-файл, скопіюй **увесь вміст одним рядком** —
   це `GOOGLE_SERVICE_ACCOUNT_JSON`.

## Крок 4. Сервер — Render (5 хв)

1. Зайди на https://render.com → увійди через GitHub.
2. **New +** → **Blueprint** → обери репозиторій `PROPHOTOHUB` → Render сам знайде `render.yaml`.
3. Він попросить заповнити змінні оточення:
   - `DATABASE_URL` — з кроку 1
   - `TELEGRAM_BOT_TOKEN` — з кроку 2
   - `TELEGRAM_CHAT_ID` — з кроку 2
   - `GOOGLE_CALENDAR_ID` — з кроку 3 (або лишити порожнім)
   - `GOOGLE_SERVICE_ACCOUNT_JSON` — з кроку 3 (або лишити порожнім)
   - `ALLOWED_ORIGIN` — вже підставлено `https://kameneva-tn.github.io`
4. **Apply**. Через ~2 хв сервер запуститься. Його адреса виглядатиме як
   `https://prophoto-api.onrender.com`.
5. Перевір: відкрий `https://prophoto-api.onrender.com/api/health` — має бути
   `{"ok":true,"db":"up"}`.

## Крок 5. Підключити фронт (1 хв)

У `index.html` унизу є рядок:

```html
<script>window.STUDIO_API_BASE = 'https://prophoto-api.onrender.com/api';</script>
```

Якщо Render дав іншу адресу — заміни її тут (залиш `/api` в кінці). Закоміть і запуш —
GitHub Pages оновиться за хвилину.

**Готово.** Тепер бронювання з сайту записуються в базу, прилітають у Telegram
і з'являються в Google Calendar (суцільні години зливаються в одну подію: 12:00–15:00).

---

## Що варто знати

- **Безкоштовний Render «засинає»** після 15 хв без запитів. Перший запит після сну
  займе ~30 с (сітка бронювання завантажиться з затримкою), далі — миттєво.
  Якщо це критично — Render Starter ($7/міс) або зовнішній «пінгер» (напр. cron-job.org
  б'є `/api/health` кожні 10 хв).
- **Подивитись усі бронювання**: Supabase → **Table Editor** → `bookings`. Там же можна
  змінити `status` на `confirmed` / `cancelled` (скасовані звільняють слот у сітці).
- **Запити «передзвоніть мені»** дублюються в таблицю `callbacks` — не губляться, навіть
  якщо Telegram тимчасово недоступний.
- **Скасувати бронювання**: зміни `status` на `cancelled` у Supabase — слот звільниться
  в сітці на сайті. Подію в календарі видали вручну (id події записаний у колонці
  `gcal_event_id`). Календар — дзеркало, тому видалення події в календарі НЕ звільняє слот.
- Ліміти Supabase Free: 500 МБ бази — це десятки тисяч бронювань.

## Локальний запуск (для розробки)

```bash
cd server
npm install
cp .env.example .env     # вписати DATABASE_URL з Supabase + Telegram
npm start                # http://localhost:3000 — і фронт, і API
```
