/* Картка опису залу — один рендер для головної (розгортається при наведенні)
   і для сторінок залів (показується поруч із фото). Дані — js/halls-data.js. */
function renderHallCard(hallKey, opts) {
  const h = (typeof HALLS !== 'undefined') && HALLS[hallKey];
  if (!h) return '';
  opts = opts || {};
  const evePct = Math.round((EVENING_MULTIPLIER - 1) * 100), nightPct = Math.round((NIGHT_MULTIPLIER - 1) * 100);
  const price = h.rate != null
    ? `<p class="hall-card__price-amount">Оренда: ${h.rate} грн/год</p><p class="hall-card__price-note">10:00–20:00 · 08–10 і 20–23: +${evePct}% · 23–08: +${nightPct}%</p>`
    : `<p class="hall-card__price-amount">Ціна уточнюється</p>`;
  const more = opts.link === false ? '' : `<span class="hall-card__more">Дивитись залу &rarr;</span>`;
  return `
    <div class="hall-card__head">
      <div class="hall-card__dim"><span>${h.dim.label}</span> ${h.dim.value}</div>
      ${h.area ? `<div class="hall-card__dim"><span>${h.area.label}</span> ${h.area.value}</div>` : ''}
    </div>
    <ul class="hall-card__features">${h.features.map((f) => `<li>${f}</li>`).join('')}</ul>
    ${h.note ? `<p class="hall-card__note">${h.note}</p>` : ''}
    ${h.extra ? `<p class="hall-card__note hall-card__note--strong">${h.extra}</p>` : ''}
    <div class="hall-card__price">${price}</div>
    ${more}`;
}
