import { createEventLog, EVENT_TYPES, logCsv } from './event-log.js';

const LEAF_URL = new URL('assets/maple-leaf.png', window.location.href).href;

export function createAlertCenter({ stopSound }) {
  const el = id => document.getElementById(id);
  const log = createEventLog(localStorage, message => { el('logStatus').textContent = message; });
  const active = new Map();
  let floating = null;
  let latest = null;
  let acknowledged = true;
  let transient = null;
  let transientTimer = null;
  let renderSerial = 0;

  const stamp = time => new Date(time).toLocaleString('zh-TW', { hour12: false });

  function renderLog() {
    const rows = log.list().filter(e => !el('logFilter').value || e.tag === el('logFilter').value);
    el('logCount').textContent = `${rows.length} 筆／最多 500 筆`;
    el('logRows').replaceChildren();
    for (const row of rows) {
      const tr = document.createElement('tr');
      for (const value of [stamp(row.time), EVENT_TYPES[row.tag] || row.tag, row.test ? '測試' : '實際', row.body || row.title]) {
        const td = document.createElement('td'); td.textContent = value; tr.append(td);
      }
      el('logRows').append(tr);
    }
    el('logEmpty').hidden = rows.length > 0;
  }

  function visibleItems() {
    const items = [...active.values()].sort((a, b) => b.time - a.time);
    if (!items.length && transient) items.push(transient);
    return items;
  }

  function renderNotice(root, { floatingMode = false } = {}) {
    if (!root) return;
    const items = visibleItems();
    const doc = root.ownerDocument;
    const list = root.querySelector('[data-active-list]');
    const title = root.querySelector('[data-overlay-title]');
    const time = root.querySelector('[data-time]');
    const ack = root.querySelector('[data-ack]');
    const empty = root.querySelector('[data-empty]');

    if (title) title.textContent = items.length > 1 ? `同時有 ${items.length} 個警告` : (items[0]?.title || '等待警報');
    if (time) time.textContent = items.length ? stamp(items[0].time) : '';
    if (empty) empty.hidden = items.length > 0;

    list?.replaceChildren();
    for (const item of items) {
      const article = doc.createElement('article');
      article.className = `alarm-item alarm-${item.tag || 'generic'}`;
      const h3 = doc.createElement('h3');
      h3.textContent = `${item.test ? '測試：' : ''}${item.title}`;
      const p = doc.createElement('p');
      p.textContent = item.body || '';
      const badge = doc.createElement('span');
      badge.className = 'alarm-tag';
      badge.textContent = EVENT_TYPES[item.tag] || item.tag || '警告';
      article.append(badge, h3, p);
      list?.append(article);
    }

    root.classList.toggle('pending', items.length > 0 && !acknowledged);
    root.classList.toggle('idle', items.length === 0);
    root.dataset.renderSerial = String(++renderSerial);

    if (ack) {
      ack.textContent = acknowledged ? '已確認' : '確認警報並停止音效';
      ack.disabled = acknowledged || items.length === 0;
    }

    if (!floatingMode) root.hidden = items.length === 0;
  }

  function renderNotices() {
    renderNotice(el('activeNotice'));
    if (floating && !floating.closed) {
      renderNotice(floating.document.querySelector('.alarm-notice'), { floatingMode: true });
    }
  }

  function ack() {
    acknowledged = true;
    stopSound();
    renderNotices();
  }

  function showTransient(event, milliseconds = 4000) {
    clearTimeout(transientTimer);
    transient = { ...event, time: event.time ?? Date.now() };
    acknowledged = false;
    renderNotices();
    transientTimer = setTimeout(() => {
      transient = null;
      if (!active.size) acknowledged = true;
      renderNotices();
    }, milliseconds);
  }

  el('activeNotice').querySelector('[data-ack]').onclick = ack;
  el('silenceButton').onclick = stopSound;
  el('logFilter').onchange = renderLog;
  el('clearLogButton').onclick = () => { log.clear(); renderLog(); };
  el('exportLogButton').onclick = () => {
    const rows = log.list().filter(e => !el('logFilter').value || e.tag === el('logFilter').value);
    const url = URL.createObjectURL(new Blob([logCsv(rows)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `alarm-log-${Date.now()}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const supported = 'documentPictureInPicture' in window;
  el('floatingButton').disabled = !supported;
  el('floatingStatus').textContent = supported
    ? '瀏覽器置頂警告未開啟'
    : '此瀏覽器不支援置頂警告，請使用支援 Document Picture-in-Picture 的瀏覽器';

  el('floatingButton').onclick = async () => {
    if (floating && !floating.closed) { floating.close(); return; }
    el('floatingButton').disabled = true;
    try {
      floating = await window.documentPictureInPicture.requestWindow({ width: 460, height: 330 });
      const doc = floating.document;
      doc.title = '楓葉警報提醒';
      const style = doc.createElement('style');
      style.textContent = `
        *{box-sizing:border-box}body{margin:0;background:#110d10;color:#fff;font:15px/1.45 "Microsoft JhengHei",system-ui,sans-serif;overflow:auto}
        .alarm-notice{min-height:100vh;padding:14px;background:linear-gradient(180deg,#281116,#120d10);border-top:5px solid #ed1c24}
        .alarm-notice.idle{background:linear-gradient(180deg,#17191d,#0f1114);border-top-color:#555}
        .alarm-head{display:flex;align-items:center;gap:10px;padding:2px 2px 10px}.alarm-leaf{width:46px;height:46px;object-fit:contain;filter:drop-shadow(0 0 10px rgba(237,28,36,.35))}
        .alarm-head-main{min-width:0}.alarm-kicker{display:block;color:#ffb4b8;font-weight:800;font-size:12px;letter-spacing:.08em}.alarm-head h2{margin:1px 0 0;font-size:21px;line-height:1.15}.alarm-head time{display:block;color:#bfb8ba;font-size:11px;margin-top:3px}
        [data-empty]{margin:18px 2px;color:#aaa}.alarm-list{display:grid;gap:8px}.alarm-item{position:relative;padding:10px 11px 10px 13px;border:1px solid #73313a;border-left:5px solid #ff4545;border-radius:8px;background:#4a171d;box-shadow:0 10px 26px rgba(0,0,0,.22)}
        .alarm-item h3{margin:3px 0 2px;font-size:17px}.alarm-item p{margin:0;color:#f3dfe1;font-size:13px}.alarm-tag{display:inline-block;padding:1px 7px;border-radius:999px;background:#2c1014;color:#ffb9be;font-size:10px;font-weight:800}
        .alarm-notice.pending .alarm-item{animation:pulse .8s ease-in-out 3}@keyframes pulse{0%,100%{transform:scale(1);filter:brightness(1)}50%{transform:scale(1.015);filter:brightness(1.28)}}
        button{width:100%;margin-top:12px;padding:9px 10px;border:0;border-radius:7px;background:#fff;color:#211417;font:inherit;font-weight:800}button:disabled{opacity:.4}
      `;
      doc.head.append(style);
      const notice = doc.createElement('section');
      notice.className = 'alarm-notice idle';
      notice.innerHTML = `<div class="alarm-head"><img class="alarm-leaf" alt="紅色楓葉"><div class="alarm-head-main"><span class="alarm-kicker">瀏覽器置頂警告</span><h2 data-overlay-title>等待警報</h2><time data-time></time></div></div><p data-empty>等待紅點、滑鼠測試、測謊或符文警告。</p><div class="alarm-list" data-active-list></div><button type="button" data-ack disabled>已確認</button>`;
      notice.querySelector('.alarm-leaf').src = LEAF_URL;
      notice.querySelector('[data-ack]').onclick = ack;
      doc.body.append(notice);
      renderNotice(notice, { floatingMode: true });
      el('floatingButton').textContent = '關閉瀏覽器置頂警告';
      el('floatingStatus').textContent = '瀏覽器置頂警告已開啟；後續警告會依狀態自動更新';
      floating.addEventListener('pagehide', () => {
        floating = null;
        el('floatingButton').textContent = '開啟瀏覽器置頂警告';
        el('floatingStatus').textContent = '瀏覽器置頂警告已關閉；需要時可手動再次開啟';
      }, { once: true });
    } catch (error) {
      el('floatingStatus').textContent = `無法開啟置頂警告：${error.message}`;
    } finally {
      el('floatingButton').disabled = false;
    }
  };

  renderLog();

  return {
    record(event) {
      latest = log.add(event);
      acknowledged = false;
      renderLog();
      if (event.test) showTransient(latest);
      else renderNotices();
      return latest;
    },

    /** Marks one detector as currently active. Each tag is tracked independently. */
    setActive(event) {
      const previous = active.get(event.tag);
      active.set(event.tag, {
        ...previous,
        ...event,
        time: event.time ?? Date.now(),
      });
      transient = null;
      clearTimeout(transientTimer);
      acknowledged = false;
      renderNotices();
    },

    /** Clears one detector when its warning has been stably absent. */
    clearActive(tag) {
      if (!active.delete(tag)) return;
      if (!active.size) {
        acknowledged = true;
        stopSound();
      }
      renderNotices();
    },

    clearAllActive() {
      active.clear();
      transient = null;
      clearTimeout(transientTimer);
      acknowledged = true;
      stopSound();
      renderNotices();
    },

    isActive(tag) {
      return active.has(tag);
    },
  };
}
