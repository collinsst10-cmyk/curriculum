/* =========================================================
 * 홈페이지 관리 (관리자): HOME 대표 사진 슬라이드
 *  - heroPhotos/{id} { data: 'data:image/jpeg;base64,…', order, createdAt }
 *    사진은 올릴 때 브라우저에서 줄여(가로 최대 1920px, 약 0.9MB 이하) Firestore 문서에 그대로 저장
 *    (별도 파일 저장소 없이 무료 요금제에서 동작)
 *  - config/site { interval }  사진이 바뀌는 간격(초)
 *  - 등록한 사진이 없으면 기본 사진(assets/hero-kids.jpg)
 * ========================================================= */
(function () {
  'use strict';
  const MAX = 10, MAX_CHARS = 950000;
  let photos = [], interval = 6, unsubP = null, unsubS = null, timer = null, idx = 0;
  const defaultSites = [
    { id: 'coupang', name: '쿠팡', url: 'https://www.coupang.com/' },
    { id: 'iscreammall', name: '아이스크림몰', url: 'https://i-screammall.co.kr/' },
  ];
  let purchaseSites = defaultSites;
  let editingSite = null;
  let savingSite = false;

  const isAdm = () => !!(window.Cloud && Cloud.ready && Cloud.isAdmin());
  TAB_GUARDS.site = () => isAdm();
  const col = () => Cloud.fb.F.collection(Cloud.fb.db, 'heroPhotos');

  function subscribe() {
    [unsubP, unsubS].forEach(u => u && u()); unsubP = unsubS = null; photos = [];
    if (!window.Cloud || !Cloud.ready) { purchaseSites = defaultSites; renderPurchaseLinks(); buildSlides(); return; }
    const F = Cloud.fb.F;
    unsubP = F.onSnapshot(F.query(col(), F.orderBy('order')), s => {
      photos = s.docs.map(d => ({ id: d.id, ...d.data() }));
      buildSlides(); if (curTab === 'site') renderAdmin();
    }, e => { console.warn('홈 사진 불러오기 실패', e); buildSlides(); });
    unsubS = F.onSnapshot(F.doc(Cloud.fb.db, 'config', 'site'), d => {
      interval = Math.min(30, Math.max(3, Number(d.data()?.interval) || 6));
      purchaseSites = readSites(d.data());
      renderPurchaseLinks();
      startTimer(); if (curTab === 'site') renderAdmin();
    }, () => {});
  }

  /* ---------- HOME 슬라이드 ---------- */
  function buildSlides() {
    const box = document.querySelector('.hx-photo');
    if (!box) return;
    box.classList.toggle('has-slides', photos.length > 0);
    box.innerHTML = photos.map((p, i) => `<div class="hx-slide${i === 0 ? ' on' : ''}" style="background-image:url('${p.data}')"></div>`).join('') +
      (photos.length > 1 ? `<div class="hx-dots">${photos.map((_, i) => `<button type="button" class="${i === 0 ? 'on' : ''}" data-slide="${i}" aria-label="${i + 1}번째 사진"></button>`).join('')}</div>` : '');
    idx = 0; startTimer();
  }
  function show(i) {
    const slides = document.querySelectorAll('.hx-photo .hx-slide');
    if (!slides.length) return;
    idx = (i + slides.length) % slides.length;
    slides.forEach((s, k) => s.classList.toggle('on', k === idx));
    document.querySelectorAll('.hx-photo .hx-dots button').forEach((b, k) => b.classList.toggle('on', k === idx));
  }
  function startTimer() {
    clearInterval(timer); timer = null;
    if (photos.length > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) timer = setInterval(() => { if (!document.hidden) show(idx + 1); }, interval * 1000);
  }
  document.addEventListener('click', e => { const b = e.target.closest('.hx-dots [data-slide]'); if (b) { show(Number(b.dataset.slide)); startTimer(); } });

  /* ---------- 사진 줄이기 ---------- */
  function loadImage(file) {
    return new Promise((res, rej) => { const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); }; img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('이미지를 읽을 수 없습니다')); }; img.src = url; });
  }
  async function shrink(file) {
    const img = await loadImage(file);
    let scale = Math.min(1, 1920 / img.naturalWidth, 1280 / img.naturalHeight), q = 0.85, data = '';
    for (let tries = 0; tries < 8; tries++) {
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      data = c.toDataURL('image/jpeg', q);
      if (data.length <= MAX_CHARS) return data;
      if (q > 0.6) q -= 0.1; else scale *= 0.85;
    }
    throw new Error('사진이 너무 큽니다');
  }

  /* ---------- 관리 화면 ---------- */
  function safeLink(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password ? url : null;
    } catch { return null; }
  }

  function readSites(config) {
    const list = Array.isArray(config?.purchaseSites) ? config.purchaseSites : defaultSites;
    return list.filter(site => site && typeof site.id === 'string' && typeof site.name === 'string' && safeLink(site.url));
  }

  function renderPurchaseLinks() {
    const links = purchaseSites.map(site => {
      const link = document.createElement('a');
      const name = document.createElement('strong');
      const address = document.createElement('span');
      const url = safeLink(site.url);
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      name.textContent = site.name;
      address.textContent = url.hostname;
      link.append(name, address);
      return link;
    });
    if (!links.length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = '등록된 구입 사이트가 없습니다.';
      links.push(empty);
    }
    $('schoolPurchaseLinks').replaceChildren(...links);
  }

  function renderPurchaseAdmin() {
    const provider = $('shoppingProvider');
    const selected = provider.value;
    provider.replaceChildren(new Option('사이트를 선택하세요', ''), ...purchaseSites.map(site => new Option(site.name, site.id)));
    provider.value = purchaseSites.some(site => site.id === selected) ? selected : '';
    if (provider.value !== selected) window.ShoppingAccounts?.lock();
    const rows = purchaseSites.map(site => {
      const row = document.createElement('li');
      const name = document.createElement('strong');
      const address = document.createElement('small');
      name.textContent = site.name;
      address.textContent = site.url;
      row.append(name, address);
      for (const [action, label] of [['edit', '수정'], ['remove', '삭제']]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn small';
        button.dataset.siteAction = action;
        button.dataset.siteId = site.id;
        button.textContent = label;
        row.append(button);
      }
      return row;
    });
    $('purchaseSiteList').replaceChildren(...rows);
  }

  function resetPurchaseForm() {
    editingSite = null;
    $('purchaseSiteForm').reset();
    $('purchaseSiteSave').textContent = '사이트 추가';
    $('purchaseSiteReset').hidden = true;
  }

  async function changePurchaseSites(update, message) {
    if (savingSite || !isAdm()) return;
    savingSite = true;
    $('purchaseSiteSave').disabled = true;
    try {
      const { F, db } = Cloud.fb;
      const ref = F.doc(db, 'config', 'site');
      await F.runTransaction(db, async tx => {
        const snap = await tx.get(ref);
        tx.set(ref, { purchaseSites: update(readSites(snap.data())) }, { merge: true });
      });
      $('purchaseSiteStatus').textContent = message;
      resetPurchaseForm();
    } catch (error) {
      $('purchaseSiteStatus').textContent = '저장 실패. ' + error.message;
    } finally {
      savingSite = false;
      $('purchaseSiteSave').disabled = false;
    }
  }

  $('purchaseSiteForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('purchaseSiteName').value.trim();
    const url = safeLink($('purchaseSiteUrl').value.trim());
    if (!name || !url) { $('purchaseSiteStatus').textContent = '사이트 이름과 https:// 주소를 입력하세요.'; return; }
    const editing = editingSite;
    const entry = { id: editing || crypto.randomUUID(), name, url: url.href };
    changePurchaseSites(list => {
      if (editing) {
        if (!list.some(site => site.id === editing)) throw new Error('이 사이트가 이미 삭제됐습니다.');
        return list.map(site => site.id === editing ? entry : site);
      }
      if (list.length >= 30) throw new Error('사이트는 30개까지 등록할 수 있습니다.');
      return [...list, entry];
    }, '학교 정보의 물품 구입 메뉴에 반영했습니다.');
  });
  $('purchaseSiteReset').addEventListener('click', resetPurchaseForm);
  $('purchaseSiteList').addEventListener('click', e => {
    const button = e.target.closest('[data-site-action]');
    if (!button || !isAdm() || savingSite) return;
    const site = purchaseSites.find(item => item.id === button.dataset.siteId);
    if (!site) return;
    if (button.dataset.siteAction === 'edit') {
      editingSite = site.id;
      $('purchaseSiteName').value = site.name;
      $('purchaseSiteUrl').value = site.url;
      $('purchaseSiteSave').textContent = '수정 저장';
      $('purchaseSiteReset').hidden = false;
      $('purchaseSiteName').focus();
    } else if (confirm(site.name + ' 바로가기를 삭제할까요?')) {
      changePurchaseSites(list => list.filter(item => item.id !== site.id), '바로가기를 삭제했습니다.');
    }
  });
  window.PurchaseSites = { renderLinks: renderPurchaseLinks };
  function renderAdmin() {
    if (!isAdm()) return;
    renderPurchaseAdmin();
    $('siteInterval').value = String(interval);
    $('siteCount').textContent = `${photos.length} / ${MAX}장`;
    $('siteUpload').disabled = photos.length >= MAX;
    $('sitePhotos').innerHTML = photos.length ? photos.map((p, i) => `<li>
        <img src="${p.data}" alt="${i + 1}번째 사진">
        <div class="sp-bar"><span>${i + 1}</span>
          <button type="button" class="btn small" data-move="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="앞으로">◀</button>
          <button type="button" class="btn small" data-move="${i}" data-dir="1" ${i === photos.length - 1 ? 'disabled' : ''} aria-label="뒤로">▶</button>
          <button type="button" class="btn small danger" data-del="${p.id}">삭제</button></div></li>`).join('')
      : '<li class="empty">등록한 사진이 없어 기본 사진이 나옵니다.</li>';
  }

  async function upload(files) {
    const F = Cloud.fb.F, room = MAX - photos.length;
    const list = [...files].filter(f => f.type.startsWith('image/')).slice(0, room);
    if (!list.length) { $('siteStatus').textContent = room ? '사진 파일을 골라 주세요.' : `사진은 ${MAX}장까지 등록할 수 있습니다.`; return; }
    let done = 0, last = photos.length ? photos[photos.length - 1].order : 0;
    for (const f of list) {
      $('siteStatus').textContent = `올리는 중… (${done + 1}/${list.length}) ${f.name}`;
      try { const data = await shrink(f); last = Math.max(last + 1, Date.now()); await F.addDoc(col(), { data, order: last, createdAt: F.serverTimestamp() }); done++; }
      catch (e) { $('siteStatus').textContent = `${f.name}: ${e.message}`; return; }
    }
    $('siteStatus').textContent = `${done}장을 등록했습니다. HOME에 바로 반영됩니다.`;
    $('siteFile').value = '';
  }
  async function move(i, dir) {
    const j = i + dir; if (j < 0 || j >= photos.length) return;
    const F = Cloud.fb.F, a = photos[i], b = photos[j];
    const batch = F.writeBatch(Cloud.fb.db);
    batch.update(F.doc(col(), a.id), { order: b.order }); batch.update(F.doc(col(), b.id), { order: a.order });
    await batch.commit();
  }

  $('siteUpload').addEventListener('click', () => $('siteFile').click());
  $('siteFile').addEventListener('change', e => { if (isAdm() && e.target.files.length) upload(e.target.files); });
  $('sitePhotos').addEventListener('click', async e => {
    if (!isAdm()) return;
    const m = e.target.closest('[data-move]');
    if (m) { try { await move(Number(m.dataset.move), Number(m.dataset.dir)); } catch (err) { $('siteStatus').textContent = '순서 변경 실패: ' + err.message; } return; }
    const d = e.target.closest('[data-del]');
    if (d && confirm('이 사진을 홈 화면에서 삭제할까요?')) {
      try { await Cloud.fb.F.deleteDoc(Cloud.fb.F.doc(col(), d.dataset.del)); $('siteStatus').textContent = '삭제했습니다.'; }
      catch (err) { $('siteStatus').textContent = '삭제 실패: ' + err.message; }
    }
  });
  $('siteInterval').addEventListener('change', async e => {
    if (!isAdm()) return;
    try { await Cloud.fb.F.setDoc(Cloud.fb.F.doc(Cloud.fb.db, 'config', 'site'), { interval: Number(e.target.value) }, { merge: true }); $('siteStatus').textContent = '바뀌는 간격을 저장했습니다.'; }
    catch (err) { $('siteStatus').textContent = '저장 실패: ' + err.message; }
  });
  // 끌어다 놓기
  const drop = $('siteDrop');
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { if (isAdm() && e.dataTransfer.files.length) upload(e.dataTransfer.files); });

  RENDER.site = renderAdmin;
  document.addEventListener('cloud-change', subscribe);
  if (window.Cloud && Cloud.ready) subscribe();
})();
