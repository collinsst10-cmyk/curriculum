/* =========================================================
 * 한글 문서 읽기·쓰기 (외부 라이브러리 없이 브라우저에서)
 *  - 쓰기: HWPX(한글 2014 이후 기본 형식, 한글에서 바로 열림) — 학교 일지 양식
 *  - 읽기: HWPX(zip + XML) · HWP 5.0(복합 문서 + 압축 레코드)에서 글·표 칸 순서대로 뽑기
 *  - 학교 일지 항목 알아보기: 제목 칸(전달사항·주요행사…·근무상황 교장/교감/행정실장) 뒤의 내용을 그 항목에 넣음
 * ========================================================= */
(function () {
  'use strict';

  /* ---------- zip ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = u8 => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const enc = s => new TextEncoder().encode(s);

  /** 압축하지 않는(store) zip — mimetype 이 맨 앞에 와야 한글이 HWPX로 알아봄 */
  function zipStore(files) {
    const parts = [], central = []; let offset = 0;
    files.forEach(f => {
      const name = enc(f.name), data = typeof f.data === 'string' ? enc(f.data) : f.data, crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    const cSize = central.reduce((t, a) => t + a.length, 0), end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/hwp+zip' });
  }

  async function inflateRaw(u8) {
    const ds = new DecompressionStream('deflate-raw');
    const out = new Response(new Blob([u8]).stream().pipeThrough(ds));
    return new Uint8Array(await out.arrayBuffer());
  }
  // HWP 본문은 끝에 남는 바이트가 있어도 풀린 만큼은 씀
  async function inflateLoose(u8) {
    const ds = new DecompressionStream('deflate-raw'), w = ds.writable.getWriter(), chunks = [];
    w.write(u8).catch(() => {}); w.close().catch(() => {});
    const r = ds.readable.getReader();
    try { for (;;) { const { done, value } = await r.read(); if (done) break; chunks.push(value); } } catch (e) { if (!chunks.length) throw e; }
    const n = chunks.reduce((t, c) => t + c.length, 0), out = new Uint8Array(n); let p = 0; chunks.forEach(c => { out.set(c, p); p += c.length; });
    return out;
  }

  /** zip 풀기 → { 이름: Uint8Array } */
  async function unzip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf), out = {};
    let e = u8.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('zip 형식이 아닙니다');
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
    for (let i = 0; i < n; i++) {
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl));
      const ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), raw = u8.subarray(ds, ds + csize);
      out[name] = method === 0 ? raw : method === 8 ? await inflateRaw(raw) : null;
      p += 46 + nl + xl + cl;
    }
    return out;
  }

  /* ---------- 읽기: HWPX ---------- */
  /** 문단·표 칸을 문서 순서대로 [{ text, cell }] 로 */
  async function readHwpx(buf) {
    const files = await unzip(buf), blocks = [];
    const secs = Object.keys(files).filter(k => /^Contents\/section\d+\.xml$/i.test(k)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)));
    if (!secs.length) throw new Error('한글 본문을 찾지 못했습니다');
    const ch = (el, name) => [...el.children].filter(c => c.localName === name);
    const paraText = p => { let s = ''; ch(p, 'run').forEach(r => ch(r, 't').forEach(t => t.childNodes.forEach(c => {
      s += c.nodeType === 3 ? c.nodeValue : c.localName === 'lineBreak' ? '\n' : c.localName === 'tab' ? ' ' : '';
    }))); return s; };
    const tblsOf = p => ch(p, 'run').flatMap(r => ch(r, 'tbl'));
    const walk = (parent, inCell) => {
      ch(parent, 'p').forEach(p => {
        const tbls = tblsOf(p), t = paraText(p);
        if (t.trim() || !tbls.length) blocks.push({ text: t, cell: inCell });
        tbls.forEach(tb => ch(tb, 'tr').forEach(tr => ch(tr, 'tc').forEach(tc => {
          const sub = ch(tc, 'subList')[0]; if (!sub) return;
          if (ch(sub, 'p').some(pp => tblsOf(pp).length)) { walk(sub, true); return; }
          blocks.push({ text: ch(sub, 'p').map(paraText).join('\n'), cell: true });
        })));
      });
    };
    for (const s of secs) {
      const doc = new DOMParser().parseFromString(new TextDecoder().decode(files[s]), 'application/xml');
      walk(doc.documentElement, false);
    }
    return blocks;
  }

  /* ---------- 읽기: HWP 5.0 (복합 문서) ---------- */
  function cfb(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    if (dv.getUint32(0, true) !== 0xE011CFD0) throw new Error('한글(HWP) 파일이 아닙니다');
    const ss = 1 << dv.getUint16(30, true), mss = 1 << dv.getUint16(32, true);
    const nFat = dv.getUint32(44, true), dirStart = dv.getUint32(48, true), miniCut = dv.getUint32(56, true);
    const miniFatStart = dv.getUint32(60, true), difStart = dv.getUint32(68, true), nDif = dv.getUint32(72, true);
    const sec = i => (i + 1) * ss;
    const fatSecs = []; for (let i = 0; i < 109 && fatSecs.length < nFat; i++) fatSecs.push(dv.getUint32(76 + i * 4, true));
    let d = difStart; for (let k = 0; k < nDif && fatSecs.length < nFat; k++) { for (let i = 0; i < ss / 4 - 1 && fatSecs.length < nFat; i++) fatSecs.push(dv.getUint32(sec(d) + i * 4, true)); d = dv.getUint32(sec(d) + ss - 4, true); }
    const fat = []; fatSecs.forEach(s => { for (let i = 0; i < ss / 4; i++) fat.push(dv.getUint32(sec(s) + i * 4, true)); });
    const chain = (start, tbl) => { const c = []; let s = start, guard = 0; while (s < 0xFFFFFFFA && guard++ < 1e6) { c.push(s); s = tbl[s]; } return c; };
    const readBig = (start, size) => { const out = new Uint8Array(size); let p = 0; for (const s of chain(start, fat)) { const n = Math.min(ss, size - p); out.set(u8.subarray(sec(s), sec(s) + n), p); p += n; if (p >= size) break; } return out; };
    const dirRaw = readBig(dirStart, chain(dirStart, fat).length * ss), ddv = new DataView(dirRaw.buffer);
    const ents = [];
    for (let o = 0; o + 128 <= dirRaw.length; o += 128) {
      const nl = ddv.getUint16(o + 64, true); if (!nl) { ents.push(null); continue; }
      let name = ''; for (let i = 0; i < nl / 2 - 1; i++) name += String.fromCharCode(ddv.getUint16(o + i * 2, true));
      ents.push({ name, type: dirRaw[o + 66], left: ddv.getUint32(o + 68, true), right: ddv.getUint32(o + 72, true), child: ddv.getUint32(o + 76, true), start: ddv.getUint32(o + 116, true), size: ddv.getUint32(o + 120, true) });
    }
    const root = ents[0];
    const miniStream = readBig(root.start, root.size);
    const miniFat = []; if (miniFatStart < 0xFFFFFFFA) chain(miniFatStart, fat).forEach(s => { for (let i = 0; i < ss / 4; i++) miniFat.push(dv.getUint32(sec(s) + i * 4, true)); });
    const readMini = (start, size) => { const out = new Uint8Array(size); let p = 0; for (const s of chain(start, miniFat)) { const n = Math.min(mss, size - p); out.set(miniStream.subarray(s * mss, s * mss + n), p); p += n; if (p >= size) break; } return out; };
    // 경로 → 항목 (저장소 안 형제는 빨강-검정 나무)
    const kids = idx => { const out = []; const visit = i => { if (i >= 0xFFFFFFFA || !ents[i]) return; visit(ents[i].left); out.push(ents[i]); visit(ents[i].right); }; visit(ents[idx].child); return out; };
    const find = path => { let cur = 0; for (const part of path.split('/')) { const k = kids(cur).find(e => e.name === part); if (!k) return null; cur = ents.indexOf(k); } return ents[cur]; };
    const read = e => e.size < miniCut ? readMini(e.start, e.size) : readBig(e.start, e.size);
    return { find, read, kids: path => { const e = find(path); return e ? kids(ents.indexOf(e)) : []; } };
  }

  async function readHwp(buf) {
    const c = cfb(buf), fh = c.find('FileHeader');
    if (!fh) throw new Error('한글(HWP) 파일 머리를 찾지 못했습니다');
    const flags = new DataView(c.read(fh).buffer).getUint32(36, true);
    if (flags & 2) throw new Error('암호가 걸린 한글 파일은 읽을 수 없습니다');
    const compressed = !!(flags & 1), blocks = [];
    const secs = c.kids('BodyText').filter(e => /^Section\d+$/.test(e.name)).sort((a, b) => parseInt(a.name.slice(7)) - parseInt(b.name.slice(7)));
    if (!secs.length) throw new Error('본문(BodyText)을 찾지 못했습니다 — 배포용 문서는 읽을 수 없습니다');
    for (const s of secs) {
      let data = c.read(s); if (compressed) data = await inflateLoose(data);
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      let p = 0, cur = null, tableLevel = -1;
      while (p + 4 <= data.length) {
        const h = dv.getUint32(p, true); p += 4;
        const tag = h & 0x3FF, level = (h >>> 10) & 0x3FF; let size = h >>> 20;
        if (size === 0xFFF) { size = dv.getUint32(p, true); p += 4; }
        const body = data.subarray(p, p + size); p += size;
        if (tag === 71 && size >= 4) {   // CTRL_HEADER: 표('tbl ') 시작
          const id = String.fromCharCode(body[3], body[2], body[1], body[0]);
          if (id === 'tbl ') tableLevel = level;
        } else if (tag === 72) {          // LIST_HEADER: 표 칸 하나 시작
          if (tableLevel >= 0 && level > tableLevel) { cur = { text: '', cell: true, lines: 0 }; blocks.push(cur); }
        } else if (tag === 66) {          // PARA_HEADER
          if (tableLevel >= 0 && level <= tableLevel) tableLevel = -1;
          if (level === 0) { cur = { text: '', cell: false, lines: 0 }; blocks.push(cur); }
        } else if (tag === 67 && cur) {   // PARA_TEXT
          let t = ''; const n = size / 2;
          for (let i = 0; i < n; i++) {
            const ch = body[i * 2] | (body[i * 2 + 1] << 8);
            if (ch >= 32) { t += String.fromCharCode(ch); continue; }
            if (ch === 10) t += '\n'; else if (ch === 9) t += ' ';
            if (![0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31].includes(ch)) i += 7;   // 8칸짜리 조판 부호
          }
          cur.text += (cur.lines++ ? '\n' : '') + t;
        }
      }
    }
    return blocks.filter(b => b.cell || b.text.trim());
  }

  /** 파일 → 블록 목록 (확장자·내용으로 판단) */
  async function readBlocks(file) {
    const buf = await file.arrayBuffer(), head = new Uint8Array(buf, 0, 4);
    if (head[0] === 0x50 && head[1] === 0x4B) return readHwpx(buf);
    if (head[0] === 0xD0 && head[1] === 0xCF) return readHwp(buf);
    throw new Error('한글 파일(.hwp, .hwpx)만 읽을 수 있습니다');
  }

  /* ---------- 학교 일지: 항목 알아보기 ---------- */
  const SECTIONS = [['notice', /^전달사항/], ['events', /^(주요행사|주요교육활동|행사및교육활동|교육활동)/], ['guidance', /^(생활지도|안전지도|생활및안전)/]];
  const PEOPLE = [['p', /^교장/], ['v', /^교감/], ['a', /^(행정실장|행정실)/]];
  const IGNORE = /^(구분|오늘복무|복무|금일복무|예정|복무예정|내일예정|학교일지|학교운영일지|근무상황|비고)$/;
  // 앞의 기호·번호(□, ○, 1., 가., (1))와 빈칸·쌍점을 뺀 글
  const norm = s => String(s || '').replace(/^[\s□■○●◎◇◆▶▷※\-*·•]+/, '').replace(/^(\(?[0-9]{1,2}[.)]|\(?[가-하][.)])\s*/, '').replace(/[\s:：]/g, '');

  function parseLog(blocks) {
    const out = { notice: '', events: '', guidance: '', duty: { p: { today: '', plan: '' }, v: { today: '', plan: '' }, a: { today: '', plan: '' } } };
    let field = null, person = null, slot = 0;
    const add = (key, text) => { text = text.replace(/^\s+|\s+$/g, ''); if (!text) return; out[key] = out[key] ? out[key] + '\n' + text : text; };
    const label = text => {
      // 제목 칸이 '주요행사 및 / 교육활동'처럼 두 줄이어도 제목으로 봄
      const whole = norm(String(text).replace(/\n/g, ''));
      if (whole.length <= 14) {
        for (const [k, re] of SECTIONS) if (re.test(whole)) return { k, rest: '' };
        if (whole.length <= 6) for (const [k, re] of PEOPLE) if (re.test(whole)) return { person: k, rest: '' };
      }
      const first = String(text).split('\n')[0], n = norm(/[:：]/.test(first) ? first.split(/[:：]/)[0] : first);
      // "전달사항: 내용" 처럼 한 줄에 같이 쓴 경우도 나눔
      const rest = (first.includes(':') || first.includes('：') ? first.split(/[:：]/).slice(1).join(':') : '') + String(text).split('\n').slice(1).map(l => '\n' + l).join('');
      for (const [k, re] of SECTIONS) if (re.test(n) && n.length <= 14) return { k, rest };
      if (n.length <= 6) for (const [k, re] of PEOPLE) if (re.test(n)) return { person: k, rest };
      if (/^근무상황/.test(n)) return { duty: true };
      return null;
    };
    blocks.forEach(b => {
      const text = String(b.text || '').replace(/\r/g, '');
      if (!text.trim()) { if (person && b.cell) slot++; return; }
      const n = norm(text);
      if (IGNORE.test(n) || /^작성[:：]?/.test(text.trim()) || /^\d{4}[.년-]/.test(text.trim())) return;
      const l = label(text);
      if (l && l.k) { field = l.k; person = null; if (l.rest.trim()) add(field, l.rest); return; }
      if (l && l.person) { person = l.person; field = null; slot = 0; if (l.rest.trim()) { out.duty[person].today = l.rest.trim(); slot = 1; } return; }
      if (l && l.duty) { field = null; person = null; return; }
      if (person) { const key = slot === 0 ? 'today' : 'plan'; const d = out.duty[person]; d[key] = d[key] ? d[key] + '\n' + text.trim() : text.trim(); if (b.cell) slot++; return; }
      if (field) add(field, text);
    });
    return out;
  }

  /* ---------- 쓰기: 학교 일지 HWPX ---------- */
  const xesc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let assets = null;
  async function loadAssets() {
    if (assets) return assets;
    const get = f => fetch('hwp/' + f + '?v=1').then(r => { if (!r.ok) throw new Error('한글 양식 파일을 불러오지 못했습니다'); return r.text(); });
    const [header, open, secPr] = await Promise.all([get('log-header.xml'), get('log-sec-open.xml'), get('log-secpr.xml')]);
    return (assets = { header, open, secPr });
  }
  // 문단: para(글, 문단모양, 글자모양) — 여러 줄은 문단 여러 개
  const para = (text, pp = 4, cp = 6) => String(text ?? '').split('\n').map(line =>
    `<hp:p id="0" paraPrIDRef="${pp}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${cp}"><hp:t>${xesc(line)}</hp:t></hp:run></hp:p>`).join('');
  let tblId = 1900000000;
  /** 표: rows = [[{ text, w, head }]] */
  function table(rows, minH) {
    const width = rows[0].reduce((t, c) => t + c.w, 0);
    const trs = rows.map((r, ri) => `<hp:tr>${r.map((c, ci) => `<hp:tc name="" header="0" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="${c.head ? 5 : 6}">
<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="${c.head ? 'CENTER' : 'TOP'}" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${para(c.text, c.head ? 2 : 4, c.head ? 7 : 6)}</hp:subList>
<hp:cellAddr colAddr="${ci}" rowAddr="${ri}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${c.w}" height="${(minH && minH[ri]) || 1800}"/><hp:cellMargin left="510" right="510" top="283" bottom="283"/></hp:tc>`).join('')}</hp:tr>`).join('');
    return `<hp:p id="0" paraPrIDRef="4" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="6"><hp:tbl id="${tblId++}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="${rows.length}" colCnt="${rows[0].length}" cellSpacing="0" borderFillIDRef="6" noAdjust="0">
<hp:sz width="${width}" widthRelTo="ABSOLUTE" height="${rows.length * 1800}" heightRelTo="ABSOLUTE" protect="0"/>
<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>
<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="510" right="510" top="141" bottom="141"/>${trs}</hp:tbl><hp:t/></hp:run></hp:p>`;
  }

  /** log = { notice, events, guidance, duty:{p,v,a:{today,plan}} }, dateLabel, writer → Blob(.hwpx) */
  async function logHwpx(log, dateLabel, writer, school) {
    const a = await loadAssets(), d = log.duty || {}, du = k => d[k] || {};
    const W = 42520, L = 8800;
    const body = [
      `<hp:p id="0" paraPrIDRef="2" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="8">${a.secPr}</hp:run><hp:run charPrIDRef="8"><hp:t>학 교 일 지</hp:t></hp:run></hp:p>`,
      para(`${school ? school + '  ·  ' : ''}${dateLabel}`, 3, 6),
      table([
        [{ text: '전달사항', w: L, head: 1 }, { text: log.notice || '', w: W - L }],
        [{ text: '주요행사 및\n교육활동', w: L, head: 1 }, { text: log.events || '', w: W - L }],
        [{ text: '생활지도 및\n안전지도', w: L, head: 1 }, { text: log.guidance || '', w: W - L }],
      ], [7000, 7000, 7000]),
      para('', 4, 6),
      para('근무상황', 4, 7),
      table([
        [{ text: '구분', w: L, head: 1 }, { text: '오늘 복무', w: (W - L) / 2, head: 1 }, { text: '예정', w: (W - L) / 2, head: 1 }],
        ...[['p', '교장'], ['v', '교감'], ['a', '행정실장']].map(([k, n]) => [{ text: n, w: L, head: 1 }, { text: du(k).today || '', w: (W - L) / 2 }, { text: du(k).plan || '', w: (W - L) / 2 }]),
      ], [1400, 2600, 2600, 2600]),
      writer ? para(`작성: ${writer}`, 3, 9) : '',
    ].join('');
    const section = `${a.open}${body}</hs:sec>`;
    const hpf = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><opf:package xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:dc="http://purl.org/dc/elements/1.1/" version="" unique-identifier="" id=""><opf:metadata><opf:title>학교 일지 ${xesc(dateLabel)}</opf:title><opf:language>ko</opf:language></opf:metadata><opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/><opf:item id="settings" href="settings.xml" media-type="application/xml"/></opf:manifest><opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0" linear="yes"/></opf:spine></opf:package>`;
    return zipStore([
      { name: 'mimetype', data: 'application/hwp+zip' },
      { name: 'version.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="1" buildNumber="0" os="1" xmlVersion="1.5" application="Hancom Office Hangul" appVersion="13, 0, 0, 564 WIN32LEWindows_10"/>' },
      { name: 'Contents/header.xml', data: a.header },
      { name: 'Contents/section0.xml', data: section },
      { name: 'settings.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"><ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/></ha:HWPApplicationSetting>' },
      { name: 'META-INF/container.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"><ocf:rootfiles><ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/></ocf:rootfiles></ocf:container>' },
      { name: 'META-INF/manifest.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>' },
      { name: 'Contents/content.hpf', data: hpf },
    ]);
  }

  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  window.Hwp = { readBlocks, parseLog, logHwpx, download, _readHwpx: readHwpx, _readHwp: readHwp };
})();
