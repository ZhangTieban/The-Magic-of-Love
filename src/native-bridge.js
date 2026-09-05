const DEFAULT_URL = 'ws://127.0.0.1:17321/ws';

export function toNativeState(items = []) {
  return {
    type: 'state',
    active: items.map((item) => ({
      tag: String(item.tag || 'generic'),
      title: String(item.title || '警告'),
      body: String(item.body || ''),
      test: item.test === true,
      time: Number.isFinite(Number(item.time)) ? Number(item.time) : Date.now(),
    })),
  };
}

export function createNativeOverlayBridge({
  url = DEFAULT_URL,
  onStatus = () => {},
  WebSocketImpl = globalThis.WebSocket,
} = {}) {
  let socket = null;
  let wanted = false;
  let lastPayload = JSON.stringify(toNativeState([]));
  let lastSent = null;
  let pendingTest = false;

  const status = (state, message) => onStatus({ state, message, connected: state === 'connected' });

  function sendRaw(payload) {
    if (!socket || socket.readyState !== WebSocketImpl.OPEN) return false;
    socket.send(payload);
    lastSent = payload;
    return true;
  }

  function connect() {
    if (!WebSocketImpl) {
      status('unsupported', '此瀏覽器無法使用 WebSocket，不能連線 Win11 原生浮層');
      return;
    }
    wanted = true;
    if (socket && (socket.readyState === WebSocketImpl.OPEN || socket.readyState === WebSocketImpl.CONNECTING)) return;
    status('connecting', '正在連線 Win11 原生浮層…若瀏覽器詢問「本機網路存取」，請選擇允許');
    try {
      socket = new WebSocketImpl(url);
    } catch (error) {
      socket = null;
      status('disconnected', `原生浮層連線失敗：${error.message}`);
      return;
    }
    socket.addEventListener('open', () => {
      status('connected', 'Win11 原生浮層已連線；警告會直接顯示於遊戲畫面上方');
      lastSent = null;
      sendRaw(lastPayload);
      if (pendingTest) { pendingTest = false; test(); }
    });
    socket.addEventListener('close', () => {
      socket = null;
      if (wanted) status('disconnected', 'Win11 原生浮層未連線；請先啟動 NativeOverlay，再按「連線」');
      else status('idle', 'Win11 原生浮層未連線');
    });
    socket.addEventListener('error', () => {
      status('disconnected', '找不到 Win11 原生浮層；請確認 NativeOverlay 已啟動');
    });
    socket.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'hello') status('connected', `Win11 原生浮層已連線（${data.version || '本機'}）`);
      } catch {}
    });
  }

  function disconnect() {
    wanted = false;
    const current = socket;
    socket = null;
    try { current?.close(1000, 'user disconnect'); } catch {}
    status('idle', 'Win11 原生浮層未連線');
  }

  function toggle() {
    if (socket && (socket.readyState === WebSocketImpl.OPEN || socket.readyState === WebSocketImpl.CONNECTING)) disconnect();
    else connect();
  }

  function setItems(items) {
    lastPayload = JSON.stringify(toNativeState(items));
    if (lastPayload === lastSent) return;
    sendRaw(lastPayload);
  }

  function test(milliseconds = 4000) {
    if (!socket || socket.readyState !== WebSocketImpl.OPEN) {
      pendingTest = true;
      connect();
      return;
    }
    const restore = lastPayload;
    const payload = JSON.stringify(toNativeState([{
      tag: 'test',
      title: 'Win11 原生浮層測試',
      body: '原生 TopMost／滑鼠穿透／不搶焦點測試',
      test: true,
      time: Date.now(),
    }]));
    sendRaw(payload);
    setTimeout(() => {
      lastPayload = restore;
      lastSent = null;
      sendRaw(lastPayload);
    }, milliseconds);
  }

  return {
    connect,
    disconnect,
    toggle,
    setItems,
    test,
    isConnected: () => Boolean(socket && socket.readyState === WebSocketImpl.OPEN),
    isConnecting: () => Boolean(socket && socket.readyState === WebSocketImpl.CONNECTING),
  };
}
