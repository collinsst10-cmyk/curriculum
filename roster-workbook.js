'use strict';

window.RosterWorkbook = (() => {
  const headers = ['학년도', '학년', '반', '번호', '학생 ID', '이름'];
  const sheetNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const relNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const docRel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const escapeXml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const file = (name, data) => ({ name, data });
  function write(rows) {
    const sheet = [headers, ...rows].map((row, i) =>
      '<row r="' + (i + 1) + '">' + row.map((value, j) =>
        '<c r="' + String.fromCharCode(65 + j) + (i + 1) + '" t="inlineStr"><is><t xml:space="preserve">' +
        escapeXml(value) + '</t></is></c>').join('') + '</row>').join('');
    const types = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>';
    const rel = (type, target) => '<Relationships xmlns="' + relNs + '"><Relationship Id="rId1" Type="' +
      docRel + '/' + type + '" Target="' + target + '"/></Relationships>';
    return Hwp._zipStore([
      file('[Content_Types].xml', types), file('_rels/.rels', rel('officeDocument', 'xl/workbook.xml')),
      file('xl/workbook.xml', '<workbook xmlns="' + sheetNs + '" xmlns:r="' + docRel + '"><sheets><sheet name="학생 명단" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      file('xl/_rels/workbook.xml.rels', rel('worksheet', 'worksheets/sheet1.xml')),
      file('xl/worksheets/sheet1.xml', '<worksheet xmlns="' + sheetNs + '"><sheetData>' + sheet + '</sheetData></worksheet>')
    ]).slice(0, undefined, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }
  async function read(file) {
    if (file.size > 2_000_000) throw new Error('2MB 이하의 학급 명단 파일을 선택해 주세요.');
    const zip = await Hwp._unzip(await file.arrayBuffer());
    const xml = path => {
      if (!Object.hasOwn(zip, path) || !zip[path]) throw new Error('엑셀 파일에서 명단 시트를 찾지 못했습니다.');
      const dom = new DOMParser().parseFromString(new TextDecoder().decode(zip[path]), 'application/xml');
      if (dom.querySelector('parsererror')) throw new Error('엑셀 시트를 읽을 수 없습니다.');
      return dom;
    };
    const strings = zip['xl/sharedStrings.xml'] ? [...xml('xl/sharedStrings.xml').getElementsByTagNameNS(sheetNs, 'si')].map(
      si => [...si.getElementsByTagNameNS(sheetNs, 't')].map(t => t.textContent).join('')) : [];
    const rows = [...xml('xl/worksheets/sheet1.xml').getElementsByTagNameNS(sheetNs, 'row')].map(row => {
      const values = new Map();
      for (const cell of row.getElementsByTagNameNS(sheetNs, 'c')) {
        if (cell.getElementsByTagNameNS(sheetNs, 'f').length) throw new Error('수식이 있는 셀은 값으로 바꿔 주세요.');
        const value = cell.getElementsByTagNameNS(sheetNs, 'v')[0]?.textContent || '';
        const type = cell.getAttribute('t');
        const text = type === 's' ? strings[Number(value)] : type === 'inlineStr'
          ? [...cell.getElementsByTagNameNS(sheetNs, 't')].map(t => t.textContent).join('') : value;
        values.set(cell.getAttribute('r').replace(/[0-9]/g, ''), String(text ?? '').trim());
      }
      return values;
    }).filter(row => [...row.values()].some(Boolean));
    const headings = rows.shift();
    const columns = headers.map(title => [...headings || []].find(([, value]) => value === title)?.[0]);
    if (columns.some(column => !column)) throw new Error('다운로드한 명단 양식의 열 제목을 사용해 주세요.');
    return rows.map(row => columns.map(column => row.get(column) || ''));
  }
  return { read, write };
})();
