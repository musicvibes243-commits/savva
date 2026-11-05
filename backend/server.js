// Автовоз-312 — сервер каталога «Авто в наличии».
// Без зависимостей: только встроенные модули Node.js 20+.
//
// Хранит машины в DATA_DIR/cars.json, фото — в DATA_DIR/photos/.
// Читать список может кто угодно, менять — только после входа (логин/пароль из .env).
//
// Переменные окружения:
//   ADMIN_LOGIN, ADMIN_PASSWORD  — вход в кабинет (обязательно)
//   ALLOWED_ORIGINS              — откуда можно обращаться, через запятую
//                                  (по умолчанию https://avtovoz312.ru,https://www.avtovoz312.ru)
//   DATA_DIR                     — папка с данными (по умолчанию ./data)
//   PORT                         — порт (по умолчанию 3000)

'use strict';
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PHOTO_DIR = path.join(DATA_DIR, 'photos');
const CARS_FILE = path.join(DATA_DIR, 'cars.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const SITE_FILE = path.join(DATA_DIR, 'site.json');
const ADMIN_LOGIN = process.env.ADMIN_LOGIN || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://avtovoz312.ru,https://www.avtovoz312.ru')
  .split(',').map(s => s.trim()).filter(Boolean);

const MAX_BODY = 60 * 1024 * 1024;        // запрос с фото, до 60 МБ
const MAX_PHOTOS = 20;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;  // одно фото до 8 МБ
const SESSION_DAYS = 30;

if (!ADMIN_LOGIN || !ADMIN_PASSWORD) {
  console.error('Не заданы ADMIN_LOGIN и ADMIN_PASSWORD — см. backend/.env.example');
  process.exit(1);
}

fs.mkdirSync(PHOTO_DIR, { recursive: true });

// ---------- хранилище ----------
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
let cars = readJson(CARS_FILE, []);
let sessions = readJson(SESSIONS_FILE, {});

// ---------- настройки сайта: маршруты и цены, контакты, объявление ----------
const DEFAULT_SITE = {
  routes: [
    { id: 'r1', from: 'Бишкек', to: 'Москва', price: null, currency: 'USD', days: '', note: '', visible: true },
    { id: 'r2', from: 'Бишкек', to: 'Санкт‑Петербург', price: null, currency: 'USD', days: '', note: '', visible: true },
    { id: 'r3', from: 'Бишкек', to: 'Минск', price: null, currency: 'USD', days: '', note: '', visible: true },
    { id: 'r4', from: 'Бишкек', to: 'Ош → Манас', price: null, currency: 'USD', days: '', note: 'Перевозка по Кыргызстану', visible: true },
  ],
  contacts: {
    phone: '+996 777 777 737', whatsapp: '+996 777 777 737', email: 'damka-1984@mail.ru',
    telegram: '', instagram: '', extra: [],
  },
  announcement: { enabled: false, text: '' },
};
let site = { ...DEFAULT_SITE, ...readJson(SITE_FILE, {}) };

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const num = v => { const n = Number(String(v ?? '').replace(/[\s,]/g, '')); return String(v ?? '').trim() !== '' && Number.isFinite(n) && n >= 0 ? Math.round(n) : null; };

function cleanRoutes(list) {
  if (!Array.isArray(list)) throw httpError(400, 'Неверный список маршрутов');
  if (list.length > 50) throw httpError(400, 'Не больше 50 маршрутов');
  return list.map(r => {
    const route = {
      id: /^[a-z0-9]{1,24}$/.test(r.id) ? r.id : crypto.randomBytes(5).toString('hex'),
      from: str(r.from, 60), to: str(r.to, 80), price: num(r.price),
      currency: CURRENCIES.includes(r.currency) ? r.currency : 'USD',
      days: str(r.days, 30), note: str(r.note, 200), visible: r.visible !== false,
    };
    if (!route.from || !route.to) throw httpError(400, 'У каждого маршрута укажите «откуда» и «куда»');
    return route;
  });
}
function cleanContacts(c) {
  if (!c || typeof c !== 'object') throw httpError(400, 'Неверные контакты');
  const extra = Array.isArray(c.extra) ? c.extra.slice(0, 10).map(x => ({
    role: str(x.role, 60), name: str(x.name, 60), phone: str(x.phone, 30),
  })).filter(x => x.name || x.phone) : [];
  const out = {
    phone: str(c.phone, 30), whatsapp: str(c.whatsapp, 30), email: str(c.email, 80),
    telegram: str(c.telegram, 60).replace(/^@/, ''), instagram: str(c.instagram, 60).replace(/^@/, ''), extra,
  };
  if (!out.phone) throw httpError(400, 'Укажите основной телефон');
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw httpError(400, 'Проверьте почту');
  return out;
}
function cleanAnnouncement(a) {
  if (!a || typeof a !== 'object') throw httpError(400, 'Неверное объявление');
  return { enabled: !!a.enabled, text: str(a.text, 200) };
}

let writing = Promise.resolve();
function persist(file, data) {
  // запись по очереди и через временный файл — чтобы не получить битый JSON
  writing = writing.then(async () => {
    const tmp = file + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2));
    await fsp.rename(tmp, file);
  }).catch(e => console.error('Ошибка записи', file, e));
  return writing;
}

// ---------- поля машины ----------
const TEXT_FIELDS = {
  brand: 60, model: 80, engine: 60, fuel: 30, transmission: 30, drive: 30,
  country: 40, color: 40, location: 60, description: 3000,
};
const CURRENCIES = ['USD', 'RUB', 'KGS'];
const STATUSES = ['in_stock', 'reserved', 'sold', 'on_way'];

function cleanCar(input, prev = {}) {
  const car = { ...prev };
  for (const [k, max] of Object.entries(TEXT_FIELDS)) {
    if (k in input) car[k] = String(input[k] ?? '').trim().slice(0, max);
  }
  for (const k of ['year', 'price', 'mileage']) {
    if (k in input) {
      const n = Number(String(input[k] ?? '').replace(/[\s,]/g, ''));
      car[k] = Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
    }
  }
  if ('currency' in input) car.currency = CURRENCIES.includes(input.currency) ? input.currency : 'USD';
  if ('status' in input) car.status = STATUSES.includes(input.status) ? input.status : 'in_stock';
  car.currency ||= 'USD';
  car.status ||= 'in_stock';
  return car;
}

// ---------- фото ----------
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
async function savePhoto(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m) throw httpError(400, 'Фото должно быть картинкой JPG, PNG или WEBP');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > MAX_PHOTO_BYTES) throw httpError(400, 'Фото слишком большое (больше 8 МБ)');
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.${MIME_EXT[m[1]]}`;
  await fsp.writeFile(path.join(PHOTO_DIR, name), buf);
  return name;
}
const PHOTO_NAME = /^[a-z0-9]+-[a-f0-9]{12}\.(jpg|png|webp)$/;

// photos — список в нужном порядке: имя уже сохранённого фото или новое фото как data:-URL
async function applyPhotos(list, existing) {
  if (!Array.isArray(list)) return [];
  if (list.length > MAX_PHOTOS) throw httpError(400, `Не больше ${MAX_PHOTOS} фото`);
  const out = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    if (item.startsWith('data:')) out.push(await savePhoto(item));
    else if (existing.includes(item)) out.push(item);
  }
  return out;
}
async function removePhoto(name) {
  if (!PHOTO_NAME.test(name)) return;
  await fsp.rm(path.join(PHOTO_DIR, name), { force: true });
}

// ---------- вход ----------
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
const loginAttempts = new Map(); // ip -> { n, until }
function tooManyAttempts(ip) {
  const a = loginAttempts.get(ip);
  return a && a.n >= 10 && a.until > Date.now();
}
function noteFailedLogin(ip) {
  const a = loginAttempts.get(ip);
  if (!a || a.until < Date.now()) loginAttempts.set(ip, { n: 1, until: Date.now() + 15 * 60e3 });
  else a.n++;
}
function newSession() {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  for (const [t, exp] of Object.entries(sessions)) if (exp < now) delete sessions[t];
  sessions[token] = now + SESSION_DAYS * 864e5;
  persist(SESSIONS_FILE, sessions);
  return token;
}
function isAuthed(req) {
  const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '');
  return !!(m && sessions[m[1]] && sessions[m[1]] > Date.now());
}

// ---------- http ----------
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
}

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(httpError(413, 'Слишком большой запрос — уменьшите количество фото')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(httpError(400, 'Неверный формат запроса')); }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}

async function servePhoto(res, name) {
  if (!PHOTO_NAME.test(name)) throw httpError(404, 'Нет такого фото');
  const file = path.join(PHOTO_DIR, name);
  let st;
  try { st = await fsp.stat(file); } catch { throw httpError(404, 'Нет такого фото'); }
  const type = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[name.split('.').pop()];
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'public, max-age=31536000, immutable' });
  fs.createReadStream(file).pipe(res);
}

async function handle(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean);

  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, cars: cars.length });

  if (req.method === 'GET' && parts[0] === 'photos' && parts.length === 2) return servePhoto(res, parts[1]);

  if (parts[0] !== 'api') throw httpError(404, 'Не найдено');

  // POST /api/login
  if (req.method === 'POST' && parts[1] === 'login' && parts.length === 2) {
    const ip = clientIp(req);
    if (tooManyAttempts(ip)) throw httpError(429, 'Слишком много попыток. Подождите 15 минут.');
    const { login, password } = await readBody(req);
    if (!safeEqual(login || '', ADMIN_LOGIN) || !safeEqual(password || '', ADMIN_PASSWORD)) {
      noteFailedLogin(ip);
      throw httpError(401, 'Неверный логин или пароль');
    }
    loginAttempts.delete(ip);
    return send(res, 200, { token: newSession() });
  }

  // POST /api/logout
  if (req.method === 'POST' && parts[1] === 'logout' && parts.length === 2) {
    const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '');
    if (m && sessions[m[1]]) { delete sessions[m[1]]; persist(SESSIONS_FILE, sessions); }
    return send(res, 200, { ok: true });
  }

  // GET /api/site — маршруты, контакты, объявление (публично)
  if (req.method === 'GET' && parts[1] === 'site' && parts.length === 2) return send(res, 200, site);

  // PUT /api/site — изменить одну или несколько частей: { routes?, contacts?, announcement? }
  if (req.method === 'PUT' && parts[1] === 'site' && parts.length === 2) {
    if (!isAuthed(req)) throw httpError(401, 'Нужно войти в кабинет');
    const body = await readBody(req);
    const next = { ...site };
    if ('routes' in body) next.routes = cleanRoutes(body.routes);
    if ('contacts' in body) next.contacts = cleanContacts(body.contacts);
    if ('announcement' in body) next.announcement = cleanAnnouncement(body.announcement);
    site = next;
    await persist(SITE_FILE, site);
    return send(res, 200, site);
  }

  if (parts[1] !== 'cars') throw httpError(404, 'Не найдено');
  const id = parts[2];

  // GET /api/cars — публичный список, новые сверху
  if (req.method === 'GET' && !id) {
    const list = [...cars].sort((a, b) => b.createdAt - a.createdAt);
    return send(res, 200, { cars: list });
  }

  if (!isAuthed(req)) throw httpError(401, 'Нужно войти в кабинет');

  // POST /api/cars — добавить
  if (req.method === 'POST' && !id) {
    const body = await readBody(req);
    const car = cleanCar(body);
    if (!car.brand || !car.model) throw httpError(400, 'Укажите марку и модель');
    car.photos = await applyPhotos(body.photos, []);
    car.id = crypto.randomBytes(8).toString('hex');
    car.createdAt = car.updatedAt = Date.now();
    cars.push(car);
    await persist(CARS_FILE, cars);
    return send(res, 201, { car });
  }

  const idx = cars.findIndex(c => c.id === id);
  if (idx === -1) throw httpError(404, 'Машина не найдена');

  // PUT /api/cars/:id — изменить
  if (req.method === 'PUT') {
    const body = await readBody(req);
    const prev = cars[idx];
    const car = cleanCar(body, prev);
    if (!car.brand || !car.model) throw httpError(400, 'Укажите марку и модель');
    car.photos = 'photos' in body ? await applyPhotos(body.photos, prev.photos || []) : prev.photos;
    for (const p of prev.photos || []) if (!car.photos.includes(p)) await removePhoto(p);
    car.updatedAt = Date.now();
    cars[idx] = car;
    await persist(CARS_FILE, cars);
    return send(res, 200, { car });
  }

  // DELETE /api/cars/:id
  if (req.method === 'DELETE') {
    const [car] = cars.splice(idx, 1);
    for (const p of car.photos || []) await removePhoto(p);
    await persist(CARS_FILE, cars);
    return send(res, 200, { ok: true });
  }

  throw httpError(405, 'Метод не поддерживается');
}

http.createServer((req, res) => {
  handle(req, res).catch(err => {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Ошибка сервера' : err.message });
    else res.end();
  });
}).listen(PORT, () => console.log(`Автовоз-312 API: порт ${PORT}, данные в ${DATA_DIR}`));
