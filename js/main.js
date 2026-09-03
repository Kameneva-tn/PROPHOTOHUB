/* =========================================================
   API base — сюди йдуть заявки з форм (див. server/server.js)
   ========================================================= */
const API_BASE = window.STUDIO_API_BASE || '/api';

/* =========================================================
   1. HERO BG ZOOM — більше не прив'язано до скролу.
   Автоматичний "дихаючий" зум (1 → 1.3 → 1, 15с + 15с)
   тепер живе в CSS як @keyframes heroBgZoom на .hero__bg-img,
   тож JS тут нічого не рахує (нема scroll-листенера — легше і для
   GPU, і для читання коду). Лого (.hero__portrait) більше не
   масштабується — воно статичне.
   ========================================================= */

/* =========================================================
   2. PARALLAX ФОТО ЗАЛ + ТЕКСТУ (легкий вертикальний зсув
   відносно швидкості скролу — глибина між шарами)
   ========================================================= */
(function parallaxLayers() {
  const photos = document.querySelectorAll('[data-parallax]');
  const texts = document.querySelectorAll('.section-title, .watermark');
  if (!photos.length) return;

  // На телефонах і планшетах паралакс вимкнено: на тач-скролі він смикає фото,
  // а CSS для мобільного і так фіксує transform: none.
  const mobile = window.matchMedia('(max-width: 900px), (pointer: coarse)');
  if (mobile.matches) return;
  document.body.classList.add('has-parallax');

  let ticking = false;
  function update() {
    ticking = false;
    const vh = window.innerHeight;
    photos.forEach((el) => {
      const speed = parseFloat(el.dataset.parallax) || 0.1;
      const rect = el.getBoundingClientRect();
      const centerOffset = rect.top + rect.height / 2 - vh / 2;
      el.style.transform = `translateY(${(-centerOffset * speed).toFixed(1)}px) scale(1.08)`;
    });
    texts.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const centerOffset = rect.top + rect.height / 2 - vh / 2;
      el.style.transform = `translateY(${(-centerOffset * 0.04).toFixed(1)}px)`;
    });
  }
  function onScroll() {
    if (!ticking) { ticking = true; requestAnimationFrame(update); } // один перерахунок на кадр
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  update();
})();

/* =========================================================
   3. CALLBACK MODAL ("передзвоніть мені")
   ========================================================= */
(function callbackModal() {
  const fab = document.getElementById('callFab');
  const contactsBtn = document.getElementById('contactsCallBtn');
  const modal = document.getElementById('callModal');
  const backdrop = document.getElementById('callModalBackdrop');
  const closeBtn = document.getElementById('callModalClose');
  const form = document.getElementById('callbackForm');
  const status = document.getElementById('callbackStatus');
  if (!modal) return;

  function open() { modal.hidden = false; document.body.style.overflow = 'hidden'; }
  function close() { modal.hidden = true; document.body.style.overflow = ''; }

  fab && fab.addEventListener('click', open);
  contactsBtn && contactsBtn.addEventListener('click', open);
  backdrop.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) close(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    status.textContent = 'Надсилаємо…';
    status.className = 'booking-form__status';
    try {
      const res = await fetch(`${API_BASE}/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('bad status');
      status.textContent = 'Дякуємо! Ми передзвонимо найближчим часом.';
      status.classList.add('ok');
      form.reset();
      setTimeout(close, 1600);
    } catch (err) {
      status.textContent = 'Не вдалось відправити. Зателефонуйте нам напряму: 096 451 50 10.';
      status.classList.add('err');
    }
  });
})();

/* =========================================================
   4. ЗАЛИ — опис залу розгортається при наведенні (js/hall-card.js),
   клік по назві чи фото веде на сторінку залу
   ========================================================= */
(function hallCards() {
  document.querySelectorAll('[data-hall-card]').forEach((el) => {
    el.innerHTML = renderHallCard(el.dataset.hallCard);
  });
})();

/* =========================================================
   5. БРОНЮВАННЯ: сітка "дні × години" з ціною в комірці + відправка заявки
   Джерело зайнятості — GET /api/availability?hall=&month=
   Формат відповіді описаний в server/server.js
   Ціни — HALLS[hall].rate (денна ставка) з halls-data.js;
   нічна надбавка NIGHT_MULTIPLIER застосовується до годин
   до 10:00 і від 20:00 (див. коментар у halls-data.js).
   ========================================================= */
(function booking() {
  const hallTabs = document.querySelectorAll('.hall-tab');
  const gridPrev = document.getElementById('gridPrev');
  const gridNext = document.getElementById('gridNext');
  const gridToday = document.getElementById('gridToday');
  const gridRangeLabel = document.getElementById('gridRangeLabel');
  const gridTable = document.getElementById('hourGridTable');
  const summary = document.getElementById('bookingSummary');
  const form = document.getElementById('bookingForm');
  const status = document.getElementById('bookingStatus');
  if (!gridTable || !form) return;

  // 14 днів на десктопі, 7 — на телефоні (щоб сітка вміщалася в екран)
  const mobileGrid = window.matchMedia('(max-width: 600px)');
  const daysVisible = () => (mobileGrid.matches ? 7 : 14);
  // Денні та вечірні години показуються завжди; нічні (23:00–08:00) — за перемикачем.
  const DAY_HOURS = ['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00','22:00'];
  const NIGHT_HOURS = ['23:00','00:00','01:00','02:00','03:00','04:00','05:00','06:00','07:00'];
  let showNight = false;
  const WEEKDAYS_SHORT = ['Пн','Вт','Ср','Чт','Пт','Сб','Нд'];

  const pad = (n) => String(n).padStart(2, '0');
  const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const startOfDay = (d) => { const c = new Date(d); c.setHours(0, 0, 0, 0); return c; };
  const monthKeyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

  const state = {
    hall: 'tsyklorama',
    windowStart: startOfDay(new Date()),
    selectedSlots: new Map(), // ключ `${date}|${hour}` -> {date, hour} — мультивибір комірок
    availability: {}    // { 'YYYY-MM-DD': ['08:00','09:00', ...заброньовані години] }
  };

  const slotKey = (date, hour) => `${date}|${hour}`;
  const sortedSlots = () => [...state.selectedSlots.values()]
    .sort((a, b) => (a.date + a.hour).localeCompare(b.date + b.hour));

  function priceFor(hallKey, hour) {
    const hall = HALLS[hallKey];
    if (!hall || hall.rate == null) return null; // ціну ще не задано (напр. гримерна)
    return Math.round(hall.rate * rateMultiplier(hour));
  }

  function buildDateList() {
    const dates = [];
    for (let i = 0; i < daysVisible(); i++) {
      const d = new Date(state.windowStart);
      d.setDate(d.getDate() + i);
      dates.push(d);
    }
    return dates;
  }

  // Зал можна передати з URL: index.html#booking?hall=podcast (так роблять сторінки залів)
  function hallFromUrl() {
    const mm = location.hash.match(/hall=(tsyklorama|podcast|grymerna)/);
    return mm ? mm[1] : null;
  }
  function selectHall(key) {
    const tab = [...hallTabs].find((t) => t.dataset.hall === key);
    if (tab) tab.click();
  }
  const initialHall = hallFromUrl();
  if (initialHall) setTimeout(() => {
    selectHall(initialHall);
    // хеш виду #booking?hall=... браузер сам не скролить — робимо це вручну
    const target = document.getElementById('booking');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 0);
  window.addEventListener('hashchange', () => { const k = hallFromUrl(); if (k) selectHall(k); });

  hallTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      hallTabs.forEach((t) => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      state.hall = tab.dataset.hall;
      state.selectedSlots.clear(); // бронювання прив'язане до одного залу — при зміні залу підбір годин скидаємо
      loadAvailability();
      updateSummary();
    });
  });

  gridPrev.addEventListener('click', () => { state.windowStart.setDate(state.windowStart.getDate() - daysVisible()); loadAvailability(); });
  gridNext.addEventListener('click', () => { state.windowStart.setDate(state.windowStart.getDate() + daysVisible()); loadAvailability(); });
  gridToday.addEventListener('click', () => { state.windowStart = startOfDay(new Date()); loadAvailability(); });
  const nightToggle = document.getElementById('gridNight');
  if (nightToggle) nightToggle.addEventListener('click', () => {
    showNight = !showNight;
    nightToggle.classList.toggle('is-on', showNight);
    nightToggle.setAttribute('aria-pressed', String(showNight));
    renderGrid(buildDateList());
  });
  // повернули телефон / змінили ширину — перебудувати сітку під 7 або 14 днів
  let lastDays = daysVisible();
  window.addEventListener('resize', () => {
    const d = daysVisible();
    if (d !== lastDays) { lastDays = d; loadAvailability(); }
  });

  async function loadAvailability() {
    const dates = buildDateList();
    const months = [...new Set(dates.map(monthKeyOf))];
    const merged = {};
    for (const monthKey of months) {
      try {
        const res = await fetch(`${API_BASE}/availability?hall=${state.hall}&month=${monthKey}`);
        Object.assign(merged, res.ok ? await res.json() : {});
      } catch (e) {
        // офлайн-режим — сітка все одно клікабельна, зайнятість підтвердиться на бекенді при відправці
      }
    }
    state.availability = merged;
    renderGrid(dates);
  }

  function renderGrid(dates) {
    const todayIso = isoDate(new Date());
    const now = new Date();

    const first = dates[0];
    const last = dates[dates.length - 1];
    gridRangeLabel.textContent = `${pad(first.getDate())}.${pad(first.getMonth() + 1)} – ${pad(last.getDate())}.${pad(last.getMonth() + 1)}.${last.getFullYear()}`;

    let thead = '<tr><th class="hour-grid__corner"></th>';
    dates.forEach((d) => {
      const iso = isoDate(d);
      const wd = WEEKDAYS_SHORT[(d.getDay() + 6) % 7];
      thead += `<th class="${iso === todayIso ? 'is-today' : ''}"><span class="hour-grid__daynum">${d.getDate()}</span><span class="hour-grid__wd">${wd}</span></th>`;
    });
    thead += '</tr>';

    let tbody = '';
    const hours = showNight ? DAY_HOURS.concat(NIGHT_HOURS) : DAY_HOURS;
    hours.forEach((hour) => {
      const hh = parseInt(hour, 10);
      const endLabel = pad((hh + 1) % 24);
      const isNightRow = rateMultiplier(hh) === NIGHT_MULTIPLIER;
      if (hour === '23:00') tbody += `<tr class="hour-grid__sep"><th colspan="${dates.length + 1}">Нічний час · +${Math.round((NIGHT_MULTIPLIER - 1) * 100)}% · години 00:00–08:00 — ранок обраної дати</th></tr>`;
      tbody += `<tr${isNightRow ? ' class="hour-grid__night"' : ''}><th class="hour-grid__hourlabel">${pad(hh)}-${endLabel}</th>`;
      dates.forEach((d) => {
        const iso = isoDate(d);
        const cellTime = new Date(d);
        cellTime.setHours(hh, 0, 0, 0);
        const isPast = cellTime < now;
        const bookedHours = state.availability[iso] || [];
        const isBooked = bookedHours.includes(hour);
        const price = priceFor(state.hall, hour);
        const disabled = isPast || isBooked || price == null;
        const isSelected = state.selectedSlots.has(slotKey(iso, hour));
        const label = disabled ? '<span class="hour-cell__lock" aria-hidden="true">🔒</span>' : `${price}₴`;
        tbody += `<td><button type="button" class="hour-cell${isSelected ? ' is-selected' : ''}" data-date="${iso}" data-hour="${hour}"${disabled ? ' disabled' : ''}>${label}</button></td>`;
      });
      tbody += '</tr>';
    });

    gridTable.innerHTML = `<thead>${thead}</thead><tbody>${tbody}</tbody>`;

    gridTable.querySelectorAll('button.hour-cell:not(:disabled)').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = slotKey(btn.dataset.date, btn.dataset.hour);
        if (state.selectedSlots.has(key)) {
          state.selectedSlots.delete(key); // повторний клік по обраній комірці — знімає вибір
        } else {
          state.selectedSlots.set(key, { date: btn.dataset.date, hour: btn.dataset.hour });
        }
        renderGrid(dates);
        updateSummary();
      });
    });
  }

  function updateSummary() {
    const hallTitle = HALLS[state.hall] ? HALLS[state.hall].title : state.hall;
    const slots = sortedSlots();
    if (!slots.length) {
      summary.textContent = `Зал: ${hallTitle}. Оберіть одну або кілька комірок у сітці вище.`;
      return;
    }
    let total = 0;
    const lines = slots.map((s) => {
      const price = priceFor(state.hall, s.hour);
      if (price != null) total += price;
      return `${s.date} · ${s.hour}${price != null ? ` — ${price}₴` : ''}`;
    });
    summary.innerHTML = `<strong>${hallTitle}</strong> · ${slots.length} год.<br>${lines.join('<br>')}<br><strong>Разом: ${total}₴</strong>`;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const slots = sortedSlots();
    if (!slots.length) {
      status.textContent = 'Спершу оберіть зал і хоча б одну комірку в сітці.';
      status.className = 'booking-form__status err';
      return;
    }
    const data = Object.fromEntries(new FormData(form).entries());
    const payload = {
      hall: state.hall,
      slots: slots.map((s) => ({ date: s.date, hour: s.hour })),
      name: data.name,
      phone: data.phone
    };
    status.textContent = 'Надсилаємо заявку…';
    status.className = 'booking-form__status';
    try {
      const res = await fetch(`${API_BASE}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        (body.conflicts || []).forEach((s) => state.selectedSlots.delete(slotKey(s.date, s.hour)));
        status.textContent = 'Деякі з обраних годин щойно зайняли. Оберіть інші.';
        status.className = 'booking-form__status err';
        loadAvailability();
        updateSummary();
        return;
      }
      if (!res.ok) throw new Error('bad status');
      status.textContent = 'Заявку надіслано! Менеджерка зв\'яжеться для підтвердження.';
      status.className = 'booking-form__status ok';
      form.reset();
      state.selectedSlots.clear();
      loadAvailability();
      updateSummary();
    } catch (err) {
      status.textContent = 'Не вдалось надіслати заявку. Зателефонуйте нам: 096 451 50 10.';
      status.className = 'booking-form__status err';
    }
  });

  loadAvailability();
  updateSummary();
})();
