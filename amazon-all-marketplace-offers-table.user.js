// ==UserScript==
// @name         Amazon: all marketplace offers in one table
// @namespace    https://github.com/mithraskuipers
// @version      1.4.0
// @description  Collects every offer (new + used, all sellers) of an Amazon product into one table with per-column sorting & filtering, links, CSV export.
// @match        https://www.amazon.nl/*
// @match        https://amazon.nl/*
// @match        https://www.amazon.com/*
// @match        https://amazon.com/*
// @match        https://www.amazon.de/*
// @match        https://amazon.de/*
// @match        https://www.amazon.co.uk/*
// @match        https://amazon.co.uk/*
// @match        https://www.amazon.fr/*
// @match        https://amazon.fr/*
// @match        https://www.amazon.it/*
// @match        https://amazon.it/*
// @match        https://www.amazon.es/*
// @match        https://amazon.es/*
// @match        https://www.amazon.be/*
// @match        https://amazon.be/*
// @match        https://www.amazon.com.be/*
// @match        https://amazon.com.be/*
// @match        https://www.amazon.se/*
// @match        https://amazon.se/*
// @match        https://www.amazon.pl/*
// @match        https://amazon.pl/*
// @match        https://www.amazon.ca/*
// @match        https://amazon.ca/*
// @match        https://www.amazon.com.au/*
// @match        https://amazon.com.au/*
// @match        https://www.amazon.ie/*
// @match        https://amazon.ie/*
// @match        https://www.amazon.at/*
// @match        https://amazon.at/*
// @match        https://www.amazon.ch/*
// @match        https://amazon.ch/*
// @match        https://www.amazon.com.tr/*
// @match        https://amazon.com.tr/*
// @run-at       document-idle
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  'use strict';

  const FLAG = 'aot_autorun';
  const CONDITION_RANK = { 'new': 0, 'used - like new': 1, 'used - very good': 2, 'used - good': 3, 'used - acceptable': 4 };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clean = t => (t || '').replace(/\s+/g, ' ').trim();
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function getAsin() {
    const i = $('#ASIN');
    if (i && i.value) return i.value;
    const m = location.pathname.match(/\/(?:dp|product)\/([A-Z0-9]{10})/);
    return m ? m[1] : '';
  }

  // ---------- parsing ----------
  function parseOffer(el, asin, isPinned) {
    const price = $('[data-csa-c-price-to-pay]', el);
    const priceNum = price ? parseFloat(price.getAttribute('data-csa-c-price-to-pay')) : NaN;
    const shipAttr = price ? parseFloat(price.getAttribute('data-csa-c-shipping-charge')) : NaN;
    const symbol = clean(($('.a-price-symbol', el) || {}).textContent);

    const heading = clean(($('#aod-offer-heading', el) || {}).textContent);
    const condNoteEl = $('.expandable-expanded-text', el);
    let condNote = clean(condNoteEl ? condNoteEl.textContent : '');
    if (!condNote) {
      const c = $('#aod-condition-container', el);
      condNote = clean(c ? c.textContent.replace(/^\s*Condition/i, '') : '');
    }

    const soldBy = $('#aod-offer-soldBy', el);
    const sellerLink = soldBy ? $('a[href*="seller="]', soldBy) : null;
    let sellerName = '';
    let sellerId = '';
    if (sellerLink) {
      sellerName = clean(sellerLink.textContent);
      const m = sellerLink.getAttribute('href').match(/[?&]seller=([A-Z0-9]+)/);
      sellerId = m ? m[1] : '';
    } else if (soldBy) {
      sellerName = clean(soldBy.textContent).replace(/^Sold by\s*/i, '');
    }
    const rating = clean(($('#aod-offer-seller-rating', el) || {}).textContent);
    const shipsFromEl = $('#aod-offer-shipsFrom', el);
    const shipsFrom = shipsFromEl ? clean(shipsFromEl.textContent).replace(/^(Dispatches|Ships) from\s*/i, '') : '';

    const deliv = $('[data-csa-c-delivery-time]', el);
    const delivery = deliv
      ? clean((deliv.getAttribute('data-csa-c-delivery-price') || '') + ' ' + deliv.getAttribute('data-csa-c-delivery-time'))
      : clean(($('.aod-delivery-promise', el) || {}).textContent);

    const host = location.origin;
    const productUrl = sellerId ? `${host}/dp/${asin}?m=${sellerId}` : `${host}/dp/${asin}`;

    const shipping = isNaN(shipAttr) ? 0 : shipAttr;
    return {
      condition: heading || (isPinned ? 'New' : ''),
      price: priceNum,
      shipping,
      total: isNaN(priceNum) ? NaN : priceNum + shipping,
      currency: symbol,
      seller: sellerName,
      sellerRating: rating,
      shipsFrom,
      prime: !!$('i.a-icon-prime', el),
      delivery,
      note: condNote,
      sellerUrl: sellerId ? `${host}/gp/aag/main?seller=${sellerId}` : '',
      productUrl,
      pinned: !!isPinned,
    };
  }

  function collectOffers() {
    const asin = getAsin();
    const out = [];
    const pinned = $('#aod-pinned-offer');
    if (pinned) out.push(parseOffer(pinned, asin, true));
    $$('#aod-offer-list [id="aod-offer"]').forEach(el => out.push(parseOffer(el, asin, false)));
    return out.filter(o => !isNaN(o.price));
  }

  // ---------- opening / loading the offers panel ----------
  async function openPanel() {
    if ($('#aod-container') && $$('#aod-offer-list [id="aod-offer"]').length) return true;
    const trigger =
      $('#aod-ingress-link') ||
      $('#buybox-see-all-buying-choices a') ||
      $('#buybox-see-all-buying-choices-announce') ||
      $('a[href*="aod=1"]') ||
      $('#usedAccordionRow a, #newAccordionRow a');
    if (!trigger) return false;
    trigger.click();
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      if ($$('#aod-offer-list [id="aod-offer"]').length) return true;
    }
    return false;
  }

  function expectedCount() {
    const t = clean(($('#aod-filter-offer-count-string') || {}).textContent);
    const m = t.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  async function loadAll(setStatus) {
    const scroller = $('#all-offers-display-scroller') || $('#aod-container')?.parentElement;
    const expected = expectedCount();
    let last = -1, stable = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      const n = $$('#aod-offer-list [id="aod-offer"]').length;
      setStatus(`Loading offers… ${n}${expected ? ' / ' + expected : ''}`);
      const end = $('#aod-end-of-results');
      if (end && !end.classList.contains('aod-hide') && n === last) break;
      if (expected && n >= expected) break;
      const more = $('#aod-show-more-offers a, #aod-show-more-offers');
      if (more && more.offsetParent !== null) more.click();
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      const lastEl = $$('#aod-offer-list [id="aod-offer"]').pop();
      if (lastEl) lastEl.scrollIntoView({ block: 'end' });
      for (let w = 0; w < 30; w++) {
        await sleep(100);
        if ($$('#aod-offer-list [id="aod-offer"]').length > n) break;
      }
      const now = $$('#aod-offer-list [id="aod-offer"]').length;
      stable = now === n ? stable + 1 : 0;
      last = n;
      if (stable >= 2) break;
    }
  }

  // ---------- UI ----------
  const COLS = [
    ['condition', 'Condition'],
    ['price', 'Price'],
    ['shipping', 'Ship'],
    ['total', 'Total'],
    ['seller', 'Seller'],
    ['sellerRating', 'Seller rating'],
    ['shipsFrom', 'Ships from'],
    ['prime', 'Prime'],
    ['delivery', 'Delivery'],
    ['note', 'Condition notes'],
    ['productUrl', 'Offer URL'],
  ];
  const NUM_KEYS = ['price', 'shipping', 'total'];
  const FILTERABLE = new Set(['condition', 'seller', 'sellerRating', 'shipsFrom', 'prime', 'delivery']);

  let rows = [];
  let sortKey = 'total';
  let sortDir = 1;
  let filterText = '';
  let colFilters = {}; // key -> Set of selected values (missing key = no filter)

  function rankCond(c) {
    const k = (c || '').toLowerCase().replace(/\s+/g, ' ').trim();
    return k in CONDITION_RANK ? CONDITION_RANK[k] : 9;
  }

  function filterVal(v) {
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (v == null || v === '') return '(blank)';
    return String(v);
  }

  function uniqueVals(key) {
    const m = new Map();
    for (const r of rows) {
      const v = filterVal(r[key]);
      const e = m.get(v);
      if (e) e.count++;
      else m.set(v, { count: 1 });
    }
    const arr = [...m.entries()].map(([v, { count }]) => ({ v, count }));
    if (key === 'condition') arr.sort((a, b) => rankCond(a.v) - rankCond(b.v) || a.v.localeCompare(b.v));
    else arr.sort((a, b) =>
      ((a.v === '(blank)') - (b.v === '(blank)')) || a.v.localeCompare(b.v, undefined, { numeric: true }));
    return arr;
  }

  function sortedRows() {
    const f = filterText.toLowerCase();
    const list = rows.filter(r => {
      for (const [k, set] of Object.entries(colFilters)) {
        if (!set.has(filterVal(r[k]))) return false;
      }
      return !f || Object.values(r).join(' ').toLowerCase().includes(f);
    });
    list.sort((a, b) => {
      let x = a[sortKey], y = b[sortKey];
      if (sortKey === 'condition') { x = rankCond(x); y = rankCond(y); }
      if (typeof x === 'string') return x.localeCompare(y) * sortDir;
      if (typeof x === 'boolean') return ((x === y) ? 0 : x ? -1 : 1) * sortDir;
      return ((x > y) - (x < y)) * sortDir || (a.total - b.total);
    });
    return list;
  }

  function fmt(r, v) { return isNaN(v) ? '' : `${r.currency}${v.toFixed(2)}`; }

  function toCsv(list) {
    const sep = ',';
    const esc = v => {
      v = String(v ?? '');
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    };
    const head = COLS.map(c => c[1]).join(sep);
    const body = list.map(r => COLS.map(([k]) => {
      const v = r[k];
      return esc(typeof v === 'number' ? v.toFixed(2) : typeof v === 'boolean' ? (v ? 'yes' : 'no') : v);
    }).join(sep));
    return [head, ...body].join('\n');
  }

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function copy(text) {
    if (typeof GM_setClipboard === 'function') GM_setClipboard(text);
    else navigator.clipboard.writeText(text);
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // ---------- per-column filter dropdown ----------
  let menuEl = null;
  let menuDocHandler = null;

  function closeMenu() {
    if (menuEl) { menuEl.remove(); menuEl = null; }
    if (menuDocHandler) { document.removeEventListener('mousedown', menuDocHandler); menuDocHandler = null; }
  }

  function openMenu(key, anchor, overlay) {
    closeMenu();
    const label = (COLS.find(c => c[0] === key) || [])[1] || key;
    const uniq = uniqueVals(key);

    menuEl = document.createElement('div');
    menuEl.id = 'aot-menu';
    menuEl.innerHTML = `
      <div class="aot-menu-head">
        <span>Filter: <b>${esc(label)}</b></span>
        <button class="aot-menu-clear"${colFilters[key] ? '' : ' disabled'}>Clear</button>
        <button class="aot-menu-x" title="Close">✕</button>
      </div>
      ${uniq.length > 8 ? '<input class="aot-menu-search" placeholder="Search…">' : ''}
      <label class="aot-menu-all"><input type="checkbox" class="aot-allbox"> (Show all)</label>
      <div class="aot-menu-list"></div>`;
    document.body.appendChild(menuEl);

    const listBox = $('.aot-menu-list', menuEl);
    const search = $('.aot-menu-search', menuEl);
    const allBox = $('.aot-allbox', menuEl);
    const clearBtn = $('.aot-menu-clear', menuEl);

    const paintList = (q = '') => {
      const cur = colFilters[key] || null;
      const ql = q.trim().toLowerCase();
      const items = uniq.filter(u => !ql || u.v.toLowerCase().includes(ql));
      listBox.innerHTML = items.length ? items.map(u =>
        `<label class="aot-menu-item"><input type="checkbox" value="${esc(u.v)}"${!cur || cur.has(u.v) ? ' checked' : ''}><span class="aot-mv" title="${esc(u.v)}">${esc(u.v)}</span><span class="aot-mc">${u.count}</span></label>`
      ).join('') : '<div class="aot-menu-empty">No matches</div>';
    };
    const syncAllBox = () => {
      allBox.checked = !colFilters[key];
      clearBtn.disabled = !colFilters[key];
    };
    const apply = () => render(overlay);

    paintList();
    syncAllBox();

    if (search) search.addEventListener('input', () => paintList(search.value));

    allBox.addEventListener('change', () => {
      if (allBox.checked) delete colFilters[key];
      else colFilters[key] = new Set();
      paintList(search ? search.value : '');
      syncAllBox();
      apply();
    });

    listBox.addEventListener('change', e => {
      const box = e.target.closest('input[type="checkbox"]');
      if (!box) return;
      const set = new Set(colFilters[key] || []);
      if (box.checked) set.add(box.value); else set.delete(box.value);
      if (uniq.every(u => set.has(u.v))) delete colFilters[key];
      else colFilters[key] = set;
      syncAllBox();
      apply();
    });

    clearBtn.addEventListener('click', () => {
      delete colFilters[key];
      paintList(search ? search.value : '');
      syncAllBox();
      apply();
    });

    $('.aot-menu-x', menuEl).addEventListener('click', closeMenu);

    // position under the caret button, keep inside viewport
    const r = anchor.getBoundingClientRect();
    menuEl.style.visibility = 'hidden';
    const mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
    let left = Math.min(r.left, window.innerWidth - mw - 8);
    let top = r.bottom + 4;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
    menuEl.style.left = Math.max(8, left) + 'px';
    menuEl.style.top = top + 'px';
    menuEl.style.visibility = '';

    menuDocHandler = e => {
      if (menuEl && !menuEl.contains(e.target) && !e.target.closest('.aot-fbtn')) closeMenu();
    };
    document.addEventListener('mousedown', menuDocHandler);
  }

  function render(overlay) {
    const list = sortedRows();
    const minTotal = Math.min(...list.map(r => r.total));
    $('#aot-count', overlay).textContent = `${list.length} of ${rows.length} offers`;
    $('#aot-clearf', overlay).style.display = Object.keys(colFilters).length ? '' : 'none';

    $('#aot-head', overlay).innerHTML = COLS.map(([k, label]) => {
      const sorted = sortKey === k;
      const arrow = sorted ? (sortDir > 0 ? ' ▲' : ' ▼') : '';
      const active = colFilters[k] && colFilters[k].size;
      const fbtn = FILTERABLE.has(k)
        ? `<button class="aot-fbtn${active ? ' on' : ''}" data-f="${k}" title="Filter values">▾</button>`
        : '';
      const cls = [
        ...(NUM_KEYS.includes(k) ? ['num'] : []),
        ...(sorted ? ['aot-sorted'] : []),
      ].join(' ');
      return `<th data-k="${k}"${cls ? ` class="${cls}"` : ''}><span class="aot-thsort" title="Click to sort">${esc(label)}${arrow}</span>${fbtn}</th>`;
    }).join('');

    $('#aot-body', overlay).innerHTML = list.map(r => {
      const cls = r.total === minTotal ? ' class="aot-best"' : '';
      const tds = COLS.map(([k]) => {
        const v = r[k];
        if (k === 'price' || k === 'shipping' || k === 'total') return `<td class="num">${fmt(r, v)}</td>`;
        if (k === 'prime') return `<td>${v ? 'yes' : ''}</td>`;
        if (k === 'productUrl') return `<td><a href="${v}" target="_blank" rel="noopener">open</a></td>`;
        if (k === 'seller' && r.sellerUrl) return `<td><a href="${r.sellerUrl}" target="_blank" rel="noopener">${esc(v)}</a></td>`;
        if (k === 'note') return `<td class="note">${esc(v)}</td>`;
        return `<td>${esc(v)}</td>`;
      }).join('');
      return `<tr${cls}>${tds}</tr>`;
    }).join('');
  }

  function showOverlay() {
    let overlay = $('#aot-overlay');
    if (overlay) overlay.remove();
    closeMenu();
    overlay = document.createElement('div');
    overlay.id = 'aot-overlay';
    overlay.innerHTML = `
      <style>
        #aot-overlay{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font:13px/1.35 system-ui,sans-serif}
        #aot-box{background:#fff;color:#111;width:96vw;height:90vh;border-radius:8px;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.4)}
        #aot-bar{display:flex;gap:8px;align-items:center;padding:10px 12px;border-bottom:1px solid #ddd;flex-wrap:wrap}
        #aot-bar b{font-size:14px}
        #aot-bar button,#aot-bar input{font:inherit;padding:4px 8px;border:1px solid #888;border-radius:4px;background:#f5f5f5;color:#111}
        #aot-bar input{background:#fff;min-width:220px}
        #aot-bar .sp{flex:1}
        #aot-wrap{overflow:auto;flex:1}
        #aot-table{border-collapse:collapse;width:100%}
        #aot-table th{position:sticky;top:0;background:#232f3e;color:#fff;text-align:left;padding:6px 8px;cursor:pointer;white-space:nowrap;user-select:none}
        #aot-table th.num{text-align:right}
        #aot-table th .aot-thsort{cursor:pointer}
        #aot-table th:hover:not(.aot-sorted) .aot-thsort::after{content:'↕';opacity:.5;margin-left:4px}
        #aot-table .aot-fbtn{border:0;background:none;color:#fff;cursor:pointer;font:inherit;padding:0 0 0 6px;opacity:.65;vertical-align:middle}
        #aot-table .aot-fbtn:hover{opacity:1}
        #aot-table .aot-fbtn.on{color:#ffb84d;opacity:1;font-weight:700}
        #aot-table td{padding:5px 8px;border-bottom:1px solid #eee;vertical-align:top}
        #aot-table td.num{text-align:right;white-space:nowrap}
        #aot-table td.note{min-width:320px;max-width:520px}
        #aot-table tr:hover td{background:#fff8e1}
        #aot-table tr.aot-best td{background:#e8f5e9;font-weight:600}
        #aot-table a{color:#0b5cad}
        #aot-menu{position:fixed;z-index:2147483647;background:#fff;border:1px solid #999;border-radius:6px;box-shadow:0 6px 24px rgba(0,0,0,.3);width:250px;font:12px/1.4 system-ui,sans-serif;color:#111}
        .aot-menu-head{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid #ddd}
        .aot-menu-head button{font:inherit;border:0;background:none;cursor:pointer;color:#0b5cad;padding:2px 4px}
        .aot-menu-head button:disabled{color:#aaa;cursor:default}
        .aot-menu-head .aot-menu-x{margin-left:auto;color:#666}
        .aot-menu-search{width:calc(100% - 12px);margin:6px;padding:4px 6px;border:1px solid #bbb;border-radius:4px;font:inherit}
        .aot-menu-all{display:flex;align-items:center;gap:6px;padding:4px 8px;border-bottom:1px solid #eee;font-weight:600;cursor:pointer}
        .aot-menu-list{max-height:260px;overflow:auto}
        .aot-menu-item{display:flex;align-items:center;gap:6px;padding:4px 8px;cursor:pointer}
        .aot-menu-item:hover{background:#f5f5f5}
        .aot-mv{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .aot-mc{color:#777;font-size:11px}
        .aot-menu-empty{padding:8px;color:#888}
      </style>
      <div id="aot-box">
        <div id="aot-bar">
          <b>All offers</b><span id="aot-count"></span>
          <input id="aot-filter" placeholder="Search all columns…">
          <span id="aot-status"></span>
          <button id="aot-clearf" style="display:none">Clear filters</button>
          <span class="sp"></span>
          <button id="aot-copy">Copy CSV</button>
          <button id="aot-csv">Save CSV</button>
          <button id="aot-refresh">Reload</button>
          <button id="aot-close">Close</button>
        </div>
        <div id="aot-wrap"><table id="aot-table"><thead><tr id="aot-head"></tr></thead><tbody id="aot-body"></tbody></table></div>
      </div>`;
    document.body.appendChild(overlay);

    $('#aot-head', overlay).addEventListener('click', e => {
      const fbtn = e.target.closest('.aot-fbtn');
      if (fbtn) { openMenu(fbtn.dataset.f, fbtn, overlay); return; }
      const th = e.target.closest('th');
      if (!th || !th.dataset.k) return;
      const k = th.dataset.k;
      if (sortKey === k) sortDir = -sortDir;
      else { sortKey = k; sortDir = 1; }
      render(overlay);
    });
    $('#aot-filter', overlay).addEventListener('input', e => { filterText = e.target.value; render(overlay); });
    $('#aot-clearf', overlay).onclick = () => { colFilters = {}; render(overlay); };
    const flash = (btn, msg) => { const t = btn.textContent; btn.textContent = msg; setTimeout(() => { btn.textContent = t; }, 1200); };
    $('#aot-copy', overlay).onclick = e => { copy(toCsv(sortedRows())); flash(e.target, 'Copied!'); };
    $('#aot-csv', overlay).onclick = () => download(`amazon-offers-${getAsin()}.csv`, '\ufeff' + toCsv(sortedRows()), 'text/csv');
    $('#aot-close', overlay).onclick = () => { closeMenu(); overlay.remove(); };
    $('#aot-refresh', overlay).onclick = () => run();
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) { closeMenu(); overlay.remove(); } });
    return overlay;
  }

  async function run() {
    closeMenu();
    const overlay = showOverlay();
    const status = $('#aot-status', overlay);
    status.textContent = 'Opening offers panel…';
    const ok = await openPanel();
    if (!ok) {
      const asin = getAsin();
      if (asin && !/[?&]aod=1/.test(location.search)) {
        sessionStorage.setItem(FLAG, '1');
        location.href = `${location.origin}/dp/${asin}?aod=1`;
        return;
      }
      status.textContent = 'Could not open the offers panel.';
      return;
    }
    await loadAll(t => { status.textContent = t; });
    rows = collectOffers();
    status.textContent = '';
    render(overlay);
  }

  function addButton() {
    if ($('#aot-btn')) return;
    const b = document.createElement('button');
    b.id = 'aot-btn';
    b.textContent = 'All offers table';
    b.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483646;padding:10px 14px;border:0;border-radius:6px;background:#ff9900;color:#111;font:600 13px system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.35)';
    b.onclick = run;
    document.body.appendChild(b);
  }

  console.log('[amazon-offers-table] loaded on', location.href);
  addButton();
  // Amazon re-renders parts of the page; re-add the button if it disappears
  new MutationObserver(() => { if (document.body && !$('#aot-btn')) addButton(); })
    .observe(document.documentElement, { childList: true, subtree: true });
  if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('Show all offers table', run);
  if (sessionStorage.getItem(FLAG)) {
    sessionStorage.removeItem(FLAG);
    run();
  }

  // exposed for testing
  window.__aot = { collectOffers, parseOffer };
})();
