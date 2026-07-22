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

  function update() {
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

  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
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
   4. ЗАЛИ — клік по фото відкриває інформацію про зал
   ========================================================= */
(function hallInfoToggle() {
  const buttons = document.querySelectorAll('.hall-col');
  const panel = document.getElementById('hallInfo');
  const content = document.getElementById('hallInfoContent');
  const closeBtn = document.getElementById('hallInfoClose');
  if (!buttons.length || !panel) return;

  let activeHall = null;

  function render(hallKey) {
    const h = HALLS[hallKey];
    if (!h) return;
    const nightPct = Math.round((NIGHT_MULTIPLIER - 1) * 100); // з rate — щоб не дублювати "50%" текстом окремо від логіки
    const priceHtml = h.rate != null
      ? `<p class="hall-info__price-amount">Оренда: ${h.rate} грн/год</p>
         <p class="hall-info__price-note">в нічний час +${nightPct}% до вартості</p>`
      : `<p class="hall-info__price-amount">Ціна уточнюється</p>`;

    content.innerHTML = `
      <div class="hall-info__row">
        <div class="hall-info__dim"><span>${h.dim.label}</span>${h.dim.value}</div>
        ${h.area ? `<div class="hall-info__dim"><span>${h.area.label}</span>${h.area.value}</div>` : ''}
      </div>
      <ul class="hall-info__features">
        ${h.features.map((f) => `<li>${f}</li>`).join('')}
      </ul>
      ${h.note ? `<p class="hall-info__note">${h.note}</p>` : ''}
      ${h.extra ? `<p class="hall-info__note">${h.extra}</p>` : ''}
      <div class="hall-info__price">${priceHtml}</div>
    `;
  }

  function openHall(hallKey, triggerBtn) {
    buttons.forEach((b) => b.setAttribute('aria-expanded', b === triggerBtn ? 'true' : 'false'));
    render(hallKey);
    panel.hidden = false;
    activeHall = hallKey;
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function closePanel() {
    buttons.forEach((b) => b.setAttribute('aria-expanded', 'false'));
    panel.hidden = true;
    activeHall = null;
  }

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const hallKey = btn.dataset.hall;
      if (activeHall === hallKey) { closePanel(); return; }
      openHall(hallKey, btn);
    });
  });

  closeBtn.addEventListener('click', closePanel);
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

  const DAYS_VISIBLE = 14;
  const HOURS = ['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00'];
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
    const h = parseInt(hour, 10);
    const isNight = h < 10 || h >= 20;
    return isNight ? Math.round(hall.rate * NIGHT_MULTIPLIER) : hall.rate;
  }

  function buildDateList() {
    const dates = [];
    for (let i = 0; i < DAYS_VISIBLE; i++) {
      const d = new Date(state.windowStart);
      d.setDate(d.getDate() + i);
      dates.push(d);
    }
    return dates;
  }

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

  gridPrev.addEventListener('click', () => { state.windowStart.setDate(state.windowStart.getDate() - DAYS_VISIBLE); loadAvailability(); });
  gridNext.addEventListener('click', () => { state.windowStart.setDate(state.windowStart.getDate() + DAYS_VISIBLE); loadAvailability(); });
  gridToday.addEventListener('click', () => { state.windowStart = startOfDay(new Date()); loadAvailability(); });

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
    HOURS.forEach((hour) => {
      const hh = parseInt(hour, 10);
      const endLabel = pad((hh + 1) % 24);
      tbody += `<tr><th class="hour-grid__hourlabel">${pad(hh)}-${endLabel}</th>`;
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
