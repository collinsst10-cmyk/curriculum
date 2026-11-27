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
    let tblNo = 0;
    const num = (el, a) => Number(el && el.getAttribute(a)) || 0;
    const walk = (parent, inCell) => {
      ch(parent, 'p').forEach(p => {
        const tbls = tblsOf(p), t = paraText(p);
        if (t.trim() || !tbls.length) blocks.push({ text: t, cell: inCell });
        tbls.forEach(tb => { const tno = tblNo++; ch(tb, 'tr').forEach(tr => ch(tr, 'tc').forEach(tc => {
          const sub = ch(tc, 'subList')[0]; if (!sub) return;
          const addr = ch(tc, 'cellAddr')[0], span = ch(tc, 'cellSpan')[0];
          const pos = { tbl: tno, col: num(addr, 'colAddr'), row: num(addr, 'rowAddr'), cs: num(span, 'colSpan') || 1, rs: num(span, 'rowSpan') || 1 };
          if (ch(sub, 'p').some(pp => tblsOf(pp).length)) { walk(sub, true); return; }
          blocks.push({ text: ch(sub, 'p').map(paraText).join('\n'), cell: true, ...pos });
        })); });
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
      // 표 안의 표도 있으므로 표를 쌓아 둠: { level, no }
      let p = 0, cur = null, tblNo = 0; const stack = [];
      while (p + 4 <= data.length) {
        const h = dv.getUint32(p, true); p += 4;
        const tag = h & 0x3FF, level = (h >>> 10) & 0x3FF; let size = h >>> 20;
        if (size === 0xFFF) { size = dv.getUint32(p, true); p += 4; }
        const body = data.subarray(p, p + size), bv = new DataView(body.buffer, body.byteOffset, body.byteLength); p += size;
        if (tag === 71 && size >= 4) {   // CTRL_HEADER: 표('tbl ') 시작
          const id = String.fromCharCode(body[3], body[2], body[1], body[0]);
          if (id === 'tbl ') stack.push({ level, no: tblNo++ });
        } else if (tag === 72) {          // LIST_HEADER: 표 칸 하나 시작 (열·행·합친 칸 수)
          const top = stack[stack.length - 1];
          if (top && level > top.level && size >= 16) {
            cur = { text: '', cell: true, lines: 0, tbl: top.no, col: bv.getUint16(8, true), row: bv.getUint16(10, true), cs: bv.getUint16(12, true) || 1, rs: bv.getUint16(14, true) || 1 };
            blocks.push(cur);
          }
        } else if (tag === 66) {          // PARA_HEADER
          while (stack.length && level <= stack[stack.length - 1].level) stack.pop();
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

  /* ---------- 학교 일지: 항목 알아보기 ----------
   * 1) 표: 제목 칸(전달사항, 결보강, 교장 …)을 찾아 오른쪽(없으면 아래) 칸을 그 항목 내용으로
   * 2) 표 밖 문단·한 칸에 여러 항목이 든 경우: 줄마다 제목('1. 전달사항', '□ 주요행사')을 찾아 그 아래 줄을 넣음 */
  const FIELDS = ['notice', 'events', 'guidance', 'cover', 'preview', 'lecture'];
  const LABELS = {
    notice: /^전달사항$/, events: /^(주요행사(및교육활동)?|주요교육활동|행사및교육활동|교육활동)$/, guidance: /^(생활지도(및안전지도)?|안전지도|생활및안전지도)$/,
    cover: /^(결보강|결보강사항)$/, preview: /^(교육활동예고|행사예고|예고)$/, lecture: /^(외부강의확인|외부강의)$/,
  };
  const PERSON = { p: /^교장$/, v: /^교감$/, a: /^(행정실장|행정실)$/ };
  const ROUTINE = /^(일과안내|일과)$/;
  const SKIP = /^(구분|오늘|오늘복무|복무|금일복무|예정|복무예정|내일예정|근무상황|비고|계|남|여)$/;
  // 앞의 기호·번호(□, ○, 1., 가., (1))와 빈칸·쌍점을 뺀 글
  const norm = s => String(s || '').replace(/^[\s□■○●◎◇◆▶▷※\-*·•]+/, '').replace(/^(\(?[0-9]{1,2}[.)]|\(?[가-하][.)])\s*/, '').replace(/[\s:：·]/g, '');
  const which = text => { const w = norm(String(text).replace(/\n/g, '')); for (const k in LABELS) if (LABELS[k].test(w)) return k; return null; };
  const whoIs = text => { const w = norm(String(text).replace(/\n/g, '')); for (const k in PERSON) if (PERSON[k].test(w)) return k; return null; };
  const hasHeadings = text => String(text).split('\n').some(l => which(l.split(/[:：]/)[0]));
  // 앞뒤 빈 줄 없애기(줄 안 들여쓰기는 그대로)
  const clean = t => String(t || '').replace(/\r/g, '').split('\n').reduce((a, l) => (a.length || l.trim() ? [...a, l.replace(/\s+$/, '')] : a), [])
    .reduceRight((a, l) => (a.length || l.trim() ? [l, ...a] : a), []).join('\n');
  /** "2026년 11월 27일(금)" → 2026-11-27 */
  const dateOf = text => { const m = String(text).match(/(20\d{2})\s*[년.\-/]\s*(\d{1,2})\s*[월.\-/]\s*(\d{1,2})/); return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : ''; };

  function parseLog(blocks) {
    const out = { date: '', notice: '', events: '', guidance: '', cover: '', preview: '', lecture: '', duty: { p: { today: '', plan: '' }, v: { today: '', plan: '' }, a: { today: '', plan: '' } } };
    const add = (k, t) => { t = clean(t); if (!t.trim()) return; out[k] = out[k] ? out[k] + '\n' + t : t; };
    /** 줄 단위: 제목 줄 뒤의 줄을 그 항목에 */
    function lines(text) {
      let field = null, person = null;
      String(text).replace(/\r/g, '').split('\n').forEach(line => {
        const head = line.split(/[:：]/)[0], rest = /[:：]/.test(line) ? line.slice(head.length + 1) : '';
        const k = which(head), who = whoIs(head);
        if (k) { field = k; person = null; if (rest.trim()) add(k, rest.trim()); return; }
        if (who) { person = who; field = null; if (rest.trim()) out.duty[who].today = rest.trim(); return; }
        const n = norm(line);
        if (ROUTINE.test(n) || /^근무상황/.test(n) || /^학적현황/.test(n)) { field = null; person = null; return; }
        if (person) { const d = out.duty[person]; if (line.trim()) d.plan = d.plan ? d.plan + '\n' + line.trim() : line.trim(); return; }
        if (field) out[field] = out[field] ? out[field] + '\n' + line : line;
      });
    }
    // 날짜: 앞쪽 글에서 처음 나오는 날짜
    for (const b of blocks.slice(0, 8)) { const d = dateOf(b.text); if (d) { out.date = d; break; } }

    const used = new Set(), cells = blocks.filter(b => b.cell && b.tbl !== undefined);
    const at = (tbl, row, col) => cells.find(c => c.tbl === tbl && row >= c.row && row < c.row + c.rs && col >= c.col && col < c.col + c.cs);
    const isLabel = c => !!c && !!(which(c.text) || whoIs(c.text) || ROUTINE.test(norm(c.text)) || SKIP.test(norm(c.text)));
    const right = c => at(c.tbl, c.row, c.col + c.cs);
    const below = c => at(c.tbl, c.row + c.rs, c.col);
    cells.forEach(c => {
      const k = which(c.text), who = whoIs(c.text), routine = ROUTINE.test(norm(c.text));
      if (!k && !who && !routine) return;
      used.add(c);
      if (who) {
        const t = right(c), pl = t && right(t);
        if (t && !isLabel(t)) { used.add(t); out.duty[who].today = clean(t.text).trim(); }
        if (pl && !isLabel(pl)) { used.add(pl); out.duty[who].plan = clean(pl.text).trim(); }
        return;
      }
      let v = right(c); if (!v || isLabel(v)) v = below(c);
      if (!v || isLabel(v) || used.has(v)) return;
      used.add(v);
      if (routine || hasHeadings(v.text)) lines(v.text); else add(k, v.text);
    });
    // 표 밖 문단, 또는 표 칸인데 제목 줄이 든 칸
    let para = [];
    const flush = () => { if (para.length) { lines(para.join('\n')); para = []; } };
    blocks.forEach(b => {
      if (used.has(b)) return;
      if (b.cell && b.tbl !== undefined) { flush(); if (hasHeadings(b.text)) lines(b.text); return; }
      para.push(b.text);
    });
    flush();
    // 들여쓰기 정리: '* 항목'은 앞 빈칸 없이, 이어지는 줄(괄호 설명 등)은 두 칸 들여서
    const tidy = t => clean(t).split('\n').map(l => { const s = l.trim(); return !s ? '' : /^\s/.test(l) && !/^[*\-•·○□▶◦]/.test(s) && !/^\d+[.)]/.test(s) ? '  ' + s : s; }).join('\n');
    FIELDS.forEach(k => { out[k] = tidy(out[k]); });
    return out;
  }

  /* ---------- 쓰기: 우리 학교 일지 양식(hwp/school-log.hwpx)에 내용을 채워 HWPX로 ----------
   * 양식의 칸을 제목 글자로 찾음(제목 칸 오른쪽·아래 칸) → 양식이 조금 바뀌어도 동작 */
  const HP = 'http://www.hancom.co.kr/hwpml/2011/paragraph';
  const TEMPLATE = 'hwp/school-log.hwpx?v=1';
  let tplCache = null;
  async function loadTemplate() {
    if (tplCache) return tplCache;
    const r = await fetch(TEMPLATE); if (!r.ok) throw new Error('학교 일지 양식 파일을 불러오지 못했습니다');
    return (tplCache = await unzip(await r.arrayBuffer()));
  }
  const WDK = ['일', '월', '화', '수', '목', '금', '토'];

  /** section0.xml 문서에 일지 내용 채우기 */
  function fillSection(doc, log, opt) {
    const kids = (el, name) => [...el.children].filter(c => c.localName === name);
    const tcs = [...doc.getElementsByTagNameNS(HP, 'tc')].map(tc => {
      const a = kids(tc, 'cellAddr')[0], s = kids(tc, 'cellSpan')[0], sub = kids(tc, 'subList')[0];
      const text = sub ? kids(sub, 'p').map(p => [...p.getElementsByTagNameNS(HP, 't')].map(t => t.textContent).join('')).join('\n') : '';
      return { tc, sub, text, tbl: tc.parentNode.parentNode, col: +a.getAttribute('colAddr'), row: +a.getAttribute('rowAddr'), cs: +s.getAttribute('colSpan') || 1, rs: +s.getAttribute('rowSpan') || 1 };
    });
    const at = (tbl, row, col) => tcs.find(c => c.tbl === tbl && row >= c.row && row < c.row + c.rs && col >= c.col && col < c.col + c.cs);
    const right = c => c && at(c.tbl, c.row, c.col + c.cs), below = c => c && at(c.tbl, c.row + c.rs, c.col);
    const charOf = p => { const runs = p ? kids(p, 'run') : []; const r = runs.find(x => kids(x, 't').some(t => t.textContent.trim())) || runs[0]; return r ? r.getAttribute('charPrIDRef') : '0'; };
    const makeP = (proto, text, charPr) => {
      const p = doc.createElementNS(HP, 'hp:p');
      ['paraPrIDRef', 'styleIDRef', 'pageBreak', 'columnBreak', 'merged'].forEach(a => p.setAttribute(a, proto ? proto.getAttribute(a) || '0' : '0'));
      p.setAttribute('id', '0');
      const r = doc.createElementNS(HP, 'hp:run'); r.setAttribute('charPrIDRef', charPr ?? charOf(proto));
      const t = doc.createElementNS(HP, 'hp:t'); t.textContent = text; r.appendChild(t); p.appendChild(r);
      return p;
    };
    const setCell = (c, text) => {
      if (!c || !c.sub) return;
      const ps = kids(c.sub, 'p'), proto = ps[0], cp = charOf(proto);
      ps.forEach(p => p.remove());
      String(text ?? '').split('\n').forEach(line => c.sub.appendChild(makeP(proto, line, cp)));
    };
    const find = re => tcs.find(c => re.test(norm(c.text.replace(/\n/g, ''))));

    // 제목: 2026년 11월 27일(금) 학교일지
    const title = tcs.find(c => /학교일지$/.test(norm(c.text.replace(/\n/g, ''))));
    if (title && opt.date) { const d = parse(opt.date); setCell(title, `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일(${WDK[d.getDay()]}) 학교일지`); }

    // 결보강(제목 아래 칸)·교육활동 예고·외부강의 확인(제목 오른쪽 칸)
    const cov = find(LABELS.cover); if (cov) setCell(below(cov), log.cover || '');
    const pre = find(LABELS.preview); if (pre) setCell(right(pre), log.preview || '');
    const lec = find(LABELS.lecture); if (lec) setCell(right(lec), log.lecture || '');

    // 근무상황: 교장·교감·행정실장 오른쪽 = 오늘, 그다음 = 예정
    Object.keys(PERSON).forEach(k => {
      const c = find(PERSON[k]); if (!c) return;
      const t = right(c), pl = right(t), d = (log.duty || {})[k] || {};
      setCell(t, d.today || ''); setCell(pl, d.plan || '');
    });

    // 일과안내: '1. 전달사항' 같은 제목 줄과 그 아래 '*' 줄의 모양을 본떠 다시 씀
    const rl = find(ROUTINE), routine = rl && right(rl);
    if (routine && routine.sub) {
      const ps = kids(routine.sub, 'p'), txt = p => [...p.getElementsByTagNameNS(HP, 't')].map(t => t.textContent).join('');
      const blank = ps.find(p => !txt(p).trim()) || ps[0];
      const heads = {}; ps.forEach((p, i) => { const k = which(txt(p)); if (k && !heads[k]) heads[k] = { p, item: ps[i + 1] || p }; });
      const anyHead = heads.notice || heads.events || heads.guidance;
      ps.forEach(p => p.remove());
      [['notice', '전달사항'], ['events', '주요행사 및 교육활동'], ['guidance', '생활지도 및 안전지도']].forEach(([k, name], i) => {
        const h = heads[k] || anyHead || { p: blank, item: blank };
        routine.sub.appendChild(makeP(blank, ' ', charOf(blank)));
        // 제목 줄은 '1. 전달사항' 글자가 든 run 의 모양으로
        const hRun = kids(h.p, 'run').find(r => which(kids(r, 't').map(t => t.textContent).join(''))) || kids(h.p, 'run').pop();
        routine.sub.appendChild(makeP(h.p, ` ${i + 1}. ${name}`, hRun ? hRun.getAttribute('charPrIDRef') : charOf(h.p)));
        const lines = String(log[k] || '').split('\n').filter((l, j, a) => l.trim() || (j > 0 && j < a.length - 1));
        if (!lines.length) lines.push('');
        lines.forEach(l => {
          const s = l.trim(), text = !s ? '' : /^[*\-•·○□▶◦]/.test(s) ? '   ' + s : /^\s/.test(l) ? '     ' + s : '   * ' + s;
          routine.sub.appendChild(makeP(h.item, text, charOf(h.item)));
        });
      });
    }

    // 학적현황: 학교 현황(반별 남·여)으로 채움
    const st = opt.stats && opt.stats.students, head = tcs.find(c => /^학적현황/.test(norm(c.text)));
    if (head) {
      const T = head.tbl, inT = tcs.filter(c => c.tbl === T);
      const asOf = opt.stats && opt.stats.asOf ? String(opt.stats.asOf).replace(/-/g, '.') : '';
      setCell(head, `학 적 현 황${asOf ? `(${asOf})` : ''}`);
      const grades = inT.filter(c => /^\d학년$/.test(norm(c.text))).map(c => ({ g: parseInt(norm(c.text)), from: c.col, to: c.col + c.cs }));
      const classes = inT.filter(c => /^\d{1,2}반$/.test(norm(c.text))).map(c => ({ c: parseInt(norm(c.text)), col: c.col, g: (grades.find(g => c.col >= g.from && c.col < g.to) || {}).g })).filter(x => x.g);
      const rowOf = name => inT.find(c => c.col === 0 && norm(c.text) === name);
      const sumCol = inT.find(c => norm(c.text) === '계' && c.col !== 0);
      const v = (g, c, s) => { const b = st && st.byClass && st.byClass[`${g}-${c}`]; return b ? Number(b[s]) || 0 : 0; };
      const has = !!(st && st.byClass);
      const show = n => (has ? String(n) : '');
      const rm = rowOf('남'), rf = rowOf('여'), rt = rowOf('계');
      let tm = 0, tf = 0;
      classes.forEach(x => {
        const m = v(x.g, x.c, 'm'), f = v(x.g, x.c, 'f'); tm += m; tf += f;
        if (rm) setCell(at(T, rm.row, x.col), show(m));
        if (rf) setCell(at(T, rf.row, x.col), show(f));
        if (rt) setCell(at(T, rt.row, x.col), show(m + f));
      });
      if (rt) grades.forEach(g => { const c = at(T, rt.row + 1, g.from); if (c && c.row === rt.row + 1) setCell(c, show(classes.filter(x => x.g === g.g).reduce((t, x) => t + v(x.g, x.c, 'm') + v(x.g, x.c, 'f'), 0))); });
      if (sumCol) {
        if (rm) setCell(at(T, rm.row, sumCol.col), show(tm));
        if (rf) setCell(at(T, rf.row, sumCol.col), show(tf));
        if (rt) setCell(at(T, rt.row, sumCol.col), show(tm + tf));
      }
    }
    // 줄 배치 정보는 지움(한글이 열 때 다시 계산)
    [...doc.getElementsByTagNameNS(HP, 'linesegarray')].forEach(n => n.remove());
  }

  /** log = { notice, events, guidance, cover, preview, lecture, duty }, opt = { date:'YYYY-MM-DD', stats } → Blob(.hwpx) */
  async function logHwpx(log, opt = {}) { return buildFrom(await loadTemplate(), log, opt); }
  /** 양식 파일들 + 내용 → HWPX (미리보기 그림·작성자 정보는 빼고 다시 묶음) */
  function buildFrom(files, log, opt = {}) {
    const doc = new DOMParser().parseFromString(new TextDecoder().decode(files['Contents/section0.xml']), 'application/xml');
    fillSection(doc, log || {}, opt);
    let section = new XMLSerializer().serializeToString(doc);
    if (!section.startsWith('<?xml')) section = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' + section;
    const dec = n => new TextDecoder().decode(files[n]);
    const out = { ...files, 'Contents/section0.xml': section };
    if (files['META-INF/container.xml']) out['META-INF/container.xml'] = dec('META-INF/container.xml').replace(/<ocf:rootfile full-path="Preview\/[^"]*"[^>]*\/>/g, '');
    if (files['Contents/content.hpf']) out['Contents/content.hpf'] = dec('Contents/content.hpf').replace(/<opf:metadata>[\s\S]*?<\/opf:metadata>/, '<opf:metadata><opf:title>학교일지</opf:title><opf:language>ko</opf:language></opf:metadata>');
    const order = ['mimetype', 'version.xml', 'Contents/header.xml', 'Contents/section0.xml', 'settings.xml', 'META-INF/container.xml', 'META-INF/manifest.xml', 'META-INF/container.rdf', 'Contents/content.hpf'];
    const names = [...order.filter(n => out[n]), ...Object.keys(out).filter(n => !order.includes(n) && !/^Preview\//.test(n))];
    return zipStore(names.map(n => ({ name: n, data: out[n] })));
  }

  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  window.Hwp = { readBlocks, parseLog, logHwpx, download, _readHwpx: readHwpx, _readHwp: readHwp, _buildFrom: buildFrom, _unzip: unzip };
})();
