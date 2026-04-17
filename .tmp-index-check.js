
    const STORAGE_KEY = 'freebuff2api.accounts';
    const ACCESS_STORAGE_KEY = 'freebuff2api.access-password';
    const POLL_INTERVAL_MS = 3000;
    const POLL_TIMEOUT_MS = 5 * 60 * 1000;

    const gateWrap = document.getElementById('gateWrap');
    const appRoot = document.getElementById('appRoot');
    const accessPasswordInput = document.getElementById('accessPassword');
    const unlockBtn = document.getElementById('unlockBtn');
    const gateStatusNode = document.getElementById('gateStatus');
    const modelSelect = document.getElementById('model');
    const promptInput = document.getElementById('prompt');
    const submitButton = document.getElementById('submit');
    const statusNode = document.getElementById('status');
    const resultNode = document.getElementById('result');
    const usedAccountNode = document.getElementById('usedAccount');
    const loginBtn = document.getElementById('loginBtn');
    const clearAccountsBtn = document.getElementById('clearAccountsBtn');
    const loginStatusNode = document.getElementById('loginStatus');
    const accountListNode = document.getElementById('accountList');
    const rotationStrategySelect = document.getElementById('rotationStrategy');
    const fixedAccountSelect = document.getElementById('fixedAccount');

    let accounts = loadAccounts();
    let loginPolling = null;
    let accessPassword = sessionStorage.getItem(ACCESS_STORAGE_KEY) || '';
    let accessEnabled = false;

    function openPendingLoginWindow() {
      return window.open('', '_blank', 'noopener,noreferrer');
    }

    function loadAccounts() {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      } catch {
        return [];
      }
    }

    function saveAccounts() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
    }

    function setStatus(node, text, type = '') {
      node.textContent = text;
      node.className = `status${type ? ` ${type}` : ''}`;
    }

    function upsertAccount(account) {
      const index = accounts.findIndex((item) => item.email && item.email === account.email);
      if (index >= 0) {
        accounts[index] = account;
      } else {
        accounts.push(account);
      }
      saveAccounts();
      renderAccounts();
    }

    function removeAccount(index) {
      accounts.splice(index, 1);
      saveAccounts();
      renderAccounts();
    }

    function clearAccounts() {
      accounts = [];
      saveAccounts();
      renderAccounts();
      setStatus(loginStatusNode, '鏈湴璐﹀彿姹犲凡娓呯┖銆?, 'success');
    }

    function renderAccounts() {
      if (!accounts.length) {
        accountListNode.innerHTML = '<div class="empty">鏆傛棤璐﹀彿锛屽厛鐐逛笂闈㈢殑鈥滄柊澧?GitHub 鐧诲綍璐﹀彿鈥濄€?/div>';
        fixedAccountSelect.innerHTML = '<option value="0">鏆傛棤璐﹀彿</option>';
        return;
      }

      accountListNode.innerHTML = accounts.map((account, index) => `
        <div class="account-item">
          <div class="account-top">
            <div>
              <div class="name">${escapeHtml(account.name || '鏈懡鍚嶈处鍙?)}</div>
              <div class="muted">${escapeHtml(account.email || '鏃犻偖绠?)}</div>
            </div>
            <button class="ghost" data-remove-index="${index}">绉婚櫎</button>
          </div>
          <div class="chips">
            <span class="chip">#${index + 1}</span>
            <span class="chip">${escapeHtml(account.tokenPreview || '鏃?Token')}</span>
          </div>
        </div>
      `).join('');

      fixedAccountSelect.innerHTML = accounts.map((account, index) => `
        <option value="${index}">${escapeHtml(account.name || account.email || `璐﹀彿 ${index + 1}`)}</option>
      `).join('');

      document.querySelectorAll('[data-remove-index]').forEach((button) => {
        button.addEventListener('click', () => removeAccount(Number(button.dataset.removeIndex)));
      });
    }

    function escapeHtml(text) {
      return String(text)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    async function loadModels() {
      setStatus(statusNode, '姝ｅ湪鍔犺浇妯″瀷鍒楄〃鈥?);
      try {
        const response = await fetch('/api/v1/models');
        const data = await response.json();
        const models = data.data || [];
        modelSelect.innerHTML = models.map((item) => `<option value="${item.id}">${item.id}</option>`).join('');
        setStatus(statusNode, `宸插姞杞?${models.length} 涓ā鍨媊, 'success');
      } catch (error) {
        setStatus(statusNode, `妯″瀷鍔犺浇澶辫触锛?{error.message}`, 'error');
      }
    }

    function revealApp() {
      gateWrap.classList.add('hidden');
      appRoot.classList.remove('hidden');
      renderAccounts();
      loadModels();
    }

    async function bootstrapAccess() {
      try {
        const response = await fetch('/api/health');
        const data = await response.json();
        accessEnabled = Boolean(data.accessPasswordEnabled);

        if (!accessEnabled) {
          revealApp();
          return;
        }

        gateWrap.classList.remove('hidden');
        if (accessPassword) {
          accessPasswordInput.value = accessPassword;
          await unlock();
        }
      } catch (error) {
        gateWrap.classList.remove('hidden');
        setStatus(gateStatusNode, `鍒濆鍖栧け璐ワ細${error.message}`, 'error');
      }
    }

    async function unlock() {
      const password = accessPasswordInput.value;
      unlockBtn.disabled = true;
      setStatus(gateStatusNode, '姝ｅ湪楠岃瘉瀵嗙爜鈥?);

      try {
        const response = await fetch('/api/auth/access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        const data = await response.json();

        if (!response.ok || !data.passed) {
          throw new Error(data?.error?.message || '瀵嗙爜閿欒');
        }

        accessPassword = password;
        sessionStorage.setItem(ACCESS_STORAGE_KEY, accessPassword);
        setStatus(gateStatusNode, '楠岃瘉閫氳繃锛屾鍦ㄨ繘鍏ョ郴缁熴€?, 'success');
        revealApp();
      } catch (error) {
        setStatus(gateStatusNode, error.message, 'error');
      } finally {
        unlockBtn.disabled = false;
      }
    }

    async function startLogin() {
      if (loginPolling) {
        setStatus(loginStatusNode, '已经有登录流程在进行中。', 'error');
        return;
      }

      const popup = openPendingLoginWindow();
      loginBtn.disabled = true;
      setStatus(loginStatusNode, '正在申请登录链接…');

      try {
        const response = await fetch('/api/auth/login/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: accessPassword }),
        });
        const data = await response.json();
        if (!response.ok) {
          if (popup && !popup.closed) {
            popup.close();
          }
          throw new Error(data?.error?.message || '登录启动失败');
        }

        if (!popup) {
          throw new Error('浏览器拦截了登录弹窗，请允许弹窗后重试。登录地址：' + data.loginUrl);
        }

        popup.location.href = data.loginUrl;
        setStatus(loginStatusNode, '登录页面已打开，请在新窗口完成 GitHub 登录授权。', 'success');
        loginPolling = pollLoginStatus(data);
        await loginPolling;
      } catch (error) {
        try {
          if (popup && !popup.closed && popup.location.href === 'about:blank') {
            popup.close();
          }
        } catch {}
        setStatus(loginStatusNode, '登录失败：' + error.message, 'error');
      } finally {
        loginPolling = null;
        loginBtn.disabled = false;
      }
    }

    async function pollLoginStatus(payload) {
      const startedAt = Date.now();

      while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
        const query = new URLSearchParams({ ...payload, accessPassword }).toString();
        const response = await fetch(`/api/auth/login/status?${query}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.error?.message || '杞鐘舵€佸け璐?);
        }

        if (data.authorized && data.rawAccount) {
          upsertAccount(data.rawAccount);
          setStatus(loginStatusNode, `璐﹀彿 ${data.account?.email || data.account?.name || '鏈煡鐢ㄦ埛'} 鐧诲綍鎴愬姛锛屽凡鍔犲叆璐﹀彿姹犮€俙, 'success');
          return;
        }

        setStatus(loginStatusNode, '绛夊緟浣犲湪 GitHub 椤甸潰瀹屾垚鐧诲綍鈥?);
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }

      throw new Error('鐧诲綍杞瓒呮椂');
    }

    async function runChat() {
      const prompt = promptInput.value.trim();
      if (!prompt) {
        setStatus(statusNode, '鍏堣緭鍏ョ偣鍐呭锛屽埆璁╂帴鍙ｉ櫔浣犲彂鍛嗐€?, 'error');
        return;
      }
      if (!accounts.length) {
        setStatus(statusNode, '鍏堣嚦灏戠櫥褰曚竴涓处鍙枫€?, 'error');
        return;
      }

      submitButton.disabled = true;
      usedAccountNode.textContent = '璇锋眰澶勭悊涓?;
      setStatus(statusNode, '璇锋眰鍙戦€佷腑鈥?);
      resultNode.textContent = '鎬濊€冧腑鈥?;

      try {
        const strategy = rotationStrategySelect.value;
        const response = await fetch('/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelSelect.value,
            messages: [{ role: 'user', content: prompt }],
            stream: false,
            rotationStrategy: strategy,
            accountIndex: Number(fixedAccountSelect.value || 0),
            accounts,
            accessPassword,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error?.message || '璇锋眰澶辫触');
        }

        resultNode.textContent = data?.choices?.[0]?.message?.content || JSON.stringify(data, null, 2);
        const account = data.account || {};
        usedAccountNode.textContent = `${account.strategy === 'fixed' ? '鍥哄畾' : '杞'} 路 ${account.email || account.name || '鏈煡璐﹀彿'}`;
        setStatus(statusNode, `璇锋眰瀹屾垚锛屼娇鐢ㄨ处鍙峰簭鍙?${Number(account.index) + 1}`, 'success');
      } catch (error) {
        resultNode.textContent = error.message;
        usedAccountNode.textContent = '璇锋眰澶辫触';
        setStatus(statusNode, '璇锋眰澶辫触', 'error');
      } finally {
        submitButton.disabled = false;
      }
    }

    unlockBtn.addEventListener('click', unlock);
    accessPasswordInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        unlock();
      }
    });
    loginBtn.addEventListener('click', startLogin);
    clearAccountsBtn.addEventListener('click', clearAccounts);
    submitButton.addEventListener('click', runChat);
    promptInput.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        runChat();
      }
    });

    bootstrapAccess();
  
