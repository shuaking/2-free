// ==UserScript==
// @name         Freebuff Auto Token Exporter
// @namespace    freebuff2api
// @version      2.0.0
// @description  在 freebuff.com 登录后自动捕获并复制 authToken
// @match        https://freebuff.com/*
// @match        https://www.freebuff.com/*
// @grant        GM_setClipboard
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const KEYWORDS = ['authToken', 'auth_token', 'token', 'accessToken', 'access_token', 'bearer', 'authorization'];
  const TOKEN_RE = /[A-Za-z0-9._-]{24,}/;
  const results = [];
  const visitedObjects = new WeakSet();
  let copiedToken = null;
  let overlayReady = false;

  function safeJsonParse(value) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function normalizeToken(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    const noBearer = trimmed.replace(/^Bearer\s+/i, '');
    return TOKEN_RE.test(noBearer) ? noBearer : '';
  }

  function tokenPreview(token) {
    return `${token.slice(0, 8)}...${token.slice(-6)}`;
  }

  function ensureOverlay() {
    if (overlayReady || !document.body) return;
    overlayReady = true;
    const panel = document.createElement('div');
    panel.id = 'fb-auto-token-panel';
    panel.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:16px',
      'z-index:999999',
      'width:340px',
      'background:#0b1527',
      'color:#e8f0ff',
      'border:1px solid rgba(120,170,255,.25)',
      'border-radius:16px',
      'box-shadow:0 20px 60px rgba(0,0,0,.35)',
      'padding:14px',
      'font:14px/1.5 Segoe UI,Microsoft YaHei,sans-serif'
    ].join(';');
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;">
        <strong>Freebuff Auto Token</strong>
        <button id="fb-auto-close" style="background:transparent;border:none;color:#9fb8e7;cursor:pointer;font-size:16px;">×</button>
      </div>
      <div id="fb-auto-status" style="color:#91a7d3;margin-bottom:10px;">正在自动监听 token...</div>
      <div id="fb-auto-results" style="display:grid;gap:8px;"></div>
      <div style="margin-top:10px;color:#91a7d3;font-size:12px;">登录后若捕获到 token，会自动复制到剪贴板。</div>
    `;
    document.body.appendChild(panel);
    panel.querySelector('#fb-auto-close').addEventListener('click', () => panel.remove());
    renderResults();
  }

  function setStatus(message, isError = false) {
    ensureOverlay();
    const node = document.getElementById('fb-auto-status');
    if (!node) return;
    node.textContent = message;
    node.style.color = isError ? '#ff7f96' : '#91a7d3';
  }

  function copyToken(token) {
    if (!token || copiedToken === token) return;
    copiedToken = token;
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(token);
    } else if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(token).catch(() => {});
    }
    setStatus(`已自动复制 token：${tokenPreview(token)}`);
  }

  function pushResult(source, path, value) {
    const token = normalizeToken(value);
    if (!token) return;
    if (results.some((item) => item.token === token)) return;
    results.push({ source, path, token });
    renderResults();
    copyToken(token);
  }

  function walk(source, path, value) {
    if (value == null) return;

    if (typeof value === 'string') {
      const parsed = safeJsonParse(value);
      if (parsed && typeof parsed === 'object') {
        walk(source, `${path} (json)`, parsed);
      }
      if (KEYWORDS.some((key) => path.toLowerCase().includes(key.toLowerCase()))) {
        pushResult(source, path, value);
      }
      return;
    }

    if (typeof value !== 'object') return;
    if (visitedObjects.has(value)) return;
    visitedObjects.add(value);

    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(source, `${path}[${index}]`, item));
      return;
    }

    Object.entries(value).forEach(([key, child]) => {
      const nextPath = path ? `${path}.${key}` : key;
      if (typeof child === 'string' && KEYWORDS.some((word) => key.toLowerCase().includes(word.toLowerCase()))) {
        pushResult(source, nextPath, child);
      }
      walk(source, nextPath, child);
    });
  }

  function scanStorage(storage, source) {
    try {
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        walk(source, key, storage.getItem(key));
      }
    } catch {}
  }

  function scanCookies() {
    try {
      document.cookie.split(';').map((item) => item.trim()).filter(Boolean).forEach((entry) => {
        const [name, ...rest] = entry.split('=');
        const value = decodeURIComponent(rest.join('=') || '');
        if (KEYWORDS.some((word) => name.toLowerCase().includes(word.toLowerCase()))) {
          pushResult('cookie', name, value);
        }
      });
    } catch {}
  }

  function scanGlobals() {
    const candidates = [
      ['window.__NEXT_DATA__', window.__NEXT_DATA__],
      ['window.__NUXT__', window.__NUXT__],
      ['window.__INITIAL_STATE__', window.__INITIAL_STATE__],
      ['window.__APOLLO_STATE__', window.__APOLLO_STATE__],
      ['window.__pinia', window.__pinia],
      ['window.__store', window.__store],
    ];
    candidates.forEach(([name, value]) => value && walk('global', name, value));
  }

  async function scanIndexedDB() {
    if (!indexedDB.databases) return;
    try {
      const dbs = await indexedDB.databases();
      for (const dbInfo of dbs) {
        if (!dbInfo.name) continue;
        await new Promise((resolve) => {
          const openRequest = indexedDB.open(dbInfo.name);
          openRequest.onerror = () => resolve();
          openRequest.onsuccess = () => {
            const db = openRequest.result;
            const stores = Array.from(db.objectStoreNames || []);
            if (!stores.length) {
              db.close();
              resolve();
              return;
            }
            const tx = db.transaction(stores, 'readonly');
            let pending = stores.length;
            stores.forEach((storeName) => {
              try {
                const store = tx.objectStore(storeName);
                const req = store.getAll();
                req.onsuccess = () => {
                  walk('indexedDB', `${dbInfo.name}.${storeName}`, req.result);
                  pending -= 1;
                  if (!pending) {
                    db.close();
                    resolve();
                  }
                };
                req.onerror = () => {
                  pending -= 1;
                  if (!pending) {
                    db.close();
                    resolve();
                  }
                };
              } catch {
                pending -= 1;
                if (!pending) {
                  db.close();
                  resolve();
                }
              }
            });
          };
        });
      }
    } catch {}
  }

  function renderResults() {
    ensureOverlay();
    const node = document.getElementById('fb-auto-results');
    if (!node) return;
    if (!results.length) {
      node.innerHTML = '<div style="padding:10px;border:1px dashed rgba(120,170,255,.2);border-radius:10px;color:#91a7d3;">暂时没有发现 token，脚本仍在后台自动监听。</div>';
      return;
    }
    node.innerHTML = results.map((item, index) => `
      <div style="padding:10px;border:1px solid rgba(120,170,255,.18);border-radius:10px;background:rgba(255,255,255,.04)">
        <div style="font-weight:600;">${item.source}</div>
        <div style="font-size:12px;color:#91a7d3;word-break:break-all;">${item.path}</div>
        <div style="font-size:12px;color:#bed4ff;">${tokenPreview(item.token)}</div>
        <button data-index="${index}" style="margin-top:8px;padding:8px 10px;border:none;border-radius:10px;cursor:pointer;background:#67a2ff;color:white;">复制这个 token</button>
      </div>
    `).join('');
    node.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => {
        const picked = results[Number(button.dataset.index)];
        if (picked) copyToken(picked.token);
      });
    });
  }

  function hookStorage() {
    const originalLocalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      try {
        if (KEYWORDS.some((word) => String(key).toLowerCase().includes(word.toLowerCase()))) {
          pushResult(this === window.localStorage ? 'localStorage-set' : 'sessionStorage-set', String(key), String(value));
        }
      } catch {}
      return originalLocalSet.apply(this, arguments);
    };
  }

  function hookNetwork() {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      try {
        const request = args[0];
        const init = args[1] || {};
        const headers = new Headers(init.headers || (request && request.headers) || {});
        const auth = headers.get('authorization');
        if (auth) pushResult('fetch-header', 'authorization', auth);
      } catch {}
      const response = await originalFetch.apply(this, args);
      return response;
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open = function () {
      return originalOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.setRequestHeader = function (key, value) {
      try {
        if (String(key).toLowerCase() === 'authorization') {
          pushResult('xhr-header', 'authorization', String(value));
        }
      } catch {}
      return originalSetRequestHeader.apply(this, arguments);
    };
  }

  function bootstrap() {
    hookStorage();
    hookNetwork();
    const startScan = () => {
      ensureOverlay();
      setStatus('正在自动扫描 token...');
      scanStorage(window.localStorage, 'localStorage');
      scanStorage(window.sessionStorage, 'sessionStorage');
      scanCookies();
      scanGlobals();
      scanIndexedDB();
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startScan, { once: true });
    } else {
      startScan();
    }

    setInterval(() => {
      scanStorage(window.localStorage, 'localStorage');
      scanStorage(window.sessionStorage, 'sessionStorage');
      scanGlobals();
    }, 2000);
  }

  bootstrap();
})();
