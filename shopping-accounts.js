(function () {
  'use strict';

  const panel = $('shoppingAccounts');
  const form = $('shoppingAccountForm');
  const provider = $('shoppingProvider');
  const userId = $('shoppingId');
  const password = $('shoppingPassword');
  const passphrase = $('shoppingLock');
  const reveal = $('shoppingReveal');
  const message = $('shoppingStatus');
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let revision = 0;
  let busy = false;

  function access() {
    return curTab === 'site' && window.Cloud?.ready && Cloud.realAdmin() && Cloud.isAdmin();
  }

  function lock() {
    revision++;
    userId.value = password.value = passphrase.value = '';
    password.type = 'password';
    reveal.textContent = '비밀번호 보기';
    reveal.setAttribute('aria-pressed', 'false');
    message.textContent = '';
  }

  function refresh() {
    panel.hidden = !access();
    if (panel.hidden) lock();
  }

  async function deriveKey(phrase, salt) {
    const material = await crypto.subtle.importKey('raw', encoder.encode(phrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' }, material,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }

  async function encrypt(account, phrase, storageKey) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(phrase, salt);
    const data = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(storageKey) }, key, encoder.encode(JSON.stringify(account))
    );
    return JSON.stringify({ salt: [...salt], iv: [...iv], data: [...new Uint8Array(data)] });
  }

  async function decrypt(value, phrase, storageKey) {
    const { salt, iv, data } = JSON.parse(value);
    const key = await deriveKey(phrase, Uint8Array.from(salt));
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: Uint8Array.from(iv), additionalData: encoder.encode(storageKey) }, key, Uint8Array.from(data)
    );
    return JSON.parse(decoder.decode(plaintext));
  }

  async function useAccount(write) {
    if (busy || !access() || !provider.reportValidity()) return;
    if (!window.crypto?.subtle) { message.textContent = 'HTTPS 환경에서 보관함을 사용할 수 있습니다.'; return; }
    if (!passphrase.reportValidity()) return;
    const account = { id: userId.value.trim(), password: password.value };
    const phrase = passphrase.value;
    if (write && (!account.id || !account.password || account.password === phrase)) {
      message.textContent = '학교 아이디와 비밀번호를 입력하고, 별도의 잠금 암호를 사용하세요.';
      return;
    }
    const uid = Cloud.user.uid;
    const storageKey = 'shopping-account:v1:' + uid + ':' + provider.value;
    lock();
    const currentRevision = revision;
    const current = () => revision === currentRevision && access() && Cloud.user.uid === uid;
    busy = true;
    try {
      const previous = localStorage.getItem(storageKey);
      if (!write && !previous) { message.textContent = '이 브라우저에 저장된 계정이 없습니다.'; return; }
      const saved = previous ? await decrypt(previous, phrase, storageKey) : null;
      if (!current()) return;
      if (write) {
        const encrypted = await encrypt(account, phrase, storageKey);
        if (!current()) return;
        if (localStorage.getItem(storageKey) !== previous) {
          message.textContent = '다른 탭에서 계정 정보가 바뀌었습니다. 다시 열어 주세요.';
          return;
        }
        localStorage.setItem(storageKey, encrypted);
        message.textContent = '이 브라우저에 암호화해 저장했습니다.';
      } else {
        userId.value = saved.id;
        password.value = saved.password;
        message.textContent = '저장한 계정을 열었습니다.';
      }
    } catch (error) {
      if (current()) message.textContent = error.name === 'QuotaExceededError' || error.name === 'SecurityError'
        ? '브라우저에 계정을 저장하거나 읽을 수 없습니다.'
        : '보관함을 처리하지 못했습니다. 잠금 암호를 확인해 주세요.';
    } finally { busy = false; }
  }

  form.addEventListener('submit', event => { event.preventDefault(); useAccount(true); });
  $('shoppingUnlock').addEventListener('click', () => useAccount(false));
  $('shoppingClear').addEventListener('click', lock);
  provider.addEventListener('change', lock);
  reveal.addEventListener('click', () => {
    if (!access() || !password.value) return;
    const visible = password.type === 'password';
    password.type = visible ? 'text' : 'password';
    reveal.setAttribute('aria-pressed', String(visible));
    reveal.textContent = visible ? '비밀번호 가리기' : '비밀번호 보기';
  });
  document.addEventListener('cloud-change', () => { lock(); refresh(); });
  window.addEventListener('pagehide', lock);
  window.ShoppingAccounts = { lock, refresh };
})();
