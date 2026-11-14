'use strict';
// SIMB-AD MVP — фронтенд на чистом JS (без сборки и зависимостей).
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = n => Math.round(n).toLocaleString('ru-RU');
const money = n => num(n) + ' ₸';
const money2 = n => (Math.round(n * 100) / 100).toLocaleString('ru-RU') + ' ₸';
const pct = (n, d = 1) => (n * 100).toFixed(d).replace('.', ',') + '%';
const fmtTime = ts => new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ } }
};
const sessionId = (() => {
  let id = store.get('simb_session', null);
  if (!id) { id = 's' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); store.set('simb_session', id); }
  return id;
})();

const state = {
  page: 'store', query: '', category: '', catalog: [], products: [], categories: [], pharmacies: [],
  ads: { search: [], discount: [] }, cart: store.get('simb_cart', []), cartView: 'cart', doneReservations: [],
  customer: store.get('simb_customer', { name: 'Демо-покупатель', phone: '+7 777 000 00 00' }), advFilter: '', phId: 1, modal: null, last: {}
};

async function api(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  let data = {}; try { data = await r.json(); } catch { /* пустое тело */ }
  if (!r.ok) throw new Error(data.error || 'Ошибка сервера');
  return data;
}
const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body || {}) });
let toastTimer;
function toast(msg) { const el = $('toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3600); }
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };
const phName = id => (state.pharmacies.find(p => p.id === Number(id)) || {}).name || '';
const discounted = (price, d) => Math.round(price * (100 - d) / 100);

/* ====================== Онлайн-аптека ====================== */
function renderChips() {
  $('chips').innerHTML = ['', ...state.categories].map(c =>
    `<button class="chip ${state.category === c ? 'active' : ''}" data-cat="${esc(c)}">${c ? esc(c) : 'Все товары'}</button>`).join('');
}
function productCard(p) {
  const has = p.pharmaciesInStock > 0;
  return `<article class="product-card"><div class="product-image">${p.icon}</div><div class="product-info">
    <div class="product-brand">${esc(p.brand)}</div><div class="product-name">${esc(p.name)}</div><p class="description">${esc(p.description)}</p>
    <div class="price-row"><span class="price">${has ? 'от ' + money(p.minPrice) : '—'}</span></div>
    <div class="avail ${has ? '' : 'none'}">${has ? `В наличии в ${p.pharmaciesInStock} из ${state.pharmacies.length} аптек` : 'Нет в наличии'}</div>
    <button class="btn" ${has ? '' : 'disabled'} data-product="${p.id}">Выбрать аптеку</button></div></article>`;
}
function adCard(ad, i) {
  const p = ad.product;
  return `<article class="product-card is-ad"><div class="product-image">${p.icon}</div><div class="product-info">
    <span class="ad-label">Реклама</span>
    <div class="product-brand">${esc(p.brand)}</div><div class="product-name">${esc(p.name)}</div><p class="description">${esc(p.description)} · ${esc(ad.pharmacy.name)}</p>
    ${ad.discountPct ? `<span class="badge">−${ad.discountPct}% по акции</span>` : ''}
    <div class="price-row"><span class="price">${money(ad.price)}</span>${ad.discountPct ? `<span class="old-price">${money(ad.basePrice)}</span>` : ''}</div>
    <button class="btn primary" data-ad="${i}">Смотреть предложение</button></div></article>`;
}
function searchAdPanel(ad, i) {
  const p = ad.product;
  return `<article class="ad-panel" data-ad="${i}"><div class="ad-art">${p.icon}</div><div class="ad-text">
    <span class="ad-label">Реклама · спонсируемый товар</span><h3>${esc(p.name)}</h3>
    <p class="muted">${esc(p.brand)} · ${esc(p.description)} · ${esc(ad.pharmacy.name)} · в наличии</p>
    <div class="ad-price">${money(ad.price)}${ad.discountPct ? `<span class="old-price">${money(ad.basePrice)}</span><span class="badge">−${ad.discountPct}%</span>` : ''}</div></div>
    <button class="btn primary" data-ad="${i}">Смотреть</button></article>`;
}
const adList = () => [...state.ads.search, ...state.ads.discount];
function renderProducts() {
  const q = state.query.trim();
  $('resultHeading').textContent = q ? 'Результаты поиска' : 'Каталог товаров';
  $('resultsHint').textContent = q ? `По запросу «${q}»` : 'Выберите товар и аптеку: цены и наличие различаются.';
  $('resultCount').textContent = state.products.length + ' товаров';
  $('productsGrid').innerHTML = state.products.length ? state.products.map(productCard).join('') : '<div class="empty">Ничего не найдено. Попробуйте другое слово.</div>';
}
function renderAds() {
  $('searchAds').innerHTML = state.ads.search.map((a, i) => searchAdPanel(a, i)).join('');
  const off = state.ads.search.length;
  $('discountAds').innerHTML = state.ads.discount.length
    ? state.ads.discount.map((a, i) => adCard(a, off + i)).join('')
    : '<div class="empty">Сейчас нет рекламных скидок.</div>';
}
const refreshProducts = guard(async () => {
  const p = new URLSearchParams();
  if (state.query) p.set('q', state.query);
  if (state.category) p.set('category', state.category);
  const d = await api('/api/products?' + p);
  state.products = d.products; renderProducts();
});
let adToken = 0;
const refreshAds = guard(async () => {
  const n = ++adToken;
  const d = await post('/api/ads/serve', { query: state.query, sessionId });
  if (n !== adToken) return;
  state.ads = d; renderAds();
});
const loadCatalog = guard(async () => {
  const d = await api('/api/products');
  state.catalog = d.products; state.categories = d.categories; renderChips();
});

/* ---- карточка товара: выбор аптеки ---- */
const openAd = guard(async i => {
  const ad = adList()[i]; if (!ad) return;
  let clickId = null;
  if (ad.impressionId) {
    try { clickId = (await post('/api/ads/click', { impressionId: ad.impressionId, sessionId })).clickId; }
    catch (e) { toast(e.message); }
  }
  await openProduct(ad.productId, { clickId, ad });
});
async function openProduct(productId, ctx = {}) {
  const d = await api('/api/products/' + productId);
  const offers = d.product.offers;
  const inStock = offers.filter(o => o.stock > 0);
  if (!inStock.length) { toast('Товара нет в наличии ни в одной аптеке'); return; }
  const priceOf = o => ctx.clickId && ctx.ad && ctx.ad.campaignPharmacyIds.includes(o.pharmacyId) ? discounted(o.price, ctx.ad.discountPct) : o.price;
  let sel = ctx.ad && inStock.some(o => o.pharmacyId === ctx.ad.pharmacy.id) ? ctx.ad.pharmacy.id : inStock.sort((a, b) => priceOf(a) - priceOf(b))[0].pharmacyId;
  state.modal = { product: d.product, offers, ctx, sel, qty: 1, priceOf };
  renderProductModal();
  $('productModal').classList.remove('hidden');
}
function renderProductModal() {
  const m = state.modal; if (!m) return; const p = m.product;
  const adNote = m.ctx.clickId ? `<p class="muted" style="margin-top:8px"><span class="ad-label">Реклама</span> Скидка −${m.ctx.ad.discountPct}% действует в аптеках кампании и фиксируется при бронировании.</p>` : '';
  $('productModalBody').innerHTML = `<div class="modal-title"><div><div class="product-brand">${esc(p.brand)}</div><h2>${p.icon} ${esc(p.name)}</h2><p class="muted">${esc(p.description)}</p>${adNote}</div><button data-close class="close-btn" aria-label="Закрыть">×</button></div>
    <div class="card-title" style="margin:6px 0 0">Выберите аптеку</div>
    <div class="offers">${m.offers.map(o => {
      const ph = state.pharmacies.find(x => x.id === o.pharmacyId), price = m.priceOf(o), off = o.stock < 1;
      return `<label class="offer ${m.sel === o.pharmacyId ? 'sel' : ''} ${off ? 'off' : ''}" data-offer="${o.pharmacyId}"><input type="radio" name="ph" ${m.sel === o.pharmacyId ? 'checked' : ''} ${off ? 'disabled' : ''}>
        <span><b>${esc(ph.name)}</b><br><span class="muted">${esc(ph.address)} · ${off ? 'нет в наличии' : 'осталось ' + o.stock + ' шт.'}</span></span>
        <span class="offer-price">${money(price)}${price !== o.price ? `<br><span class="old-price">${money(o.price)}</span>` : ''}</span></label>`;
    }).join('')}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div class="qty"><button data-qty="-1">−</button><span>${m.qty}</span><button data-qty="1">+</button></div>
      <button class="btn primary" data-addcart>В корзину · ${money(m.priceOf(m.offers.find(o => o.pharmacyId === m.sel)) * m.qty)}</button></div>`;
}
function addToCart() {
  const m = state.modal; const o = m.offers.find(x => x.pharmacyId === m.sel);
  const qty = Math.min(m.qty, o.stock);
  const ex = state.cart.find(l => l.productId === m.product.id && l.pharmacyId === m.sel);
  if (ex) { ex.qty = Math.min(10, ex.qty + qty); if (!ex.clickId && m.ctx.clickId) ex.clickId = m.ctx.clickId; }
  else state.cart.push({ productId: m.product.id, pharmacyId: m.sel, qty, clickId: m.ctx.clickId || null });
  saveCart(); closeModals(); toast('Добавлено в корзину'); openCart();
}

/* ---- корзина и бронирование ---- */
function saveCart() { store.set('simb_cart', state.cart); $('cartCount').textContent = state.cart.reduce((s, l) => s + l.qty, 0); }
function openCart() { state.cartView = state.cart.length || !state.doneReservations.length ? 'cart' : 'done'; $('cartDrawer').classList.remove('hidden'); renderCart(); }
const renderCart = guard(async () => {
  const box = $('cartBody');
  const head = t => `<div class="modal-title"><h2>${t}</h2><button data-close class="close-btn" aria-label="Закрыть">×</button></div>`;
  if (state.cartView === 'done') return renderDone(head);
  if (!state.cart.length) {
    box.innerHTML = head('Корзина') + '<div class="empty">Корзина пуста. Выберите товар в каталоге.</div>' +
      (state.doneReservations.length ? '<button class="btn full" style="margin-top:12px" data-view="done">Мои брони</button>' : '');
    return;
  }
  const q = await post('/api/cart/quote', { sessionId, items: state.cart });
  box.innerHTML = head('Корзина') + q.lines.map((l, i) => {
    const stockPh = (state.catalog.find(p => p.id === l.productId)?.offers || []).filter(o => o.stock > 0);
    return `<div class="cart-line"><div class="ico">${l.product.icon}</div><div><b>${esc(l.product.name)}</b>
      <div class="muted">${l.discountPct ? `<span class="badge">по рекламе −${l.discountPct}%</span> ` : ''}${money(l.unitPrice)} × ${l.qty}</div>
      <select data-cartph="${i}" aria-label="Аптека">${stockPh.map(o => `<option value="${o.pharmacyId}" ${o.pharmacyId === l.pharmacyId ? 'selected' : ''}>${esc(phName(o.pharmacyId))} — ${money(o.price)}</option>`).join('')}</select>
      ${l.available ? '' : `<div class="muted" style="color:var(--red)">В наличии только ${l.stock} шт.</div>`}</div>
      <div style="text-align:right"><div class="qty"><button data-cartqty="${i}:-1">−</button><span>${l.qty}</span><button data-cartqty="${i}:1">+</button></div>
      <div style="font-weight:800;margin-top:6px">${money(l.total)}</div><button class="link-btn" data-cartrm="${i}">Убрать</button></div></div>`;
  }).join('') + `<div class="cart-total"><span>Итого</span><span>${money(q.total)}</span></div>
    <form id="checkoutForm"><label>Имя<input id="coName" required minlength="2" maxlength="60" value="${esc(state.customer.name)}" placeholder="Демо-покупатель"></label>
    <label>Телефон<input id="coPhone" required value="${esc(state.customer.phone)}" placeholder="+7 777 000 00 00" inputmode="tel"></label>
    <button class="btn primary full" type="submit">Забронировать (демо)</button>
    <p class="muted">Оплаты нет: это демонстрационное бронирование. Товар резервируется в выбранной аптеке.</p></form>`;
});
function renderDone(head) {
  const rs = state.doneReservations;
  $('cartBody').innerHTML = head('Ваши брони') + (rs.length ? rs.map(r => `<div class="res-card">
    <div style="display:flex;justify-content:space-between;gap:8px"><b>Бронь №${r.id}</b><span class="status ${r.status}">${statusRu(r.status)}</span></div>
    <div class="muted">${esc(r.pharmacy.name)}</div>
    ${r.lines.map(l => `<div style="margin-top:6px">${l.product.icon} ${esc(l.product.name)} × ${l.qty} — ${money(l.total)}${l.clickId ? ' <span class="ad-label">по рекламе</span>' : ''}</div>`).join('')}
    <div style="font-weight:800;margin-top:8px">${money(r.total)}</div>
    ${r.status === 'reserved' ? `<div class="res-actions"><button class="btn success small" data-confirm="${r.id}">Подтвердить демо-продажу</button><button class="btn small" data-cancel="${r.id}">Отменить</button></div>
    <p class="muted" style="margin-top:8px">В реальности продажу подтверждает аптека при выдаче. То же можно сделать в «Кабинете аптеки».</p>` : ''}
    ${r.status === 'confirmed' ? '<p class="muted" style="margin-top:8px">✓ Продажа подтверждена и учтена в аналитике.</p>' : ''}</div>`).join('') : '<div class="empty">Броней пока нет.</div>') +
    (state.cart.length ? '<button class="btn full" data-view="cart">Вернуться в корзину</button>' : '');
}
const statusRu = s => ({ reserved: 'Забронировано', confirmed: 'Продано', cancelled: 'Отменено', active: 'Активна', paused: 'Пауза', exhausted: 'Бюджет исчерпан' }[s] || s);
const checkout = guard(async () => {
  const name = $('coName').value.trim(), phone = $('coPhone').value.trim();
  state.customer = { name, phone }; store.set('simb_customer', state.customer);
  const d = await post('/api/reservations', { sessionId, customer: state.customer, items: state.cart });
  state.doneReservations = [...d.reservations, ...state.doneReservations.filter(r => r.status === 'reserved')];
  state.cart = []; saveCart(); state.cartView = 'done'; renderCart();
  toast('Бронь оформлена. Подтвердите демо-продажу.');
  loadCatalog(); refreshProducts(); refreshAds();
});
const reservationAction = guard(async (id, action) => {
  const d = await post(`/api/reservations/${id}/${action}`);
  state.doneReservations = state.doneReservations.map(r => r.id === d.reservation.id ? d.reservation : r);
  renderCart(); loadCatalog(); refreshProducts();
  toast(action === 'confirm' ? '✓ Демо-продажа подтверждена. Проверьте кабинеты.' : 'Бронь отменена');
});

/* ====================== Графики (SVG) ====================== */
function niceMax(v) { if (v <= 1) return 1; const p = 10 ** Math.floor(Math.log10(v)), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
const compact = v => v >= 1e6 ? (v / 1e6).toFixed(1).replace('.0', '') + 'M' : v >= 1e4 ? Math.round(v / 1e3) + 'к' : v >= 1e3 ? (v / 1e3).toFixed(1).replace('.0', '') + 'к' : String(Math.round(v * 10) / 10);
function chart(el, labels, series) {
  const W = 640, H = 240, L = 44, hasR = series.some(s => s.axis === 'r'), R = hasR ? 44 : 12, T = 12, B = 28;
  const iw = W - L - R, ih = H - T - B, n = labels.length, band = iw / n;
  const mx = { l: 1, r: 1 };
  series.forEach(s => { const a = s.axis || 'l'; mx[a] = Math.max(mx[a], ...s.values); });
  const ml = niceMax(mx.l), mr = niceMax(mx.r);
  const y = (v, a) => T + ih - v / (a === 'r' ? mr : ml) * ih;
  const empty = series.every(s => s.values.every(v => !v));
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const yy = T + ih * i / 4;
    g += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="#e5eaf2"/><text x="${L - 6}" y="${yy + 4}" text-anchor="end">${compact(ml * (1 - i / 4))}</text>`;
    if (hasR) g += `<text x="${W - R + 6}" y="${yy + 4}">${compact(mr * (1 - i / 4))}</text>`;
  }
  labels.forEach((d, i) => { const [, mo, da] = d.split('-'); g += `<text x="${L + band * i + band / 2}" y="${H - 8}" text-anchor="middle">${da}.${mo}</text>`; });
  const bars = series.filter(s => s.type === 'bar'), bw = Math.min(26, band * 0.62 / Math.max(1, bars.length));
  bars.forEach((s, k) => s.values.forEach((v, i) => {
    const x = L + band * i + band / 2 - bars.length * bw / 2 + k * bw, yy = y(v, s.axis);
    g += `<rect x="${x}" y="${yy}" width="${bw - 2}" height="${Math.max(0, T + ih - yy)}" rx="3" fill="${s.color}" opacity=".85"><title>${s.name}: ${s.fmt(v)}</title></rect>`;
  }));
  series.filter(s => s.type === 'line').forEach(s => {
    const pts = s.values.map((v, i) => [L + band * i + band / 2, y(v, s.axis)]);
    g += `<polyline fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" points="${pts.map(p => p.join(',')).join(' ')}"/>` +
      pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="#fff" stroke="${s.color}" stroke-width="2"><title>${s.name}: ${s.fmt(s.values[i])}</title></circle>`).join('');
  });
  if (empty) g += `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" style="font-size:14px">Пока нет данных за период</text>`;
  const legend = `<div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${s.name}${s.axis === 'r' ? ' (правая шкала)' : ''}</span>`).join('')}</div>`;
  el.innerHTML = `${legend}<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img">${g}</svg></div>`;
}

/* ====================== Кабинет рекламодателя ====================== */
const kpi = (label, value, note, cls = '') => `<div class="kpi ${cls}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-note">${note}</div></div>`;
function renderAdvertiser(d) {
  const s = d.summary;
  $('advFilter').innerHTML = '<option value="">Все кампании</option>' + d.campaigns.map(c => `<option value="${c.id}" ${String(c.id) === String(state.advFilter) ? 'selected' : ''}>#${c.id} ${esc(c.name)}</option>`).join('');
  $('advKpis').innerHTML = [
    kpi('Показы', num(s.impressions), 'Показы рекламы'),
    kpi('Клики', num(s.clicks), 'CTR ' + pct(s.ctr, 2)),
    kpi('Расходы', money(s.spend), 'Только валидные клики · CPC ' + money(s.cpc)),
    kpi('Брони', num(s.reservations), 'Не входят в выручку и ROAS'),
    kpi('Подтверждённые продажи', num(s.orders), 'CVR ' + pct(s.cvr, 1)),
    kpi('Выручка', money(s.revenue), 'По подтверждённым продажам', 'accent-g'),
    kpi('ROAS', s.roas.toFixed(2).replace('.', ',') + '×', 'Выручка / расходы', 'accent-b'),
    kpi('Новые покупатели', num(s.newBuyers), 'Доля ' + pct(s.newBuyerRate, 0))
  ].join('');
  renderScore(d);
  const days = d.daily.map(r => r.date);
  chart($('chartImp'), days, [
    { name: 'Показы', type: 'bar', color: '#93b4f5', values: d.daily.map(r => r.impressions), fmt: v => num(v) },
    { name: 'Клики', type: 'line', axis: 'r', color: '#16a34a', values: d.daily.map(r => r.clicks), fmt: v => num(v) }]);
  chart($('chartMoney'), days, [
    { name: 'Расходы', type: 'bar', color: '#93b4f5', values: d.daily.map(r => r.spend), fmt: money },
    { name: 'Выручка', type: 'line', color: '#16a34a', values: d.daily.map(r => r.revenue), fmt: money }]);
  $('campaignTable').innerHTML = `<table><thead><tr><th>Кампания</th><th>Статус</th><th>Бюджет</th><th class="num">Показы</th><th class="num">Клики</th><th class="num">CTR</th><th class="num">Расход</th><th class="num">Продажи</th><th class="num">CVR</th><th class="num">Выручка</th><th class="num">ROAS</th><th class="num">Score</th><th>Вкл.</th></tr></thead><tbody>` +
    d.campaigns.map(c => { const m = c.metrics;
      return `<tr><td><button class="link-btn" style="color:var(--ink);text-decoration:none;text-align:left;font-size:14px" data-filter="${c.id}"><span class="cell-name">#${c.id} ${esc(c.name)}</span></button><div class="cell-sub">−${c.discountPct}% · CPC ${money(c.cpc)} · ${c.pharmacies.map(p => esc(p.name.replace('Аптека ', ''))).join(', ')}</div><div class="cell-sub">Слова: ${esc(c.keywords.join(', '))}</div></td>
      <td><span class="status ${c.status}">${statusRu(c.status)}</span></td>
      <td style="min-width:130px"><div class="cell-sub">${money(c.spent)} из ${money(c.budget)}</div><div class="progress"><div style="width:${Math.min(100, c.spent / c.budget * 100)}%"></div></div></td>
      <td class="num">${num(m.impressions)}</td><td class="num">${num(m.clicks)}</td><td class="num">${pct(m.ctr)}</td><td class="num">${money(m.spend)}</td><td class="num">${num(m.orders)}</td><td class="num">${pct(m.cvr)}</td><td class="num">${money(m.revenue)}</td><td class="num">${m.roas.toFixed(2).replace('.', ',')}×</td>
      <td class="num">${c.score.sufficient ? `<span class="score-pill">${c.score.total}</span>` : '<span class="score-pill na">нет данных</span>'}</td>
      <td><button class="toggle ${c.active ? 'on' : ''}" data-toggle="${c.id}" aria-label="Включить или выключить" title="${c.active ? 'Выключить' : 'Включить'}"></button></td></tr>`; }).join('') + '</tbody></table>';
}
function renderScore(d) {
  const sc = d.score, C = 2 * Math.PI * 80;
  const color = !sc.sufficient ? '#cbd5e1' : sc.total >= 70 ? '#16a34a' : sc.total >= 40 ? '#2563eb' : '#f59e0b';
  const fv = (k, v) => k === 'roas' ? v.toFixed(2).replace('.', ',') + '×' : pct(v, k === 'newBuyerRate' ? 0 : 1);
  const scope = d.scope === 'campaign' ? 'выбранной кампании' : 'всех кампаний';
  $('scoreCard').innerHTML = `<div class="ring"><svg width="190" height="190" viewBox="0 0 190 190"><circle cx="95" cy="95" r="80" fill="none" stroke="#eef2f8" stroke-width="16"/><circle cx="95" cy="95" r="80" fill="none" stroke="${color}" stroke-width="16" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - (sc.sufficient ? sc.total : 0) / 100)}"/></svg>
    <div class="ring-val"><b>${sc.sufficient ? sc.total : '—'}</b><span>из 100</span></div></div>
    <div><div class="score-title">SIMB Effectiveness Score</div><p class="muted">Единая оценка эффективности рекламы ${scope}.</p>
    ${sc.sufficient ? `<div class="score-rows">${sc.parts.map(p => `<div class="score-row"><div class="lbl"><b>${p.label}</b><small>вес ${Math.round(p.weight * 100)}%</small></div>
      <div><div class="bar"><div style="width:${p.norm}%"></div></div><small class="muted">факт ${fv(p.key, p.actual)} · цель ${fv(p.key, p.target)} · N = ${p.norm.toFixed(0)}/100</small></div>
      <div class="val"><b>+${p.contribution.toFixed(1)}</b><br><small class="muted">баллов</small></div></div>`).join('')}</div>` : ''}
    ${sc.message ? `<div class="notice">${esc(sc.message)}</div>` : ''}
    <div class="formula">Score = 0,15·N(CTR) + 0,30·N(CVR) + 0,40·N(ROAS) + 0,15·N(New Buyer Rate), где N(X) = min(100, факт / цель × 100). Демо-цели: CTR 6%, CVR 15%, ROAS 5, новые покупатели 60%. Это гипотеза MVP, а не отраслевой бенчмарк.</div></div>`;
}
const loadAdvertiser = guard(async (silent) => {
  const d = await api('/api/analytics/advertiser' + (state.advFilter ? '?campaignId=' + state.advFilter : ''));
  const js = JSON.stringify(d); if (silent && state.last.adv === js) return; state.last.adv = js;
  renderAdvertiser(d);
});
const toggleCampaign = guard(async id => {
  const cur = document.querySelector(`[data-toggle="${id}"]`).classList.contains('on');
  await api('/api/campaigns/' + id, { method: 'PATCH', body: JSON.stringify({ active: !cur }) });
  toast(cur ? 'Кампания выключена' : 'Кампания включена'); loadAdvertiser();
});
const openCampaignModal = guard(async () => {
  if (!state.catalog.length) await loadCatalog();
  $('cfProduct').innerHTML = state.catalog.map(p => `<option value="${p.id}">${esc(p.brand)} — ${esc(p.name)}</option>`).join('');
  $('cfPharmacies').innerHTML = state.pharmacies.map(p => `<label><input type="checkbox" value="${p.id}" checked> ${esc(p.name)}</label>`).join('');
  updateCfHint(); $('campaignModal').classList.remove('hidden');
});
function updateCfHint() {
  const b = Number($('cfBudget').value), c = Number($('cfCpc').value);
  $('cfHint').textContent = b > 0 && c > 0 ? `Хватит примерно на ${num(Math.floor(b / c))} кликов. Списание происходит только за валидный клик, не за показ.` : '';
}
const createCampaign = guard(async () => {
  const body = { productId: Number($('cfProduct').value), keywords: $('cfKeywords').value, budget: Number($('cfBudget').value), cpc: Number($('cfCpc').value), discountPct: Number($('cfDiscount').value),
    pharmacyIds: [...document.querySelectorAll('#cfPharmacies input:checked')].map(i => Number(i.value)) };
  const d = await post('/api/campaigns', body);
  closeModals(); $('campaignForm').reset(); state.advFilter = String(d.campaign.id);
  toast('✓ Кампания создана. Найдите товар в «Онлайн-аптеке».'); loadAdvertiser();
});

/* ====================== Кабинет аптеки ====================== */
function renderPharmacy(d, res) {
  const s = d.summary, spendShown = s.spend, pa = Math.round(s.share * 100);
  $('phChips').className = 'chips green-chips';
  $('phChips').innerHTML = state.pharmacies.map(p => `<button class="chip ${p.id === state.phId ? 'active' : ''}" data-ph="${p.id}">${esc(p.name.replace('Аптека ', ''))}</button>`).join('');
  $('phKpis').innerHTML = [
    kpi('Рекламные показы', num(s.impressions), 'В этой аптеке'),
    kpi('Оплаченные клики', num(s.clicks), 'Валидные клики по рекламе'),
    kpi('Заказы с рекламы', num(s.orders), 'Подтверждённые продажи'),
    kpi('Рекламная выручка', money(s.adRevenue), 'Продажи по рекламе в аптеке'),
    kpi('Рекламный доход аптеки', money2(s.income), pa + '% от оплаченных кликов', 'accent-g')
  ].join('');
  $('splitCard').innerHTML = `<div class="card-title">Распределение рекламных расходов этой аптеки</div>
    <div class="split-bar"><div class="a" style="width:${pa}%"></div><div class="b" style="width:${100 - pa}%"></div></div>
    <div class="split-legend"><div class="g"><b>${money2(s.income)}</b><span>${pa}% — аптеке</span></div><div class="bl"><b>${money2(s.simbShare)}</b><span>${100 - pa}% — SIMB-AD</span></div></div>
    <p class="muted" style="margin-top:12px">Всего оплаченных кликов на ${money(spendShown)}. Деньги распределяются по фактически оплаченным кликам каждой аптеки. По платформе: списано ${money(d.platform.spend)}, аптекам ${money2(d.platform.pharmaciesIncome)}, SIMB-AD ${money2(d.platform.simbIncome)}.</p>`;
  chart($('chartIncome'), d.daily.map(r => r.date), [
    { name: 'Доход аптеки', type: 'bar', color: '#16a34a', values: d.daily.map(r => r.income), fmt: money2 },
    { name: 'Клики', type: 'line', axis: 'r', color: '#2563eb', values: d.daily.map(r => r.clicks), fmt: num }]);
  $('phCampaigns').innerHTML = d.campaigns.length ? `<table><thead><tr><th>Кампания</th><th class="num">Показы</th><th class="num">Клики</th><th class="num">Продажи</th><th class="num">Выручка</th><th class="num">Доход</th></tr></thead><tbody>${d.campaigns.map(c => `<tr><td class="cell-name">#${c.id} ${esc(c.name)}</td><td class="num">${num(c.impressions)}</td><td class="num">${num(c.clicks)}</td><td class="num">${num(c.orders)}</td><td class="num">${money(c.revenue)}</td><td class="num">${money2(c.income)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty" style="margin:16px">Пока нет рекламы в этой аптеке.</div>';
  $('phDistribution').innerHTML = `<table><thead><tr><th>Аптека</th><th class="num">Оплач. клики</th><th class="num">Списано</th><th class="num">Доход ${pa}%</th></tr></thead><tbody>${d.distribution.map(r => `<tr ${r.pharmacyId === d.pharmacy.id ? 'style="background:var(--green-soft)"' : ''}><td class="cell-name">${esc(r.name)}</td><td class="num">${num(r.paidClicks)}</td><td class="num">${money(r.spend)}</td><td class="num">${money2(r.income)}</td></tr>`).join('')}</tbody></table>`;
  $('phReservations').innerHTML = res.length ? `<table><thead><tr><th>№</th><th>Время</th><th>Покупатель</th><th>Товары</th><th class="num">Сумма</th><th>Статус</th><th></th></tr></thead><tbody>${res.map(r => `<tr><td class="cell-name">${r.id}</td><td>${fmtTime(r.createdAt)}</td><td>${esc(r.customer.name)}<div class="cell-sub">${esc(r.customer.phone)}</div></td>
    <td>${r.lines.map(l => `${l.product.icon} ${esc(l.product.name)} × ${l.qty}${l.clickId ? ' <span class="ad-label">по рекламе</span>' : ''}`).join('<br>')}</td><td class="num">${money(r.total)}</td><td><span class="status ${r.status}">${statusRu(r.status)}</span></td>
    <td>${r.status === 'reserved' ? `<button class="btn success small" data-confirm="${r.id}">Подтвердить продажу</button> <button class="btn small" data-cancel="${r.id}">Отменить</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="empty" style="margin:16px">Броней в этой аптеке пока нет.</div>';
}
const loadPharmacy = guard(async (silent) => {
  const [d, r] = await Promise.all([api('/api/analytics/pharmacy/' + state.phId), api('/api/reservations?pharmacyId=' + state.phId)]);
  const js = JSON.stringify([d, r]); if (silent && state.last.ph === js) return; state.last.ph = js;
  renderPharmacy(d, r.reservations);
});
const pharmacyReservationAction = guard(async (id, action) => {
  const d = await post(`/api/reservations/${id}/${action}`);
  state.doneReservations = state.doneReservations.map(r => r.id === d.reservation.id ? d.reservation : r);
  toast(action === 'confirm' ? '✓ Продажа подтверждена, доход аптеки и показатели рекламодателя обновлены' : 'Бронь отменена');
  loadPharmacy(); loadCatalog();
});

/* ====================== Навигация и события ====================== */
function showPage(name) {
  state.page = name;
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + name));
  document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.page === name));
  state.last = {};
  if (name === 'advertiser') loadAdvertiser();
  if (name === 'pharmacy') loadPharmacy();
  window.scrollTo({ top: 0 });
}
function closeModals() { ['productModal', 'cartDrawer', 'campaignModal'].forEach(id => $(id).classList.add('hidden')); state.modal = null; }

document.addEventListener('click', e => {
  const t = e.target;
  const q = sel => t.closest(sel);
  if (q('[data-close]')) return closeModals();
  let el;
  if ((el = q('.seg-btn'))) return showPage(el.dataset.page);
  if ((el = q('[data-cat]'))) { state.category = el.dataset.cat; renderChips(); return refreshProducts(); }
  if ((el = q('[data-ad]'))) return openAd(Number(el.dataset.ad));
  if ((el = q('[data-product]'))) return openProduct(Number(el.dataset.product)).catch(err => toast(err.message));
  if ((el = q('[data-offer]'))) { const o = state.modal.offers.find(x => x.pharmacyId === Number(el.dataset.offer)); if (o && o.stock > 0) { state.modal.sel = o.pharmacyId; state.modal.qty = Math.min(state.modal.qty, o.stock); renderProductModal(); } e.preventDefault(); return; }
  if ((el = q('[data-qty]'))) { const m = state.modal, o = m.offers.find(x => x.pharmacyId === m.sel); m.qty = Math.max(1, Math.min(o.stock, 10, m.qty + Number(el.dataset.qty))); return renderProductModal(); }
  if (q('[data-addcart]')) return addToCart();
  if ((el = q('[data-cartqty]'))) { const [i, dlt] = el.dataset.cartqty.split(':').map(Number); const l = state.cart[i]; l.qty = Math.max(1, Math.min(10, l.qty + dlt)); saveCart(); return renderCart(); }
  if ((el = q('[data-cartrm]'))) { state.cart.splice(Number(el.dataset.cartrm), 1); saveCart(); return renderCart(); }
  if ((el = q('[data-view]'))) { state.cartView = el.dataset.view; return renderCart(); }
  if ((el = q('[data-confirm]'))) return (el.closest('#cartBody') ? reservationAction : pharmacyReservationAction)(el.dataset.confirm, 'confirm');
  if ((el = q('[data-cancel]'))) return (el.closest('#cartBody') ? reservationAction : pharmacyReservationAction)(el.dataset.cancel, 'cancel');
  if ((el = q('[data-toggle]'))) return toggleCampaign(el.dataset.toggle);
  if ((el = q('[data-filter]'))) { state.advFilter = el.dataset.filter; return loadAdvertiser(); }
  if ((el = q('[data-ph]'))) { state.phId = Number(el.dataset.ph); return loadPharmacy(); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.cartph !== undefined) { state.cart[Number(t.dataset.cartph)].pharmacyId = Number(t.value); saveCart(); renderCart(); }
  if (t.id === 'advFilter') { state.advFilter = t.value; loadAdvertiser(); }
});
document.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id === 'checkoutForm') checkout();
  if (e.target.id === 'campaignForm') createCampaign();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModals(); });
['cfBudget', 'cfCpc'].forEach(id => $(id).addEventListener('input', updateCfHint));
$('cartBtn').addEventListener('click', openCart);
$('openCampaign').addEventListener('click', openCampaignModal);
let tProducts, tAds;
$('search').addEventListener('input', e => {
  state.query = e.target.value;
  clearTimeout(tProducts); clearTimeout(tAds);
  tProducts = setTimeout(refreshProducts, 200);
  tAds = setTimeout(refreshAds, 700);       // реклама и показ фиксируются после паузы в наборе
});
$('clearSearch').addEventListener('click', () => { $('search').value = ''; state.query = ''; refreshProducts(); refreshAds(); });
$('resetDemo').addEventListener('click', guard(async () => {
  if (!confirm('Сбросить все демо-данные (кампании, брони, события) к исходным?')) return;
  await post('/api/reset'); state.cart = []; state.doneReservations = []; state.advFilter = ''; saveCart();
  await loadCatalog(); await refreshProducts(); await refreshAds(); toast('Демо-данные сброшены'); showPage(state.page);
}));
setInterval(() => {
  if (document.hidden) return;
  if (state.page === 'advertiser') loadAdvertiser(true);
  if (state.page === 'pharmacy') loadPharmacy(true);
}, 5000);

(async function init() {
  saveCart();
  try { state.pharmacies = (await api('/api/pharmacies')).pharmacies; } catch (e) { toast(e.message); }
  await loadCatalog(); await refreshProducts(); await refreshAds();
})();
