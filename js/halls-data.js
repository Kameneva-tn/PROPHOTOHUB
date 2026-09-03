// Дані про зали — винесені окремо, щоб менеджерка/маркетолог
// могли міняти текст, не займаючись логікою в main.js
const HALLS = {
  tsyklorama: {
    title: 'Циклорама',
    dim: { value: '5×6', label: 'циклорама' },
    area: { value: '83 м²', label: 'зал' },
    features: ['Змінні фони', 'Денне світло', 'Дим-машина', 'Вітродуй', 'Велике дзеркало'],
    note: 'Постійне світло — включене у вартість',
    extra: 'Все для зйомки подкастів та контенту для соцмереж',
    rate: 1000, // грн/год, денний час (10:00–20:00)
    page: 'halls/cyclorama.html'
  },
  podcast: {
    title: 'Подкаст зала',
    dim: { value: '15 м²', label: 'зал' },
    area: null,
    features: ['Зона для подкастів', 'Шумопоглинання', 'Змінні фони'],
    note: 'Постійне світло — включене у вартість',
    extra: null,
    rate: 800, // грн/год, денний час (10:00–20:00)
    page: 'halls/content-studio.html'
  },
  grymerna: {
    title: 'Гримерна',
    dim: { value: '2 місця', label: 'кімната на' },
    area: null,
    features: ['Рівномірне мʼяке освітлення для комфортної роботи візажиста'],
    note: null,
    extra: '+ гримерний стіл в залі Циклорама',
    rate: 200, // грн/год, денний час (10:00–20:00)
    page: 'halls/makeup-room.html'
  }
};

// Тарифи за часом доби (блок "Режим роботи" на сторінці контактів):
//   денний час   10:00–20:00 — базова ставка rate
//   ранок/вечір  08:00–10:00 та 20:00–23:00 — rate × 1.5  (+50%)
//   нічний час   23:00–08:00 — rate × 2    (+100%)
const EVENING_MULTIPLIER = 1.5;
const NIGHT_MULTIPLIER = 2;

// Множник для години (0–23)
function rateMultiplier(hour) {
  const h = typeof hour === 'string' ? parseInt(hour, 10) : hour;
  if (h >= 10 && h < 20) return 1;
  if ((h >= 8 && h < 10) || (h >= 20 && h < 23)) return EVENING_MULTIPLIER;
  return NIGHT_MULTIPLIER;
}
