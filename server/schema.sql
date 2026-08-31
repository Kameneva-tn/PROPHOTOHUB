-- Схема бази бронювань PROPHOTO HUB.
-- Виконати один раз у Supabase → SQL Editor.

CREATE TABLE IF NOT EXISTS bookings (
  id          BIGSERIAL PRIMARY KEY,
  hall        TEXT        NOT NULL CHECK (hall IN ('tsyklorama','podcast','grymerna')),
  date        DATE        NOT NULL,
  hour        TEXT        NOT NULL,           -- 'HH:00'
  name        TEXT        NOT NULL,
  phone       TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'new' CHECK (status IN ('new','confirmed','cancelled')),
  gcal_event_id TEXT,                          -- id події в Google Calendar (дзеркало)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Одна година в одному залі може бути зайнята лише один раз.
-- База сама гарантує це навіть при одночасних запитах — жодних гонок.
-- Скасовані бронювання не блокують слот (частковий індекс).
CREATE UNIQUE INDEX IF NOT EXISTS bookings_slot_unique
  ON bookings (hall, date, hour)
  WHERE status <> 'cancelled';

-- Для швидкого читання сітки зайнятості по місяцю
CREATE INDEX IF NOT EXISTS bookings_hall_date_idx ON bookings (hall, date);

-- Запити "передзвоніть мені" — щоб не губились, якщо Telegram недоступний
CREATE TABLE IF NOT EXISTS callbacks (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT        NOT NULL,
  phone       TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- Row Level Security: закриваємо таблиці від публічного API Supabase
-- (anon / authenticated ключі). Наш сервер підключається напряму
-- до Postgres як роль postgres і RLS не підпадає — працює як раніше.
-- Політик доступу навмисно НЕ створюємо: через публічний API ці
-- таблиці недоступні нікому. Дані клієнтів (імена, телефони) захищені.
-- ---------------------------------------------------------------
ALTER TABLE bookings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE callbacks ENABLE ROW LEVEL SECURITY;
