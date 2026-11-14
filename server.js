'use strict';
// SIMB-AD MVP: рекламная платформа для онлайн-аптек.
// Без внешних зависимостей. Все данные демонстрационные.
// Любая статистика считается из журнала событий (db.events): показ, клик, бронь, продажа.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// ---------- Константы модели ----------
const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
const IMPRESSION_CLICK_WINDOW = 30 * MIN;   // клик валиден, если сделан не позже 30 мин после показа
const ATTRIBUTION_WINDOW = DAY;             // бронь засчитывается рекламе, если создана ≤24 ч после клика
const IMPRESSION_DEDUP_WINDOW = 30 * MIN;   // повторный показ того же объявления без клика не считается
const PHARMACY_SHARE = 0.7;                 // 70% аптеке, 30% SIMB-AD
const RANK_WEIGHTS = { relevance: 0.5, bid: 0.3, discount: 0.2 };
const BID_CAP = 300;                        // CPC (₸), при котором Bid Score = 1
const DISCOUNT_CAP = 30;                    // скидка (%), при которой Discount Score = 1
const MIN_RELEVANCE = 0.5;                  // ниже — реклама в поиске не показывается
const TARGETS = { ctr: 0.06, cvr: 0.15, roas: 5, newBuyerRate: 0.6 };
const WEIGHTS = { ctr: 0.15, cvr: 0.30, roas: 0.40, newBuyerRate: 0.15 };
const SEARCH_ADS_LIMIT = 2;
const DISCOUNT_ADS_LIMIT = 4;

// ---------- Справочники (вымышленные аптеки, бренды; только безрецептурные товары) ----------
const PHARMACIES = [
  { id: 1, name: 'Аптека «Алатау Фарм»', address: 'Демо-адрес: Алматы, пр. Абая, 10' },
  { id: 2, name: 'Аптека «Дәру-Сервис»', address: 'Демо-адрес: Алматы, ул. Тимирязева, 25' },
  { id: 3, name: 'Аптека «Нұрлы Здоровье»', address: 'Демо-адрес: Астана, пр. Республики, 5' }
];
const PRODUCTS = [
  { id: 1, name: 'Витамин C 1000 мг', brand: 'VitaPlus', category: 'Витамины', icon: '🍊', description: 'БАД · 20 шипучих таблеток', price: 4200 },
  { id: 2, name: 'Витамин D3 2000 МЕ', brand: 'Sunny Life', category: 'Витамины', icon: '☀️', description: 'БАД · 60 капсул', price: 5400 },
  { id: 3, name: 'Магний B6', brand: 'BioBalance', category: 'Витамины', icon: '💜', description: 'БАД · 30 таблеток', price: 6700 },
  { id: 4, name: 'Омега-3 1000 мг', brand: 'OceanCare', category: 'Витамины', icon: '🐟', description: 'БАД · 60 капсул', price: 7900 },
  { id: 5, name: 'Мультивитамины для взрослых', brand: 'VitaPlus', category: 'Витамины', icon: '🌿', description: 'БАД · 60 таблеток', price: 9800 },
  { id: 6, name: 'Комплекс «Иммунитет»: цинк и витамин C', brand: 'BioBalance', category: 'Витамины', icon: '🛡️', description: 'БАД · 30 капсул', price: 5600 },
  { id: 7, name: 'Увлажняющий крем для лица', brand: 'DermaCare', category: 'Уход', icon: '🧴', description: 'Косметика · 50 мл', price: 5900 },
  { id: 8, name: 'Бальзам для губ', brand: 'SoftSkin', category: 'Уход', icon: '💧', description: 'Косметика · 10 мл', price: 1700 },
  { id: 9, name: 'Солнцезащитный крем SPF 50', brand: 'SunSafe', category: 'Уход', icon: '🌞', description: 'Косметика · 50 мл', price: 8300 },
  { id: 10, name: 'Крем для рук питательный', brand: 'DermaCare', category: 'Уход', icon: '🤲', description: 'Косметика · 75 мл', price: 2900 },
  { id: 11, name: 'Зубная паста Sensitive', brand: 'DentalPro', category: 'Гигиена', icon: '🪥', description: 'Гигиена · 75 мл', price: 2500 },
  { id: 12, name: 'Зубная щётка мягкая', brand: 'DentalPro', category: 'Гигиена', icon: '🦷', description: 'Гигиена · 1 шт.', price: 1500 },
  { id: 13, name: 'Ополаскиватель для рта', brand: 'FreshMint', category: 'Гигиена', icon: '🫧', description: 'Гигиена · 250 мл', price: 3200 },
  { id: 14, name: 'Гель для душа нейтральный', brand: 'SoftSkin', category: 'Гигиена', icon: '🚿', description: 'Гигиена · 300 мл', price: 2600 },
  { id: 15, name: 'Детский крем под подгузник', brand: 'BabyNest', category: 'Мама и малыш', icon: '🍼', description: 'Косметика · 100 мл', price: 3400 },
  { id: 16, name: 'Детский шампунь без слёз', brand: 'BabyNest', category: 'Мама и малыш', icon: '🧸', description: 'Косметика · 200 мл', price: 2800 },
  { id: 17, name: 'Набор пластырей', brand: 'SafeHome', category: 'Первая помощь', icon: '🩹', description: 'Изделие · 40 шт.', price: 1200 },
  { id: 18, name: 'Антисептик для рук', brand: 'SafeHome', category: 'Первая помощь', icon: '🧼', description: 'Гигиена · 100 мл', price: 1300 },
  { id: 19, name: 'Электронный термометр', brand: 'TempoCare', category: 'Первая помощь', icon: '🌡️', description: 'Изделие · 1 шт.', price: 4800 },
  { id: 20, name: 'Маски защитные', brand: 'SafeHome', category: 'Первая помощь', icon: '😷', description: 'Изделие · 50 шт.', price: 2200 }
];
const CATEGORIES = [...new Set(PRODUCTS.map(p => p.category))];
const productById = id => PRODUCTS.find(p => p.id === Number(id));
const pharmacyById = id => PHARMACIES.find(p => p.id === Number(id));

// ---------- Хранилище (JSON-файл, атомарная запись) ----------
let db;
let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(flush, 40);
}
function flush() {
  clearTimeout(saveTimer); saveTimer = null;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
function load() {
  try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { db = seedDb(); flush(); }
}
const nextId = key => ++db.seq[key];

function seedDb() {
  const now = Date.now();
  const d = { seq: { event: 0, campaign: 0, reservation: 0 }, inventory: {}, campaigns: [], events: [], reservations: [] };
  // Остатки и цены: у аптек разные цены, у части товаров нет остатка.
  PHARMACIES.forEach((ph, pi) => {
    d.inventory[ph.id] = {};
    PRODUCTS.forEach((p, i) => {
      const stock = ((i * 7 + pi * 5) % 9 === 0) ? 0 : 3 + ((i * 3 + pi * 4) % 14);
      const factor = [1, 1.05, 0.97][pi] + (((i + pi) % 3) - 1) * 0.02;
      d.inventory[ph.id][p.id] = { price: Math.round(p.price * factor / 10) * 10, stock };
    });
  });
  const mk = (productId, keywords, discountPct, cpc, budget, pharmacyIds, active, name) => ({
    id: ++d.seq.campaign, name, productId, keywords, discountPct, cpc, budget, spent: 0, pharmacyIds, active,
    createdAt: now - 7 * DAY, seed: true
  });
  d.campaigns.push(
    mk(1, ['витамин', 'витамины', 'витамин c', 'иммунитет'], 12, 150, 100000, [1, 2, 3], true, 'VitaPlus · Витамин C'),
    mk(7, ['крем', 'уход', 'кожа', 'увлажнение'], 20, 130, 80000, [1, 3], true, 'DermaCare · Крем для лица'),
    mk(11, ['паста', 'зубы', 'гигиена', 'десны'], 10, 110, 60000, [2, 3], true, 'DentalPro · Паста Sensitive'),
    mk(18, ['антисептик', 'руки', 'гигиена'], 15, 90, 40000, [1, 2], false, 'SafeHome · Антисептик (на паузе)')
  );
  // Историческая демо-статистика: детерминированный журнал событий за 6 дней (без Math.random).
  let rnd = 20240611;
  const rand = () => (rnd = (rnd * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const rates = { 1: { ctr: 0.07, cvr: 0.13 }, 7: { ctr: 0.055, cvr: 0.12 }, 11: { ctr: 0.045, cvr: 0.09 } };
  const push = e => { e.id = ++d.seq.event; d.events.push(e); return e; };
  let n = 0;
  for (let day = 6; day >= 1; day--) {
    d.campaigns.forEach(c => {
      const r = rates[c.productId]; if (!r) return;
      const imps = 90 + Math.floor(rand() * 60);
      for (let k = 0; k < imps; k++) {
        const ph = c.pharmacyIds[k % c.pharmacyIds.length];
        const ts = now - day * DAY + Math.floor(rand() * 0.9 * DAY);
        const imp = push({ type: 'impression', ts, campaignId: c.id, pharmacyId: ph, productId: c.productId, sessionId: 'seed-' + c.id + '-' + day + '-' + k, placement: 'search', query: c.keywords[0] });
        if (rand() >= r.ctr) continue;
        const click = push({ type: 'click', ts: ts + 5000, campaignId: c.id, pharmacyId: ph, productId: c.productId, sessionId: imp.sessionId, impressionId: imp.id, charged: c.cpc });
        imp.clickId = click.id; c.spent += c.cpc;
        if (rand() >= r.cvr) continue;
        n++;
        const inv = d.inventory[ph][c.productId];
        const price = Math.round(inv.price * (100 - c.discountPct) / 100);
        const isNew = rand() < 0.55;
        const customerKey = isNew ? 'seed-new-' + n : 'seed-old-' + (n % 5);
        push({ type: 'reservation', ts: ts + 60000, campaignId: c.id, pharmacyId: ph, productId: c.productId, clickId: click.id, qty: 1, value: price, reservationId: null });
        push({ type: 'sale', ts: ts + 120000, campaignId: c.id, pharmacyId: ph, adPharmacyId: ph, productId: c.productId, clickId: click.id, qty: 1, revenue: price, customerKey, isNewBuyer: isNew, reservationId: null });
      }
    });
  }
  return d;
}

// ---------- Текст, релевантность, Ad Rank ----------
const normalize = s => String(s || '').toLocaleLowerCase('ru').replace(/ё/g, 'е').trim();
const tokens = s => normalize(s).split(/[^a-zа-я0-9]+/).filter(Boolean);
function tokenMatch(a, b) {
  let l = 0; const m = Math.min(a.length, b.length);
  while (l < m && a[l] === b[l]) l++;
  return l >= Math.max(3, m - 1);
}
function tokenScore(qTokens, phrase) {
  if (!qTokens.length) return 0;
  const pt = tokens(phrase);
  const hit = qTokens.filter(q => pt.some(t => tokenMatch(q, t))).length;
  return hit / qTokens.length;
}
function relevance(query, c, p) {
  const q = tokens(query).filter(t => t.length >= 3);
  if (!q.length) return 0;
  const nq = normalize(query);
  let kw = 0;
  for (const k of c.keywords) kw = Math.max(kw, normalize(k) === nq ? 1 : tokenScore(q, k));
  const text = 0.8 * tokenScore(q, [p.name, p.brand, p.category].join(' '));
  return Math.max(kw, text);
}
const bidScore = c => Math.min(1, c.cpc / BID_CAP);
const discountScore = c => Math.min(1, c.discountPct / DISCOUNT_CAP);
const adRank = (r, b, d) => RANK_WEIGHTS.relevance * r + RANK_WEIGHTS.bid * b + RANK_WEIGHTS.discount * d;
const round = (x, n = 3) => Math.round(x * 10 ** n) / 10 ** n;

function campaignStatus(c) {
  if (!c.active) return 'paused';
  if (c.spent + c.cpc > c.budget) return 'exhausted';
  return 'active';
}
const stockAt = (ph, pid) => db.inventory[ph]?.[pid]?.stock || 0;
const priceAt = (ph, pid) => db.inventory[ph]?.[pid]?.price || 0;
const withDiscount = (price, pct) => Math.round(price * (100 - pct) / 100);

// ---------- Показы ----------
function pickPharmacy(c, key, now) {
  const eligible = c.pharmacyIds.filter(ph => stockAt(ph, c.productId) > 0);
  if (!eligible.length) return null;
  // Повторная выдача без клика: тот же показ (и та же аптека).
  const prev = findOpenImpression(key, now);
  if (prev && eligible.includes(prev.pharmacyId)) return { pharmacyId: prev.pharmacyId, prev };
  // Иначе — ротация: аптека с наименьшим числом показов этой кампании.
  const counts = Object.fromEntries(eligible.map(ph => [ph, 0]));
  for (const e of db.events) if (e.type === 'impression' && e.campaignId === c.id && counts[e.pharmacyId] !== undefined) counts[e.pharmacyId]++;
  eligible.sort((a, b) => counts[a] - counts[b] || priceAt(a, c.productId) - priceAt(b, c.productId));
  return { pharmacyId: eligible[0], prev: null };
}
function findOpenImpression(key, now) {
  for (let i = db.events.length - 1; i >= 0; i--) {
    const e = db.events[i];
    if (e.ts < now - IMPRESSION_DEDUP_WINDOW) break;   // журнал хронологический
    if (e.type === 'impression' && e.sessionId === key.sessionId && e.campaignId === key.campaignId &&
        e.placement === key.placement && e.query === key.query && !e.clickId) return e;
  }
  return null;
}
function serveAds({ query, sessionId }) {
  const now = Date.now();
  const q = normalize(query);
  const live = db.campaigns.filter(c => campaignStatus(c) === 'active' && productById(c.productId));
  const scored = live.map(c => {
    const p = productById(c.productId);
    const r = relevance(q, c, p), b = bidScore(c), d = discountScore(c);
    return { c, p, r, b, d, rank: adRank(r, b, d) };
  });
  const search = scored.filter(s => q && s.r >= MIN_RELEVANCE).sort((a, b) => b.rank - a.rank).slice(0, SEARCH_ADS_LIMIT);
  const used = new Set(search.map(s => s.c.id));
  const discount = scored.filter(s => s.c.discountPct > 0 && !used.has(s.c.id))
    .map(s => { const r = q ? s.r : 1; return { ...s, r, rank: adRank(r, s.b, s.d) }; })
    .sort((a, b) => b.rank - a.rank).slice(0, DISCOUNT_ADS_LIMIT);
  const build = (list, placement) => {
    const out = [];
    for (const s of list) {
      const key = { sessionId, campaignId: s.c.id, placement, query: placement === 'search' ? q : '' };
      const pick = pickPharmacy(s.c, key, now);
      if (!pick) continue;
      let imp = pick.prev;
      if (!imp && sessionId) {
        imp = { id: nextId('event'), type: 'impression', ts: now, campaignId: s.c.id, pharmacyId: pick.pharmacyId, productId: s.c.productId, sessionId, placement, query: key.query };
        db.events.push(imp); save();
      }
      const base = priceAt(pick.pharmacyId, s.c.productId);
      out.push({
        impressionId: imp ? imp.id : null, campaignId: s.c.id, placement, productId: s.c.productId, product: s.p,
        campaignPharmacyIds: s.c.pharmacyIds, pharmacy: pharmacyById(pick.pharmacyId), basePrice: base, price: withDiscount(base, s.c.discountPct), discountPct: s.c.discountPct,
        rank: { relevance: round(s.r), bid: round(s.b), discount: round(s.d), adRank: round(s.rank) }
      });
    }
    return out;
  };
  return { search: build(search, 'search'), discount: build(discount, 'discount'), disclosure: 'Реклама. Демонстрационные товары и кампании.' };
}

// ---------- Клики ----------
function registerClick({ impressionId, sessionId }) {
  const now = Date.now();
  const imp = db.events.find(e => e.id === Number(impressionId) && e.type === 'impression');
  if (!imp) throw httpErr(404, 'Показ не найден');
  if (imp.sessionId !== sessionId) throw httpErr(403, 'Показ принадлежит другой сессии');
  if (imp.clickId) return { clickId: imp.clickId, charged: 0, duplicate: true };   // повторный клик: не списываем
  const c = db.campaigns.find(x => x.id === imp.campaignId);
  if (now - imp.ts > IMPRESSION_CLICK_WINDOW) throw httpErr(409, 'Клик слишком поздно после показа: не засчитан');
  if (campaignStatus(c) !== 'active') throw httpErr(409, 'Кампания неактивна или бюджет исчерпан: клик не засчитан');
  const click = { id: nextId('event'), type: 'click', ts: now, campaignId: c.id, pharmacyId: imp.pharmacyId, productId: imp.productId, sessionId, impressionId: imp.id, charged: c.cpc };
  db.events.push(click);
  imp.clickId = click.id;
  c.spent += c.cpc;
  save();
  return { clickId: click.id, charged: c.cpc, duplicate: false };
}

// ---------- Корзина, брони, продажи ----------
function clickUsed(clickId, exceptReservationId) {
  if (db.events.some(e => e.type === 'sale' && e.clickId === clickId)) return true;
  return db.reservations.some(r => r.id !== exceptReservationId && r.status !== 'cancelled' && r.lines.some(l => l.clickId === clickId));
}
function quote(items, sessionId) {
  if (!Array.isArray(items) || !items.length || items.length > 30) throw httpErr(400, 'Корзина пуста');
  const now = Date.now(); const usedHere = new Set();
  return items.map(it => {
    const productId = Number(it.productId), pharmacyId = Number(it.pharmacyId), qty = Number(it.qty);
    const p = productById(productId), ph = pharmacyById(pharmacyId);
    if (!p || !ph) throw httpErr(400, 'Неизвестный товар или аптека');
    if (!Number.isInteger(qty) || qty < 1 || qty > 10) throw httpErr(400, 'Количество: от 1 до 10');
    const basePrice = priceAt(pharmacyId, productId);
    let unitPrice = basePrice, discountPct = 0, clickId = null, campaignId = null;
    const click = it.clickId ? db.events.find(e => e.id === Number(it.clickId) && e.type === 'click') : null;
    if (click && click.sessionId === sessionId && click.productId === productId && now - click.ts <= ATTRIBUTION_WINDOW &&
        !usedHere.has(click.id) && !clickUsed(click.id)) {
      const c = db.campaigns.find(x => x.id === click.campaignId);
      clickId = click.id; campaignId = c.id; usedHere.add(click.id);
      if (c.pharmacyIds.includes(pharmacyId)) { discountPct = c.discountPct; unitPrice = withDiscount(basePrice, discountPct); }
    }
    return { productId, pharmacyId, qty, basePrice, unitPrice, discountPct, total: unitPrice * qty, available: stockAt(pharmacyId, productId) >= qty, stock: stockAt(pharmacyId, productId), clickId, campaignId };
  });
}
function createReservations({ sessionId, customer, items }) {
  const name = String(customer?.name || '').trim(), phone = String(customer?.phone || '');
  const digits = phone.replace(/\D/g, '');
  if (name.length < 2 || name.length > 60) throw httpErr(400, 'Укажите имя (2–60 символов)');
  if (digits.length < 10 || digits.length > 15) throw httpErr(400, 'Укажите телефон (10–15 цифр)');
  const lines = quote(items, sessionId);
  const bad = lines.find(l => !l.available);
  if (bad) throw httpErr(409, `Недостаточно остатка: «${productById(bad.productId).name}» в «${pharmacyById(bad.pharmacyId).name}» (осталось ${bad.stock})`);
  const now = Date.now(); const out = [];
  for (const phId of [...new Set(lines.map(l => l.pharmacyId))]) {
    const ls = lines.filter(l => l.pharmacyId === phId);
    ls.forEach(l => { db.inventory[phId][l.productId].stock -= l.qty; });
    const r = { id: nextId('reservation'), createdAt: now, status: 'reserved', sessionId, pharmacyId: phId, customer: { name, phone: phone.slice(0, 30) }, customerKey: digits, lines: ls.map(l => ({ ...l, available: undefined, stock: undefined })), total: ls.reduce((s, l) => s + l.total, 0) };
    db.reservations.push(r);
    r.lines.forEach(l => {
      if (l.clickId) db.events.push({ id: nextId('event'), type: 'reservation', ts: now, campaignId: l.campaignId, pharmacyId: phId, productId: l.productId, clickId: l.clickId, qty: l.qty, value: l.total, reservationId: r.id });
    });
    out.push(r);
  }
  save();
  return out;
}
function confirmReservation(id) {
  const r = db.reservations.find(x => x.id === Number(id));
  if (!r) throw httpErr(404, 'Бронь не найдена');
  if (r.status === 'confirmed') return r;                      // идемпотентно: повторное подтверждение не создаёт продажи
  if (r.status !== 'reserved') throw httpErr(409, 'Бронь отменена');
  const now = Date.now();
  r.status = 'confirmed'; r.confirmedAt = now;
  r.lines.forEach(l => {
    const brand = productById(l.productId).brand;
    const isNewBuyer = !db.events.some(e => e.type === 'sale' && e.customerKey === r.customerKey && productById(e.productId)?.brand === brand);
    const click = l.clickId ? db.events.find(e => e.id === l.clickId) : null;
    db.events.push({ id: nextId('event'), type: 'sale', ts: now, campaignId: l.clickId ? l.campaignId : null, pharmacyId: r.pharmacyId, adPharmacyId: click ? click.pharmacyId : null, productId: l.productId, clickId: l.clickId || null, qty: l.qty, revenue: l.total, customerKey: r.customerKey, isNewBuyer, reservationId: r.id });
  });
  save();
  return r;
}
function cancelReservation(id) {
  const r = db.reservations.find(x => x.id === Number(id));
  if (!r) throw httpErr(404, 'Бронь не найдена');
  if (r.status === 'cancelled') return r;
  if (r.status !== 'reserved') throw httpErr(409, 'Продажа уже подтверждена');
  r.status = 'cancelled';
  r.lines.forEach(l => { db.inventory[r.pharmacyId][l.productId].stock += l.qty; });
  db.events.forEach(e => { if (e.type === 'reservation' && e.reservationId === r.id) e.cancelled = true; });
  save();
  return r;
}

// ---------- Аналитика (только из событий) ----------
function metricsOf(events) {
  const m = { impressions: 0, clicks: 0, spend: 0, reservations: 0, orders: 0, revenue: 0, newBuyers: 0 };
  for (const e of events) {
    if (e.type === 'impression') m.impressions++;
    else if (e.type === 'click') { m.clicks++; m.spend += e.charged; }
    else if (e.type === 'reservation' && !e.cancelled) m.reservations++;
    else if (e.type === 'sale' && e.campaignId) { m.orders++; m.revenue += e.revenue; if (e.isNewBuyer) m.newBuyers++; }
  }
  m.ctr = m.impressions ? m.clicks / m.impressions : 0;
  m.cvr = m.clicks ? m.orders / m.clicks : 0;
  m.roas = m.spend ? m.revenue / m.spend : 0;
  m.newBuyerRate = m.orders ? m.newBuyers / m.orders : 0;
  m.cpc = m.clicks ? m.spend / m.clicks : 0;
  m.cpa = m.orders ? m.spend / m.orders : 0;
  return m;
}
function scoreOf(m) {
  const labels = { ctr: 'CTR', cvr: 'CVR', roas: 'ROAS', newBuyerRate: 'Доля новых покупателей' };
  const parts = Object.keys(WEIGHTS).map(k => {
    const norm = Math.min(100, m[k] / TARGETS[k] * 100);
    return { key: k, label: labels[k], weight: WEIGHTS[k], actual: m[k], target: TARGETS[k], norm: round(norm, 1), contribution: round(WEIGHTS[k] * norm, 1) };
  });
  if (!m.impressions || !m.clicks) {
    return { sufficient: false, total: null, parts, message: 'Недостаточно данных: для расчёта нужен хотя бы 1 показ и 1 клик.' };
  }
  const notes = [];
  if (m.clicks < 20) notes.push('Предварительная оценка: меньше 20 кликов.');
  if (!m.orders) notes.push('Нет подтверждённых продаж: CVR, ROAS и доля новых покупателей равны 0.');
  return { sufficient: true, total: Math.round(parts.reduce((s, p) => s + p.contribution, 0)), parts, message: notes.join(' ') };
}
const dayKey = ts => { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function lastDays(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(Date.now() - i * DAY));
  return out;
}
function daily(events, days) {
  const idx = Object.fromEntries(days.map((d, i) => [d, i]));
  const rows = days.map(date => ({ date, impressions: 0, clicks: 0, spend: 0, orders: 0, revenue: 0, income: 0 }));
  for (const e of events) {
    const i = idx[dayKey(e.ts)]; if (i === undefined) continue;
    const r = rows[i];
    if (e.type === 'impression') r.impressions++;
    else if (e.type === 'click') { r.clicks++; r.spend += e.charged; r.income += e.charged * PHARMACY_SHARE; }
    else if (e.type === 'sale' && e.campaignId) { r.orders++; r.revenue += e.revenue; }
  }
  return rows;
}
const campaignView = c => {
  const m = metricsOf(db.events.filter(e => e.campaignId === c.id));
  return { ...c, status: campaignStatus(c), product: productById(c.productId), pharmacies: c.pharmacyIds.map(id => pharmacyById(id)), budgetLeft: Math.max(0, c.budget - c.spent), metrics: m, score: scoreOf(m) };
};
function advertiserAnalytics(campaignId) {
  const id = campaignId ? Number(campaignId) : null;
  if (id && !db.campaigns.some(c => c.id === id)) throw httpErr(404, 'Кампания не найдена');
  const ev = id ? db.events.filter(e => e.campaignId === id) : db.events.filter(e => e.campaignId);
  const summary = metricsOf(ev);
  return { scope: id ? 'campaign' : 'all', summary, score: scoreOf(summary), targets: TARGETS, weights: WEIGHTS, daily: daily(ev, lastDays(7)), campaigns: db.campaigns.map(campaignView) };
}
const money2 = x => Math.round(x * 100) / 100;
function pharmacyAnalytics(id) {
  const ph = pharmacyById(id);
  if (!ph) throw httpErr(404, 'Аптека не найдена');
  const own = db.events.filter(e => e.pharmacyId === ph.id);
  const imp = own.filter(e => e.type === 'impression'), clk = own.filter(e => e.type === 'click');
  const sales = own.filter(e => e.type === 'sale' && e.campaignId);
  const spend = clk.reduce((s, e) => s + e.charged, 0);
  const income = money2(spend * PHARMACY_SHARE);
  const dailyRows = daily(own, lastDays(7)).map(r => ({ ...r, income: money2(r.income) }));
  const campaigns = db.campaigns.map(c => {
    const ce = own.filter(e => e.campaignId === c.id);
    const cs = ce.filter(e => e.type === 'click').reduce((s, e) => s + e.charged, 0);
    return { id: c.id, name: c.name, impressions: ce.filter(e => e.type === 'impression').length, clicks: ce.filter(e => e.type === 'click').length, spend: cs, income: money2(cs * PHARMACY_SHARE), orders: ce.filter(e => e.type === 'sale').length, revenue: ce.filter(e => e.type === 'sale').reduce((s, e) => s + e.revenue, 0) };
  }).filter(r => r.impressions || r.clicks || r.orders);
  // Распределение всей рекламной выручки по аптекам: по фактически оплаченным кликам.
  const allClicks = db.events.filter(e => e.type === 'click');
  const totalSpend = allClicks.reduce((s, e) => s + e.charged, 0);
  const distribution = PHARMACIES.map(p => {
    const s = allClicks.filter(e => e.pharmacyId === p.id).reduce((a, e) => a + e.charged, 0);
    return { pharmacyId: p.id, name: p.name, paidClicks: allClicks.filter(e => e.pharmacyId === p.id).length, spend: s, income: money2(s * PHARMACY_SHARE) };
  });
  return {
    pharmacy: ph,
    summary: { impressions: imp.length, clicks: clk.length, orders: sales.length, adRevenue: sales.reduce((s, e) => s + e.revenue, 0), spend, income, simbShare: money2(spend - income), share: PHARMACY_SHARE },
    daily: dailyRows, campaigns, distribution,
    platform: { spend: totalSpend, pharmaciesIncome: money2(distribution.reduce((s, d) => s + d.income, 0)), simbIncome: money2(totalSpend - distribution.reduce((s, d) => s + d.income, 0)) }
  };
}

// ---------- Кампании ----------
function createCampaign(body) {
  const p = productById(body.productId);
  if (!p) throw httpErr(400, 'Выберите существующий товар');
  const cpc = Number(body.cpc), budget = Number(body.budget), discountPct = Number(body.discountPct || 0);
  if (!Number.isFinite(cpc) || cpc < 10 || cpc > 1000) throw httpErr(400, 'CPC: от 10 до 1000 ₸');
  if (!Number.isFinite(budget) || budget < 1000 || budget > 10000000) throw httpErr(400, 'Бюджет: от 1 000 до 10 000 000 ₸');
  if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 50) throw httpErr(400, 'Скидка: от 0 до 50%');
  if (budget < cpc) throw httpErr(400, 'Бюджет не может быть меньше цены клика');
  const pharmacyIds = [...new Set((Array.isArray(body.pharmacyIds) ? body.pharmacyIds : []).map(Number))].filter(pharmacyById);
  if (!pharmacyIds.length) throw httpErr(400, 'Выберите хотя бы одну аптеку');
  let keywords = (Array.isArray(body.keywords) ? body.keywords : String(body.keywords || '').split(',')).map(normalize).filter(Boolean).slice(0, 12);
  if (!keywords.length) keywords = tokens(p.name + ' ' + p.category).filter(t => t.length >= 3).slice(0, 6);
  const c = { id: nextId('campaign'), name: `${p.brand} · ${p.name}`.slice(0, 80), productId: p.id, keywords, discountPct, cpc, budget, spent: 0, pharmacyIds, active: true, createdAt: Date.now() };
  db.campaigns.push(c); save();
  return campaignView(c);
}

// ---------- HTTP ----------
function httpErr(status, message) { const e = new Error(message); e.status = status; return e; }
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 100000) { reject(httpErr(413, 'Слишком большой запрос')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(httpErr(400, 'Некорректный JSON')); } });
    req.on('error', reject);
  });
}
const validSession = s => typeof s === 'string' && /^[a-zA-Z0-9_-]{5,80}$/.test(s);
function productView(p, q) {
  const offers = PHARMACIES.map(ph => ({ pharmacyId: ph.id, price: priceAt(ph.id, p.id), stock: stockAt(ph.id, p.id) }));
  const inStock = offers.filter(o => o.stock > 0);
  return { ...p, minPrice: inStock.length ? Math.min(...inStock.map(o => o.price)) : null, pharmaciesInStock: inStock.length, offers };
}

const routes = [
  ['GET', /^\/api\/pharmacies$/, () => ({ pharmacies: PHARMACIES })],
  ['GET', /^\/api\/products$/, (req, res, url) => {
    const q = tokens(url.searchParams.get('q')).filter(t => t.length >= 2);
    const cat = normalize(url.searchParams.get('category'));
    const list = PRODUCTS.filter(p => (!cat || normalize(p.category) === cat) &&
      (!q.length || q.every(t => tokens([p.name, p.brand, p.category, p.description].join(' ')).some(w => tokenMatch(t, w)))));
    return { products: list.map(p => productView(p)), categories: CATEGORIES };
  }],
  ['GET', /^\/api\/products\/(\d+)$/, (req, res, url, m) => {
    const p = productById(m[1]); if (!p) throw httpErr(404, 'Товар не найден');
    return { product: productView(p), pharmacies: PHARMACIES };
  }],
  ['POST', /^\/api\/ads\/serve$/, (req, res, url, m, body) => {
    if (!validSession(body.sessionId)) throw httpErr(400, 'Некорректный sessionId');
    return serveAds({ query: body.query, sessionId: body.sessionId });
  }],
  ['POST', /^\/api\/ads\/click$/, (req, res, url, m, body) => {
    if (!validSession(body.sessionId)) throw httpErr(400, 'Некорректный sessionId');
    return registerClick(body);
  }],
  ['POST', /^\/api\/cart\/quote$/, (req, res, url, m, body) => {
    if (!validSession(body.sessionId)) throw httpErr(400, 'Некорректный sessionId');
    const lines = quote(body.items, body.sessionId);
    return { lines: lines.map(l => ({ ...l, product: productById(l.productId), pharmacy: pharmacyById(l.pharmacyId) })), total: lines.reduce((s, l) => s + l.total, 0) };
  }],
  ['POST', /^\/api\/reservations$/, (req, res, url, m, body) => {
    if (!validSession(body.sessionId)) throw httpErr(400, 'Некорректный sessionId');
    return { reservations: createReservations(body).map(reservationView) };
  }, 201],
  ['GET', /^\/api\/reservations$/, (req, res, url) => {
    const ph = url.searchParams.get('pharmacyId'), sid = url.searchParams.get('sessionId');
    let list = db.reservations;
    if (ph) list = list.filter(r => r.pharmacyId === Number(ph));
    if (sid) list = list.filter(r => r.sessionId === sid);
    return { reservations: list.slice(-50).reverse().map(reservationView) };
  }],
  ['POST', /^\/api\/reservations\/(\d+)\/confirm$/, (req, res, url, m) => ({ reservation: reservationView(confirmReservation(m[1])) })],
  ['POST', /^\/api\/reservations\/(\d+)\/cancel$/, (req, res, url, m) => ({ reservation: reservationView(cancelReservation(m[1])) })],
  ['GET', /^\/api\/campaigns$/, () => ({ campaigns: db.campaigns.map(campaignView), pharmacies: PHARMACIES, products: PRODUCTS })],
  ['POST', /^\/api\/campaigns$/, (req, res, url, m, body) => ({ campaign: createCampaign(body) }), 201],
  ['PATCH', /^\/api\/campaigns\/(\d+)$/, (req, res, url, m, body) => {
    const c = db.campaigns.find(x => x.id === Number(m[1])); if (!c) throw httpErr(404, 'Кампания не найдена');
    if (typeof body.active !== 'boolean') throw httpErr(400, 'Ожидается active: true|false');
    c.active = body.active; save();
    return { campaign: campaignView(c) };
  }],
  ['GET', /^\/api\/analytics\/advertiser$/, (req, res, url) => advertiserAnalytics(url.searchParams.get('campaignId'))],
  ['GET', /^\/api\/analytics\/pharmacy\/(\d+)$/, (req, res, url, m) => pharmacyAnalytics(m[1])],
  ['POST', /^\/api\/reset$/, () => { db = seedDb(); flush(); return { ok: true }; }]
];
function reservationView(r) {
  return { ...r, pharmacy: pharmacyById(r.pharmacyId), lines: r.lines.map(l => ({ ...l, product: productById(l.productId) })) };
}

const FILES = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const route = routes.find(r => r[0] === req.method && r[1].test(url.pathname));
      if (!route) return send(res, routes.some(r => r[1].test(url.pathname)) ? 405 : 404, { error: 'Не найдено' });
      const m = url.pathname.match(route[1]);
      const body = ['POST', 'PATCH'].includes(req.method) ? await parseBody(req) : {};
      return send(res, route[3] || 200, await route[2](req, res, url, m, body));
    }
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    const file = FILES[url.pathname];
    if (!file) { res.writeHead(404); return res.end('Not found'); }
    fs.readFile(path.join(__dirname, 'public', file), (err, data) => {
      if (err) { res.writeHead(500); return res.end('Server error'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)], 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  } catch (e) {
    send(res, e.status || 500, { error: e.status ? e.message : 'Внутренняя ошибка сервера' });
    if (!e.status) console.error(e);
  }
});

load();
['SIGINT', 'SIGTERM'].forEach(s => process.on(s, () => { if (saveTimer) flush(); process.exit(0); }));
server.listen(PORT, () => console.log(`SIMB-AD MVP: http://localhost:${PORT}`));
