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
  let purchaseSites = [], legacySites = defaultSites, unsubPurchase = null, purchaseLoaded = false;
  let privateSites = null, purchaseLoadFailed = false;
  let purchaseSubscription = 0;
  const canReadPurchase = () => !!window.Cloud?.ready && !Cloud.isGeneral && !App.locked();
  const purchaseRef = (id = 'catalog') => Cloud.fb.F.doc(Cloud.fb.db, 'shoppingSites', id);
  let editingSite = null;
  let savingSite = false;

  const isAdm = () => !!(window.Cloud && Cloud.ready && Cloud.isAdmin());
  TAB_GUARDS.site = () => isAdm();
  const col = () => Cloud.fb.F.collection(Cloud.fb.db, 'heroPhotos');

  function subscribe() {
    [unsubP, unsubS].forEach(u => u && u()); unsubP = unsubS = null; photos = [];
    const subscription = ++purchaseSubscription;
    unsubPurchase?.();
    unsubPurchase = null;
    privateSites = null;
    legacySites = defaultSites;
    purchaseSites = [];
    purchaseLoaded = false;
    purchaseLoadFailed = false;
    resetPurchaseForm();
    $('purchaseCopyStatus').textContent = '';
    $('purchaseSiteStatus').textContent = '';
    renderPurchaseLinks();
    if (!window.Cloud || !Cloud.ready) { buildSlides(); return; }
    if (canReadPurchase()) {
      unsubPurchase = Cloud.fb.F.onSnapshot(purchaseRef(isAdm() ? 'catalog' : 'active'), { includeMetadataChanges: true }, snap => {
        if (subscription !== purchaseSubscription || !canReadPurchase() || snap.metadata.fromCache) return;
        privateSites = snap.exists() ? readSites(snap.data()?.sites) : null;
        purchaseLoaded = true;
        refreshPurchase();
      }, () => {
        if (subscription !== purchaseSubscription) return;
        purchaseLoaded = false;
        purchaseLoadFailed = true;
        privateSites = null;
        purchaseSites = [];
        renderPurchaseLinks();
        if (isAdm()) renderPurchaseAdmin();
      });
    }
    const F = Cloud.fb.F;
    unsubP = F.onSnapshot(F.query(col(), F.orderBy('order')), s => {
      photos = s.docs.map(d => ({ id: d.id, ...d.data() }));
      buildSlides(); if (curTab === 'site') renderAdmin();
    }, e => { console.warn('홈 사진 불러오기 실패', e); buildSlides(); });
    unsubS = F.onSnapshot(F.doc(Cloud.fb.db, 'config', 'site'), d => {
      interval = Math.min(30, Math.max(3, Number(d.data()?.interval) || 6));
      legacySites = readSites(d.data()?.purchaseSites ?? defaultSites);
      refreshPurchase();
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

  function readSites(list) {
    return (Array.isArray(list) ? list : [])
      .filter(site => site && typeof site.id === 'string' && typeof site.name === 'string' && safeLink(site.url))
      .map((site, index) => ({ ...site, order: site.order ?? index + 1, active: site.active !== false }))
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ko'));
  }

  function refreshPurchase() {
    purchaseSites = canReadPurchase() && purchaseLoaded ? privateSites ?? legacySites : [];
    renderPurchaseLinks();
    if (isAdm()) renderPurchaseAdmin();
  }

  function credentialRow(label, value) {
    const row = document.createElement('div');
    row.className = 'purchase-credential';
    const title = document.createElement('small');
    title.textContent = label;
    const code = document.createElement('code');
    code.textContent = value || '미등록';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn small';
    button.textContent = label + ' 복사';
    button.prepend(outlineIcon('copy'));
    button.disabled = !value;
    button.addEventListener('click', async () => {
      if (!canReadPurchase()) return;
      const status = $('purchaseCopyStatus');
      try {
        await navigator.clipboard.writeText(value);
        status.textContent = label + '를 복사했습니다.';
        button.classList.add('is-copied');
        setTimeout(() => button.classList.remove('is-copied'), 1200);
      } catch { status.textContent = '복사하지 못했습니다. 값을 선택해 직접 복사해 주세요.'; }
    });
    row.append(title, code, button);
    return row;
  }

  function outlineIcon(kind) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.75');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', kind === 'copy' ? 'M9 9h11v11H9z M5 15H4V4h11v1'
      : 'M4 9h16l-1 11H5L4 9z M9 10V6a3 3 0 0 1 6 0v4');
    svg.append(path);
    return svg;
  }

  function renderPurchaseLinks() {
    const cards = purchaseSites.filter(site => site.active).map(site => {
      const card = document.createElement('article');
      card.className = 'purchase-card';
      const title = document.createElement('h3');
      title.textContent = site.name;
      const header = document.createElement('header');
      const details = document.createElement('div');
      details.append(title);
      header.append(outlineIcon('store'), details);
      card.append(header);
      if (site.purpose) {
        const purpose = document.createElement('p');
        purpose.className = 'hint';
        purpose.textContent = site.purpose;
        details.append(purpose);
      }
      const credentials = document.createElement('div');
      credentials.className = 'purchase-credentials';
      credentials.append(credentialRow('ID', site.loginId), credentialRow('PW', site.password));
      card.append(credentials);
      if (site.notes) {
        const notes = document.createElement('p');
        notes.className = 'purchase-notes';
        notes.textContent = site.notes;
        card.append(notes);
      }
      const link = document.createElement('a');
      link.className = 'btn primary small';
      link.href = safeLink(site.url).href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = '사이트 바로가기 ↗';
      card.append(link);
      return card;
    });
    if (!cards.length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = !canReadPurchase() ? '교내 교직원만 물품 구입 정보를 볼 수 있습니다.'
        : purchaseLoadFailed ? '물품 구입 정보를 불러오지 못했습니다.'
          : purchaseLoaded ? '등록된 구입 사이트가 없습니다.' : '물품 구입 정보를 확인하는 중입니다.';
      cards.push(empty);
    }
    $('schoolPurchaseLinks').replaceChildren(...cards);
  }

  function renderPurchaseAdmin() {
    $('purchaseSiteSave').disabled = !purchaseLoaded || savingSite;
    const rows = purchaseSites.map(site => {
      const row = document.createElement('li');
      const name = document.createElement('strong');
      const address = document.createElement('small');
      name.textContent = site.order + '. ' + site.name + (site.active ? '' : ' (사용 안 함)');
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
    $('purchaseSiteOrder').value = Math.min(999, (purchaseSites.at(-1)?.order || 0) + 1);
    $('purchaseSiteSave').textContent = '사이트 추가';
    $('purchaseSiteReset').hidden = true;
  }

  async function changePurchaseSites(update, message) {
    if (savingSite || !isAdm() || !purchaseLoaded) return;
    savingSite = true;
    $('purchaseSiteSave').disabled = true;
    try {
      const { F, db } = Cloud.fb;
      const ref = purchaseRef();
      await F.runTransaction(db, async tx => {
        const snap = await tx.get(ref);
        const list = snap.exists() ? readSites(snap.data()?.sites)
          : readSites((await tx.get(F.doc(db, 'config', 'site'))).data()?.purchaseSites ?? defaultSites);
        const sites = update(list);
        tx.set(ref, { sites });
        tx.set(purchaseRef('active'), { sites: sites.filter(site => site.active) });
      });
      $('purchaseSiteStatus').textContent = message;
      resetPurchaseForm();
    } catch {
      $('purchaseSiteStatus').textContent = '변경을 저장하지 못했습니다. 목록을 확인하고 다시 시도해 주세요.';
    } finally {
      savingSite = false;
      $('purchaseSiteSave').disabled = !purchaseLoaded;
    }
  }

  $('purchaseSiteForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('purchaseSiteName').value.trim();
    const url = safeLink($('purchaseSiteUrl').value.trim());
    if (!name || !url) { $('purchaseSiteStatus').textContent = '사이트 이름과 https:// 주소를 입력하세요.'; return; }
    const editing = editingSite;
    const entry = { id: editing || crypto.randomUUID(), name, url: url.href,
      loginId: $('purchaseSiteId').value.trim(), password: $('purchaseSitePw').value,
      purpose: $('purchaseSitePurpose').value.trim(), notes: $('purchaseSiteNotes').value.trim(),
      order: $('purchaseSiteOrder').valueAsNumber, active: $('purchaseSiteActive').value === 'yes' };
    if (!Number.isInteger(entry.order) || entry.order < 1 || entry.order > 999) return;
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
      $('purchaseSiteId').value = site.loginId || '';
      $('purchaseSitePw').value = site.password || '';
      $('purchaseSitePurpose').value = site.purpose || '';
      $('purchaseSiteNotes').value = site.notes || '';
      $('purchaseSiteOrder').value = site.order;
      $('purchaseSiteActive').value = site.active ? 'yes' : 'no';
      $('purchaseSiteSave').textContent = '수정 저장';
      $('purchaseSiteReset').hidden = false;
      $('purchaseSiteName').focus();
    } else if (confirm(site.name + ' 사이트와 로그인 정보를 삭제할까요?')) {
      changePurchaseSites(list => list.filter(item => item.id !== site.id), '사이트를 삭제했습니다.');
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
