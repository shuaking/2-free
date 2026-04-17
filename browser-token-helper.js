(function () {
  const KEYWORDS = ['authToken', 'auth_token', 'token', 'accessToken', 'access_token', 'bearer', 'authorization'];
  const seen = new WeakSet();
  const results = [];

  function safeJsonParse(value) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function isTokenLike(value) {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (/^Bearer\s+/i.test(trimmed)) return true;
    if (trimmed.length >= 24 && /[A-Za-z0-9._-]{20,}/.test(trimmed)) return true;
    return false;
  }

  function pushResult(source, path, value) {
    if (!isTokenLike(value)) return;
    const normalized = String(value).trim().replace(/^Bearer\s+/i, '');
    if (!normalized) return;
    if (results.some((item) => item.token === normalized)) return;
    results.push({ source, path, token: normalized });
  }

  function walk(source, path, value) {
    if (value == null) return;

    if (typeof value === 'string') {
      const parsed = safeJsonParse(value);
      if (parsed && typeof parsed === 'object') {
        walk(source, path + ' (json)', parsed);
      }
      if (KEYWORDS.some((key) => path.toLowerCase().includes(key.toLowerCase()))) {
        pushResult(source, path, value);
      }
      return;
    }

    if (typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);

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
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      const value = storage.getItem(key);
      walk(source, key, value);
    }
  }

  function scanCookies() {
    document.cookie.split(';').map((item) => item.trim()).filter(Boolean).forEach((entry) => {
      const [name, ...rest] = entry.split('=');
      const value = rest.join('=');
      if (KEYWORDS.some((word) => name.toLowerCase().includes(word.toLowerCase()))) {
        pushResult('cookie', name, decodeURIComponent(value || ''));
      }
    });
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

    candidates.forEach(([name, value]) => {
      if (value) walk('global', name, value);
    });
  }

  function printResults() {
    if (!results.length) {
      console.warn('[Freebuff Token Helper] 没有直接找到 token。');
      console.warn('[Freebuff Token Helper] 你可以先保持本页打开，执行 enableNetworkCapture() 后刷新页面再观察请求头。');
      return;
    }

    console.log('[Freebuff Token Helper] 找到以下候选 token：');
    console.table(results.map((item, index) => ({
      index,
      source: item.source,
      path: item.path,
      preview: `${item.token.slice(0, 8)}...${item.token.slice(-6)}`,
    })));

    window.__FREEBUFF_TOKEN_RESULTS__ = results;
    window.copyFreebuffToken = function copyFreebuffToken(index = 0) {
      const picked = results[index];
      if (!picked) {
        console.error('[Freebuff Token Helper] 无效索引:', index);
        return;
      }
      copy(picked.token);
      console.log('[Freebuff Token Helper] 已复制 token，来源:', picked.source, '路径:', picked.path);
      return picked.token;
    };

    console.log('[Freebuff Token Helper] 运行 copyFreebuffToken(0) 可复制第一个候选 token。');
  }

  window.enableNetworkCapture = function enableNetworkCapture() {
    if (window.__FREEBUFF_CAPTURE_ENABLED__) {
      console.log('[Freebuff Token Helper] 网络抓取已经启用。');
      return;
    }
    window.__FREEBUFF_CAPTURE_ENABLED__ = true;

    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const request = args[0];
      const init = args[1] || {};
      const headers = new Headers(init.headers || (request && request.headers) || {});
      const auth = headers.get('authorization');
      if (auth) {
        pushResult('fetch-header', 'authorization', auth);
        printResults();
      }
      return originalFetch.apply(this, args);
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open = function (...args) {
      this.__freebuffHeaders = {};
      return originalOpen.apply(this, args);
    };
    XMLHttpRequest.prototype.setRequestHeader = function (key, value) {
      this.__freebuffHeaders = this.__freebuffHeaders || {};
      this.__freebuffHeaders[key.toLowerCase()] = value;
      if (key.toLowerCase() === 'authorization') {
        pushResult('xhr-header', 'authorization', value);
        printResults();
      }
      return originalSetRequestHeader.apply(this, arguments);
    };

    console.log('[Freebuff Token Helper] 已启用网络抓取。请刷新页面或执行一次站内请求。');
  };

  try {
    scanStorage(window.localStorage, 'localStorage');
    scanStorage(window.sessionStorage, 'sessionStorage');
    scanCookies();
    scanGlobals();
    printResults();
  } catch (error) {
    console.error('[Freebuff Token Helper] 执行失败:', error);
  }
})();
