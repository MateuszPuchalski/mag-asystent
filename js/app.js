/* ── WERTIS Kolektor magazynowy · prototyp (frontend, symulowany worker Sfery)
 *
 * Dane: data/products.json — prawdziwa kartoteka z Subiekta GT (eksport mag.xlsx),
 * format wiersza: [symbol, nazwa, ean, mag, rez, przyj, jm, zamowione, lokalizacje, opis]
 *
 * Parametry symulacji (query string):
 *   ?delay=3    — czas zapisu workera Sfery w sekundach (domyślnie 1.8)
 *   ?errors=1   — losowe błędy zapisu (kartoteka otwarta w edycji), jak w realu
 */
'use strict';

const qs = new URLSearchParams(location.search);
const WORKER_DELAY = Math.max(0.3, parseFloat(qs.get('delay')) || 1.8) * 1000;
const SIM_ERRORS = qs.get('errors') === '1';
const LOC_FIELD_LIMIT = 50;           // COL_LENGTH('tw__Towar','tw_Lokalizacja')
const SCAN_CHAR_MS = 50;              // skaner wrzuca znaki szybciej niż człowiek

const S = {
  screen: 'splash',
  loading: true,
  products: [],
  query: '',
  curId: null,
  mode: 'loc',                        // 'loc' | 'combo' — cel ekranu skanu lokalizacji
  pendingLoc: null,
  pickOne: false,
  chipMenu: null,
  manualOpen: false,
  qty: 0,
  recent: JSON.parse(localStorage.getItem('wertis_recent') || '[]'),
  queue: [
    {id: 3, type: 'set_location', label: 'Lokalizacja · W60-0401', detail: 'E03-02-01 (dodano)', status: 'error', errMsg: 'Kartoteka otwarta w edycji (Subiekt)', time: '10:05'},
    {id: 2, type: 'set_location', label: 'Lokalizacja · FTC201', detail: 'D01-02-02 (zastąpiono)', status: 'done', time: '09:31'},
    {id: 1, type: 'mm', label: 'MM PRZYJ→MAG · W09-0211', detail: '24 szt · dok. MM 46/07/2026', status: 'done', time: '09:12'},
  ],
  nextQ: 10,
  nextMM: 47,
};

const $ = id => document.getElementById(id);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const now = () => new Date().toLocaleTimeString('pl-PL', {hour: '2-digit', minute: '2-digit'});
const cur = () => S.products.find(p => p.id === S.curId);

const SPINNER = c => `<svg viewBox="0 0 24 24" width="18" height="18" class="spin"><g fill="#F7A600"><rect x="10.6" y="0.5" width="2.8" height="5" rx="1.2"/><rect x="10.6" y="18.5" width="2.8" height="5" rx="1.2"/><rect x="0.5" y="10.6" width="5" height="2.8" rx="1.2"/><rect x="18.5" y="10.6" width="5" height="2.8" rx="1.2"/><rect x="10.6" y="0.5" width="2.8" height="5" rx="1.2" transform="rotate(45 12 12)"/><rect x="10.6" y="18.5" width="2.8" height="5" rx="1.2" transform="rotate(45 12 12)"/><rect x="0.5" y="10.6" width="5" height="2.8" rx="1.2" transform="rotate(45 12 12)"/><rect x="18.5" y="10.6" width="5" height="2.8" rx="1.2" transform="rotate(45 12 12)"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3" fill="${c}"/></g></svg>`;
const BARCODE = (w, h, c) => `<svg viewBox="0 0 24 16" width="${w}" height="${h}"><g fill="${c}"><rect x="0" y="0" width="2" height="16"/><rect x="4" y="0" width="1" height="16"/><rect x="7" y="0" width="3" height="16"/><rect x="12" y="0" width="1" height="16"/><rect x="15" y="0" width="2" height="16"/><rect x="19" y="0" width="1" height="16"/><rect x="22" y="0" width="2" height="16"/></g></svg>`;

/* ── sygnały: beep + wibracja ────────────────────────────────────────── */
let audioCtx = null;
function beep(ok = true) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.frequency.value = ok ? 1400 : 320;
    g.gain.setValueAtTime(.12, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + .16);
    o.start(); o.stop(audioCtx.currentTime + .17);
  } catch (e) { /* brak audio — trudno */ }
  if (navigator.vibrate) navigator.vibrate(ok ? 40 : [60, 40, 60]);
}

/* ── toast / sukces ──────────────────────────────────────────────────── */
let toastT = null, successT = null;
function toast(msg) {
  clearTimeout(toastT);
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  toastT = setTimeout(() => t.classList.add('hidden'), 2400);
}
function flashSuccess(msg) {
  clearTimeout(successT);
  const o = $('overlay-success');
  o.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center">
      <div class="rope-line"></div>
      <svg viewBox="0 0 64 32" width="56" height="28">
        <path d="M28 0 h8 l4 11 h-16 z" fill="#3B3B3D"/>
        <rect x="4" y="11" width="56" height="18" rx="9" fill="#3B3B3D"/>
        <rect x="16" y="16" width="32" height="8" rx="4" fill="#F7A600"/>
      </svg>
    </div>
    <div class="success-msg">✓ ${esc(msg)}</div>
    <div class="success-sub">worker Sfery zapisze w tle</div>`;
  o.classList.remove('hidden');
  beep(true);
  successT = setTimeout(() => o.classList.add('hidden'), 1500);
}

/* ── kolejka Sfery (symulacja workera) ───────────────────────────────── */
function setQ(id, patch) {
  const t = S.queue.find(x => x.id === id);
  if (t) Object.assign(t, patch);
  renderQueueIfVisible();
  renderBadge();
  if (S.screen === 'product') render();   // banner "oczekujące w kolejce"
}
function runTask(t) {
  setTimeout(() => setQ(t.id, {status: 'processing'}), 700);
  setTimeout(() => {
    if (SIM_ERRORS && Math.random() < 0.45) {
      setQ(t.id, {status: 'error', errMsg: 'Zapis Sfery nieudany — kartoteka w edycji'});
      return;
    }
    const patch = {status: 'done'};
    if (t.type !== 'set_location') {
      patch.detail = t.detail + ' · dok. MM ' + (S.nextMM++) + '/07/2026';
    }
    setQ(t.id, patch);
    if (t.apply) t.apply();
  }, 700 + WORKER_DELAY);
}
function enqueue(type, label, detail, apply, pid) {
  const t = {id: S.nextQ++, type, label, detail, status: 'pending', time: now(), apply, pid};
  S.queue.unshift(t);
  renderBadge();
  renderQueueIfVisible();
  runTask(t);
}

/* ── operacje domenowe ───────────────────────────────────────────────── */
function openProduct(id) {
  S.curId = id;
  S.query = '';
  S.chipMenu = null;
  S.recent = [id, ...S.recent.filter(r => r !== id)].slice(0, 4);
  localStorage.setItem('wertis_recent', JSON.stringify(S.recent));
  go('product');
}
function applyLoc(newLocs, desc) {
  const p = cur();
  if (newLocs.join(' ').length > LOC_FIELD_LIMIT) {
    toast(`Limit pola tw_Lokalizacja (${LOC_FIELD_LIMIT} znaków) — za dużo lokalizacji`);
    beep(false);
    return;
  }
  p.locs = newLocs;
  enqueue('set_location', 'Lokalizacja · ' + p.sym, desc, null, p.id);
  Object.assign(S, {pendingLoc: null, pickOne: false, manualOpen: false, chipMenu: null});
  go('product');
  flashSuccess('Lokalizacja zapisana');
}
function finishCombo(newLocs, desc) {
  const p = cur();
  if (newLocs.join(' ').length > LOC_FIELD_LIMIT) {
    toast(`Limit pola tw_Lokalizacja (${LOC_FIELD_LIMIT} znaków)`);
    beep(false);
    return;
  }
  const qty = p.przyj, pid = p.id;
  p.locs = newLocs;
  enqueue('combo', 'Zasilenie · ' + p.sym, qty + ' szt → MAG · ' + desc, () => {
    const x = S.products.find(o => o.id === pid);
    x.przyj = 0; x.mag += qty;
  }, pid);
  Object.assign(S, {pendingLoc: null, pickOne: false, manualOpen: false});
  go('product');
  flashSuccess('Zasilenie w kolejce');
}
function scanLocation(code) {
  const p = cur();
  if (p.locs.includes(code) && S.mode === 'loc') { toast('Towar już ma lokalizację ' + code); return; }
  if (p.locs.length > 1) { S.pendingLoc = code; S.pickOne = false; renderDialog(); return; }
  if (S.mode === 'combo') finishCombo([code], 'lok. ' + code + ' (zastąpiono)');
  else applyLoc([code], code + ' (zastąpiono ' + (p.locs[0] || 'brak') + ')');
}
function dialogRoute(newLocs, desc) {
  if (S.mode === 'combo') finishCombo(newLocs, desc);
  else applyLoc(newLocs, desc);
}
function createMM(qty) {
  const p = cur(), pid = p.id;
  enqueue('mm', 'MM PRZYJ→MAG · ' + p.sym, qty + ' szt', () => {
    const x = S.products.find(o => o.id === pid);
    x.przyj -= qty; x.mag += qty;
  }, pid);
  go('product');
  flashSuccess('MM w kolejce');
}

/* ── rozpoznawanie skanu (jedno pole, interpretacja po treści) ───────── */
function interpretScan(code) {
  const c = code.trim();
  if (!c) return;
  if (/^\d{8}$|^\d{12,14}$/.test(c)) {                 // EAN
    const p = S.products.find(x => x.ean === c);
    if (p) { beep(true); openProduct(p.id); return; }
    toast('Nieznany kod EAN: ' + c);
    beep(false);
    return;
  }
  const p = S.products.find(x => x.sym.toLowerCase() === c.toLowerCase());
  if (p) { beep(true); openProduct(p.id); return; }
  const res = searchProducts(c);
  if (res.length === 1) { openProduct(res[0].id); return; }
  S.query = c;                                          // pokaż wyniki wyszukiwarki
  render();
}

/* ── wyszukiwarka (logika jak SELECT ze spec §5.1) ───────────────────── */
function searchProducts(q) {
  const ql = q.toLowerCase(), isNum = /^\d{5,}$/.test(q);
  const symM = S.products.filter(x => x.sym.toLowerCase().startsWith(ql));
  const nameM = S.products.filter(x => !symM.includes(x) && x.name.toLowerCase().includes(ql));
  const eanM = isNum ? S.products.filter(x => !symM.includes(x) && !nameM.includes(x) && x.ean.includes(q)) : [];
  return [...symM, ...nameM, ...eanM].slice(0, 20);
}

/* ── nawigacja / render ──────────────────────────────────────────────── */
const TITLES = {home: 'Magazyn', product: 'Karta towaru', scanLoc: () => S.mode === 'combo' ? 'Zasilenie — cel' : 'Skan lokalizacji', mm: 'Przesunięcie MM', queue: 'Kolejka Sfery'};
const BACK = {product: 'home', scanLoc: 'product', mm: 'product'};

function go(screen) {
  S.screen = screen;
  render();
}
function renderBadge() {
  const n = S.queue.filter(t => t.status !== 'done').length;
  const b = $('queue-badge');
  b.classList.toggle('hidden', n === 0);
  b.textContent = n;
}
function render() {
  const scr = S.screen;
  $('splash').classList.toggle('hidden', scr !== 'splash');
  $('chrome').classList.toggle('hidden', scr === 'splash');
  $('overlay-dialog').classList.add('hidden');
  if (scr === 'splash') return;

  const title = typeof TITLES[scr] === 'function' ? TITLES[scr]() : (TITLES[scr] || '');
  $('topbar-title').textContent = title;
  $('topbar-title').classList.toggle('center', !!BACK[scr]);
  $('btn-back').classList.toggle('hidden', !BACK[scr]);
  $('topbar-logo').classList.toggle('hidden', !!BACK[scr]);
  $('tab-home').classList.toggle('active', scr !== 'queue');
  $('tab-queue').classList.toggle('active', scr === 'queue');
  renderBadge();

  const v = $('view');
  v.innerHTML = '';
  if (scr === 'home') renderHome(v);
  else if (scr === 'product') renderProduct(v);
  else if (scr === 'scanLoc') renderScanLoc(v);
  else if (scr === 'mm') renderMM(v);
  else if (scr === 'queue') renderQueue(v);
  if (S.pendingLoc) renderDialog();
}

/* ── ekran: skanowanie / wyszukiwarka ────────────────────────────────── */
function renderHome(v) {
  const pane = el('div', 'pane');

  if (S.loading) {
    pane.appendChild(el('div', 'loading-row', SPINNER('#F6F5F2') + ' Ładowanie bazy towarów…'));
  }

  const box = el('div', 'scanbox');
  box.innerHTML = BARCODE(24, 16, '#3B3B3D');
  const input = document.createElement('input');
  input.placeholder = 'Skanuj lub wpisz symbol / nazwę…';
  input.value = S.query;
  input.autocapitalize = 'off';
  input.autocomplete = 'off';
  input.spellcheck = false;
  let lastKey = 0, fastChars = 0;
  input.addEventListener('keydown', e => {
    const t = performance.now();
    if (e.key.length === 1) { fastChars = (t - lastKey < SCAN_CHAR_MS) ? fastChars + 1 : 0; lastKey = t; }
    if (e.key === 'Enter') {
      const val = input.value.trim();
      if (!val) return;
      const isScan = fastChars >= 3 || /^\d{8}$|^\d{12,14}$/.test(val);
      fastChars = 0;
      if (isScan) { interpretScan(val); return; }
      const res = searchProducts(val);
      if (res.length) openProduct(res[0].id);
    }
  });
  input.addEventListener('input', () => {
    S.query = input.value;
    renderHomeResults(pane);
    clearBtn.classList.toggle('hidden', !input.value);
  });
  box.appendChild(input);
  const clearBtn = el('button', 'clear-x' + (S.query ? '' : ' hidden'), '✕');
  clearBtn.addEventListener('click', () => { S.query = ''; input.value = ''; input.focus(); renderHomeResults(pane); clearBtn.classList.add('hidden'); });
  box.appendChild(clearBtn);
  pane.appendChild(box);

  const results = el('div');
  results.id = 'home-results';
  pane.appendChild(results);
  renderHomeResults(pane);

  v.appendChild(pane);
  setTimeout(() => input.focus(), 50);   // focus trap — skaner pisze do pola
}

function renderHomeResults(pane) {
  const wrap = pane.querySelector('#home-results');
  wrap.innerHTML = '';
  const q = S.query.trim();

  if (q.length > 0) {
    const res = searchProducts(q);
    if (!res.length) {
      wrap.appendChild(el('div', 'no-results', 'Brak wyników dla „' + esc(q) + '”'));
      return;
    }
    const list = el('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:6px';
    list.appendChild(el('div', 'section-label', `Wyniki (${res.length})`));
    res.forEach(x => {
      const row = el('button', 'result-row', `
        <div class="result-main">
          <div class="result-sym">${esc(x.sym)}</div>
          <div class="result-name">${esc(x.name)}</div>
        </div>
        <div class="result-stock">
          <div>MAG <b>${x.mag}</b></div>
          <div class="${x.przyj > 0 ? 'przyj-hot' : 'przyj-zero'}">PRZYJ <b>${x.przyj}</b></div>
        </div>`);
      row.addEventListener('click', () => openProduct(x.id));
      list.appendChild(row);
    });
    wrap.appendChild(list);
    return;
  }

  const list = el('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:6px';
  list.appendChild(el('div', 'hint-small', `Baza: ${S.products.length} kartotek z Subiekta (odczyt SQL)`));
  const lbl = el('div', 'section-label', 'Symulacja skanera — tapnij kod');
  lbl.style.marginTop = '6px';
  list.appendChild(lbl);
  const demoSyms = ['W80-2005', 'W07-0101', 'FTC201'];
  let tiles = demoSyms.map(s => S.products.find(x => x.sym === s)).filter(Boolean);
  if (!tiles.length) tiles = S.products.slice(0, 3);
  tiles.forEach(x => {
    const t = el('button', 'scan-tile', BARCODE(26, 17, '#6E6E73') + `
      <div><div class="ean">${esc(x.ean || x.sym)}</div>
      <div class="nm">${esc(x.name)}</div></div>`);
    t.addEventListener('click', () => { beep(true); openProduct(x.id); });
    list.appendChild(t);
  });
  if (S.recent.length) {
    const rl = el('div', 'section-label', 'Ostatnio skanowane');
    rl.style.marginTop = '10px';
    list.appendChild(rl);
    S.recent.map(id => S.products.find(x => x.id === id)).filter(Boolean).forEach(x => {
      const r = el('button', 'recent-row', `
        <div class="sym">${esc(x.sym)}</div>
        <div class="loc">${esc(x.locs[0] || 'brak lokalizacji')}</div>`);
      r.addEventListener('click', () => openProduct(x.id));
      list.appendChild(r);
    });
  }
  wrap.appendChild(list);
}

/* ── ekran: karta towaru ─────────────────────────────────────────────── */
function renderProduct(v) {
  const p = cur();
  if (!p) { go('home'); return; }
  const avail = p.mag - p.rez;
  const locStr = p.locs.join(' ');
  const hasPendingMM = S.queue.some(t => t.pid === p.id && t.status !== 'done' && t.status !== 'error' && t.type !== 'set_location');
  const pane = el('div', 'pane');
  pane.style.gap = '12px';

  pane.appendChild(el('div', '', `
    <div class="p-name">${esc(p.name)}</div>
    <div class="p-meta"><b>${esc(p.sym)}</b><span>EAN ${esc(p.ean || '—')}</span><span>${esc(p.unit)}</span></div>
    ${p.desc ? `<div class="p-desc">${esc(p.desc)}</div>` : ''}`));

  pane.appendChild(el('div', 'stock-grid', `
    <div class="stock-card">
      <div class="stock-label">MAG · DOSTĘPNE</div>
      <div class="stock-num">${avail}</div>
      <div class="stock-note">rez. ${p.rez} · razem ${p.mag}</div>
    </div>
    <div class="stock-card${p.przyj > 0 ? ' hot' : ''}">
      <div class="stock-label">PRZYJ · PRZYJĘCIA</div>
      <div class="stock-num${p.przyj > 0 ? ' hot' : ''}">${p.przyj}</div>
      <div class="stock-note">${p.przyj > 0 ? 'do zasilenia MAG' : (p.ordered > 0 ? 'zam. u dostawcy: ' + p.ordered : 'strefa przyjęć pusta')}</div>
    </div>`));

  if (hasPendingMM) {
    pane.appendChild(el('div', 'pending-banner',
      SPINNER('#FFF6E3').replace('width="18" height="18"', 'width="14" height="14"') +
      ' Oczekujące w kolejce Sfery — stany uwzględnią zapis za chwilę'));
  }

  const locBlock = el('div');
  locBlock.style.cssText = 'display:flex;flex-direction:column;gap:7px';
  locBlock.appendChild(el('div', 'loc-head', `
    <div class="section-label">Lokalizacje <span class="sub">(pierwsza = pickingowa)</span></div>
    <div class="loc-meter${locStr.length > 42 ? ' warn' : ''}">${locStr.length}/${LOC_FIELD_LIMIT} zn.</div>`));
  const chips = el('div', 'chips');
  if (p.locs.length === 0) {
    chips.appendChild(el('div', 'chip-none', 'brak lokalizacji'));
  }
  p.locs.forEach((c, i) => {
    const chip = el('button', 'chip' + (i === 0 ? ' main' : ''), (i === 0 ? '<span class="dot"></span>' : '') + esc(c));
    chip.addEventListener('click', () => { S.chipMenu = S.chipMenu === c ? null : c; render(); });
    chips.appendChild(chip);
  });
  locBlock.appendChild(chips);
  if (S.chipMenu) {
    const menu = el('div', 'chip-menu', `<div class="txt">Lokalizacja <b>${esc(S.chipMenu)}</b></div>`);
    const rm = el('button', 'btn-danger', 'USUŃ ✕');
    rm.addEventListener('click', () => {
      const c = S.chipMenu;
      applyLoc(p.locs.filter(l => l !== c), '(usunięto ' + c + ')');
    });
    const cl = el('button', 'close', '✕');
    cl.addEventListener('click', () => { S.chipMenu = null; render(); });
    menu.appendChild(rm); menu.appendChild(cl);
    locBlock.appendChild(menu);
  }
  pane.appendChild(locBlock);

  const actions = el('div', 'action-grid');
  const bLoc = el('button', 'btn-outline', 'ZMIEŃ LOKALIZACJĘ');
  bLoc.addEventListener('click', () => { Object.assign(S, {mode: 'loc', manualOpen: false, chipMenu: null}); go('scanLoc'); });
  const bMM = el('button', 'btn-outline' + (p.przyj === 0 ? ' dim' : ''), 'MM PRZYJ → MAG');
  bMM.addEventListener('click', () => {
    if (p.przyj === 0) { toast('Brak stanu na PRZYJ'); return; }
    Object.assign(S, {qty: p.przyj, chipMenu: null}); go('mm');
  });
  const bCombo = el('button', 'btn-amber btn-wide' + (p.przyj === 0 ? ' dim' : ''), '⚡ ZASILENIE — MM CAŁOŚĆ + LOKALIZACJA');
  bCombo.addEventListener('click', () => {
    if (p.przyj === 0) { toast('Brak stanu na PRZYJ'); return; }
    Object.assign(S, {mode: 'combo', manualOpen: false, chipMenu: null}); go('scanLoc');
  });
  actions.appendChild(bLoc); actions.appendChild(bMM); actions.appendChild(bCombo);
  pane.appendChild(actions);
  v.appendChild(pane);
}

/* ── ekran: skan lokalizacji ─────────────────────────────────────────── */
function renderScanLoc(v) {
  const p = cur();
  const pane = el('div', 'pane');
  pane.style.gap = '12px';
  pane.appendChild(el('div', '', `<div style="font-size:13px;color:#6E6E73">${
    S.mode === 'combo'
      ? `MM ${p.przyj} szt PRZYJ→MAG + nowa lokalizacja — zeskanuj miejsce docelowe.`
      : 'Podejdź do miejsca docelowego i zeskanuj jego etykietę.'}</div>`));
  pane.appendChild(el('div', 'scanloc-target', `
    ${BARCODE(42, 28, '#3B3B3D')}
    <div class="t">Zeskanuj etykietę lokalizacji</div>
    <div class="w">czekam na skan…</div>`));

  pane.appendChild(el('div', 'section-label', 'Symulacja — tapnij etykietę na regale'));
  const grid = el('div', 'loc-grid');
  ['E08-03-01', 'D01-02-02', 'H04-05-02', 'PALETA48'].forEach(c => {
    const t = el('button', 'loc-tile', `<svg viewBox="0 0 24 16" width="24" height="14"><g fill="#6E6E73"><rect x="0" width="2" height="16"/><rect x="4" width="1" height="16"/><rect x="8" width="3" height="16"/><rect x="13" width="1" height="16"/><rect x="16" width="2" height="16"/><rect x="20" width="1" height="16"/></g></svg><div class="code">${esc(c)}</div>`);
    t.addEventListener('click', () => scanLocation(c));
    grid.appendChild(t);
  });
  pane.appendChild(grid);

  // niewidoczne pole na realny skan klawiaturowy
  const hidden = document.createElement('input');
  hidden.style.cssText = 'position:absolute;opacity:0;pointer-events:none;left:-999px';
  hidden.addEventListener('keydown', e => {
    if (e.key === 'Enter' && hidden.value.trim()) {
      const val = hidden.value.trim().toUpperCase();
      hidden.value = '';
      if (/\s/.test(val)) { toast('Kod lokalizacji nie może zawierać spacji'); beep(false); return; }
      scanLocation(val.replace(/^LOC:/, ''));
    }
  });
  pane.appendChild(hidden);
  setTimeout(() => hidden.focus({preventScroll: true}), 50);

  if (!S.manualOpen) {
    const link = el('button', 'manual-link', 'Wpisz lokalizację ręcznie…');
    link.addEventListener('click', () => { S.manualOpen = true; render(); });
    pane.appendChild(link);
  } else {
    const row = el('div', 'manual-row');
    const inp = document.createElement('input');
    inp.placeholder = 'np. A-03-2';
    inp.addEventListener('input', () => { inp.value = inp.value.toUpperCase(); });
    const submit = () => {
      const val = inp.value.trim().toUpperCase();
      if (!val) return;
      if (/\s/.test(val)) { toast('Kod lokalizacji nie może zawierać spacji'); beep(false); return; }
      scanLocation(val);
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    const ok = el('button', 'btn-dark', 'OK');
    ok.addEventListener('click', submit);
    row.appendChild(inp); row.appendChild(ok);
    pane.appendChild(row);
    const note = el('div', 'hint-small', 'Bez spacji · ręczne wpisywanie = ryzyko literówek');
    note.style.marginTop = '-6px';
    pane.appendChild(note);
    setTimeout(() => inp.focus(), 50);
  }
  v.appendChild(pane);
}

/* ── ekran: MM ───────────────────────────────────────────────────────── */
function renderMM(v) {
  const p = cur();
  const pane = el('div', 'pane');

  pane.appendChild(el('div', 'mm-prod', `<div class="sym">${esc(p.sym)}</div><div class="nm">${esc(p.name)}</div>`));
  pane.appendChild(el('div', 'mm-route', `
    <span class="from">PRZYJ</span>
    <svg viewBox="0 0 24 12" width="26" height="13"><path d="M2 6 h16 M14 1 l6 5 -6 5" fill="none" stroke="#3B3B3D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <span class="to">MAG</span>`));

  const qtyRow = el('div', 'qty-row');
  const minus = el('button', 'qty-btn', '−');
  const mid = el('div', 'qty-mid', `<div class="qty-num" id="qty-num">${S.qty}</div><div class="qty-sub">z ${p.przyj} szt na PRZYJ</div>`);
  const plus = el('button', 'qty-btn', '+');
  const setQty = q => { S.qty = Math.max(1, Math.min(p.przyj, q)); $('qty-num').textContent = S.qty; cta.textContent = `UTWÓRZ MM (${S.qty} SZT)`; };
  minus.addEventListener('click', () => setQty(S.qty - 1));
  plus.addEventListener('click', () => setQty(S.qty + 1));
  qtyRow.appendChild(minus); qtyRow.appendChild(mid); qtyRow.appendChild(plus);
  pane.appendChild(qtyRow);

  const full = el('button', 'btn-amber-outline', `CAŁA ILOŚĆ — ${p.przyj} SZT`);
  full.addEventListener('click', () => setQty(p.przyj));
  pane.appendChild(full);

  const cta = el('button', 'btn-amber mm-cta', `UTWÓRZ MM (${S.qty} SZT)`);
  cta.addEventListener('click', () => createMM(S.qty));
  pane.appendChild(cta);
  pane.appendChild(el('div', 'mm-note', 'Dokument MM utworzy worker Sfery — numer pojawi się w kolejce'));
  v.appendChild(pane);
}

/* ── ekran: kolejka Sfery ────────────────────────────────────────────── */
let pullY = null, pullH = 0, refreshing = false;
function renderQueue(v) {
  pullH = 0; pullY = null; refreshing = false;
  const wrap = el('div');
  wrap.id = 'queue-wrap';
  wrap.innerHTML = `
    <div id="pull-zone" class="animate"></div>
    <div id="queue-summary"></div>
    <div id="queue-list"></div>`;
  v.appendChild(wrap);

  const list = wrap.querySelector('#queue-list');
  list.addEventListener('pointerdown', e => { if (list.scrollTop <= 0) pullY = e.clientY; });
  list.addEventListener('pointermove', e => {
    if (pullY == null || refreshing) return;
    const d = e.clientY - pullY;
    if (d > 4) list.setPointerCapture(e.pointerId);
    pullH = Math.max(0, Math.min(96, d * .55));
    drawPull();
  });
  const up = () => {
    if (pullY == null) return;
    const past = pullH > 64;
    pullY = null;
    if (past && !refreshing) {
      refreshing = true; pullH = 44; drawPull();
      setTimeout(() => { refreshing = false; pullH = 0; drawPull(); renderQueueList(); }, 1100);
    } else { pullH = 0; drawPull(); }
  };
  list.addEventListener('pointerup', up);
  list.addEventListener('pointercancel', up);

  drawPull();
  renderQueueList();
}
function drawPull() {
  const z = $('pull-zone');
  if (!z) return;
  z.classList.toggle('animate', pullY == null);
  z.style.height = Math.round(pullH) + 'px';
  if (refreshing) {
    z.innerHTML = `<div class="refresh-row">${SPINNER('#EDEBE4')} Odświeżanie statusów…</div>`;
  } else {
    z.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center">
        <div class="rope-line" style="height:${Math.max(2, Math.round(pullH * .45))}px"></div>
        <svg viewBox="0 0 64 32" width="46" height="23">
          <path d="M28 0 h8 l4 11 h-16 z" fill="#3B3B3D"/>
          <rect x="4" y="11" width="56" height="18" rx="9" fill="#3B3B3D"/>
          <rect x="16" y="16" width="32" height="8" rx="4" fill="#F7A600"/>
        </svg>
        <div class="pull-label">${pullH > 64 ? 'puść — odpal!' : 'pociągnij linkę'}</div>
      </div>`;
  }
}
function renderQueueList() {
  const list = $('queue-list'), sum = $('queue-summary');
  if (!list) return;
  const pend = S.queue.filter(t => t.status === 'pending' || t.status === 'processing').length;
  const err = S.queue.filter(t => t.status === 'error').length;
  const done = S.queue.filter(t => t.status === 'done').length;
  sum.textContent = `${pend} oczekujące · ${err} błędów · ${done} zrobione`;
  list.innerHTML = '';
  const ICONS = {
    set_location: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 2 a7 7 0 0 1 7 7 c0 5 -7 13 -7 13 s-7 -8 -7 -13 a7 7 0 0 1 7 -7 z" fill="#3B3B3D"/><circle cx="12" cy="9" r="2.6" fill="#F7A600"/></svg>',
    mm: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 8 h14 M13 4 l5 4 -5 4 M21 16 H7 M11 12 l-5 4 5 4" fill="none" stroke="#3B3B3D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    combo: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M13 2 L5 14 h5 l-1 8 8 -12 h-5 z" fill="#F7A600" stroke="#3B3B3D" stroke-width="1"/></svg>',
  };
  S.queue.forEach(t => {
    const item = el('div', 'q-item' + (t.status === 'error' ? ' err' : ''));
    let side = `<div class="q-time">${esc(t.time)}</div>`;
    if (t.status === 'pending') side += '<div class="q-pending">⏳ w kolejce</div>';
    else if (t.status === 'processing') side += `<div class="q-proc">${SPINNER('#fff').replace('width="18" height="18"', 'width="13" height="13"')} Sfera zapisuje</div>`;
    else if (t.status === 'done') side += '<div class="q-done">✓</div>';
    item.innerHTML = `
      <div class="q-ico">${ICONS[t.type] || ICONS.mm}</div>
      <div class="q-main">
        <div class="q-label">${esc(t.label)}</div>
        <div class="q-detail">${esc(t.detail)}</div>
        ${t.status === 'error' ? `<div class="q-errmsg">${esc(t.errMsg || '')}</div>` : ''}
      </div>
      <div class="q-side">${side}</div>`;
    if (t.status === 'error') {
      const retry = el('button', 'q-retry', 'PONÓW');
      retry.addEventListener('click', () => {
        Object.assign(t, {status: 'pending', errMsg: null, time: now()});
        renderQueueList(); renderBadge();
        runTask(t);
      });
      item.querySelector('.q-side').appendChild(retry);
    }
    list.appendChild(item);
  });
}
function renderQueueIfVisible() {
  if (S.screen === 'queue') renderQueueList();
}

/* ── dialog wielu lokalizacji ────────────────────────────────────────── */
function renderDialog() {
  const p = cur();
  const o = $('overlay-dialog');
  o.classList.remove('hidden');
  o.innerHTML = '';
  const sheet = el('div', 'sheet');
  sheet.appendChild(el('div', 'sheet-title',
    `Towar ma ${p.locs.length} lokalizacje — co z <span class="hl">${esc(S.pendingLoc)}</span>?`));

  const all = el('button', 'btn-amber', 'ZASTĄP WSZYSTKIE');
  all.addEventListener('click', () => dialogRoute([S.pendingLoc], S.pendingLoc + ' (zastąpiono wszystkie)'));
  sheet.appendChild(all);

  const add = el('button', 'btn-outline', 'DODAJ JAKO KOLEJNĄ');
  add.addEventListener('click', () => dialogRoute([...p.locs, S.pendingLoc], S.pendingLoc + ' (dodano)'));
  sheet.appendChild(add);

  if (!S.pickOne) {
    const pick = el('button', 'btn-outline', 'ZASTĄP JEDNĄ Z… ▾');
    pick.addEventListener('click', () => { S.pickOne = true; renderDialog(); });
    sheet.appendChild(pick);
  } else {
    const row = el('div', 'pick-chips');
    p.locs.forEach(old => {
      const c = el('button', 'pick-chip', `${esc(old)} → ${esc(S.pendingLoc)}`);
      c.addEventListener('click', () => dialogRoute(p.locs.map(l => l === old ? S.pendingLoc : l), S.pendingLoc + ' (zamiast ' + old + ')'));
      row.appendChild(c);
    });
    sheet.appendChild(row);
  }

  const cancel = el('button', 'cancel', 'Anuluj');
  cancel.addEventListener('click', () => { S.pendingLoc = null; S.pickOne = false; o.classList.add('hidden'); });
  sheet.appendChild(cancel);
  o.appendChild(sheet);
}

/* ── start ───────────────────────────────────────────────────────────── */
function boot() {
  fetch('data/products.json')
    .then(r => r.json())
    .then(rows => {
      S.products = rows.map((r, i) => ({
        id: i + 1, sym: r[0], name: r[1], ean: String(r[2] || ''), mag: r[3], rez: r[4],
        przyj: r[5], unit: r[6] || 'szt.', ordered: r[7] || 0,
        locs: r[8] ? r[8].split(' ').filter(Boolean) : [], desc: r[9] || '',
      }));
      S.loading = false;
      if (S.screen === 'home') render();
    })
    .catch(() => { S.loading = false; toast('Nie udało się wczytać bazy towarów'); });

  const rope = $('splash-rope');
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    rope.classList.add('yank');
    $('splash-caption').textContent = 'URUCHAMIANIE…';
    beep(true);
    setTimeout(() => go('home'), 950);
  };
  rope.addEventListener('click', start);
  rope.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') start(); });

  $('btn-back').addEventListener('click', () => {
    Object.assign(S, {chipMenu: null, manualOpen: false, pendingLoc: null, pickOne: false});
    go(BACK[S.screen] || 'home');
  });
  document.querySelectorAll('[data-nav]').forEach(b =>
    b.addEventListener('click', () => go(b.dataset.nav)));

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
boot();
