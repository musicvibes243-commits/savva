// Адрес сервера каталога «Авто в наличии» (backend/).
// На своём компьютере (localhost) — локальный сервер для проверки.
window.AVTOVOZ_API = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? 'http://localhost:3000'
  : 'https://api.avtovoz312.ru';
