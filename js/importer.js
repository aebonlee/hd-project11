/**
 * 엑셀 임포트 — VBA modImport.ImportOverseasData 대체.
 *
 * 매크로는 "원본행(레이블) / 원본 실적행(actual_row)"처럼 행 번호를 박아 두고 읽었다.
 * 원본 파일 서식이 조금만 바뀌어도 엉뚱한 행을 읽는 구조라, 여기서는
 * **행 번호 대신 KPI 이름으로 찾는다**. 파일에서 KPI 이름이 가장 많이 맞아떨어지는
 * 열을 자동으로 고르고, 값 열은 사용자가 고르게 한다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.Importer = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var Logic = root.Logic || (typeof require === 'function' ? require('./logic.js') : null);

  /** 워크북을 시트별 2차원 배열로 편다. */
  function readWorkbook(arrayBuffer) {
    var XLSX = root.XLSX;
    if (!XLSX) throw new Error('SheetJS(lib/xlsx.full.min.js)가 로드되지 않았습니다.');
    var wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
    return wb.SheetNames.map(function (name) {
      var grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
      return { name: name, grid: grid };
    });
  }

  /**
   * KPI 이름이 가장 많이 맞는 열을 찾는다.
   * @returns {{col: number, hits: number, scanned: number}}
   */
  function detectNameColumn(grid, mappings) {
    var known = {};
    (mappings || []).forEach(function (m) {
      known[Logic.normalizeKpiName(m.kpiEn)] = true;
      known[Logic.normalizeKpiName(m.kpiKo)] = true;
    });

    var width = 0;
    grid.forEach(function (r) { if (r && r.length > width) width = r.length; });

    var best = { col: -1, hits: 0, scanned: grid.length };
    for (var c = 0; c < width; c++) {
      var hits = 0;
      for (var r = 0; r < grid.length; r++) {
        var v = grid[r] && grid[r][c];
        if (v === null || v === undefined || v === '') continue;
        if (known[Logic.normalizeKpiName(v)]) hits++;
      }
      if (hits > best.hits) best = { col: c, hits: hits, scanned: grid.length };
    }
    return best;
  }

  /**
   * 이름 열 기준으로 후보 값 열들을 점수 매긴다.
   * 숫자가 많이 든 열일수록 앞에 온다 — 월별 실적 열을 고르기 쉽게 하기 위함.
   */
  function candidateValueColumns(grid, nameCol) {
    var width = 0;
    grid.forEach(function (r) { if (r && r.length > width) width = r.length; });
    var out = [];
    for (var c = 0; c < width; c++) {
      if (c === nameCol) continue;
      var numeric = 0, filled = 0, sample = [];
      for (var r = 0; r < grid.length; r++) {
        var name = grid[r] && grid[r][nameCol];
        if (name === null || name === undefined || name === '') continue;
        var v = grid[r][c];
        if (v === null || v === undefined || v === '') continue;
        filled++;
        if (typeof v === 'number' || isFinite(Number(String(v).replace(/[,%]/g, '')))) numeric++;
        if (sample.length < 3) sample.push(v);
      }
      if (filled === 0) continue;
      out.push({ col: c, filled: filled, numeric: numeric, sample: sample, header: headerOf(grid, c) });
    }
    out.sort(function (a, b) { return b.numeric - a.numeric || b.filled - a.filled; });
    return out;
  }

  /** 위쪽 5행에서 그 열의 머리글로 쓸 만한 문자열을 집는다. */
  function headerOf(grid, col) {
    for (var r = 0; r < Math.min(6, grid.length); r++) {
      var v = grid[r] && grid[r][col];
      if (typeof v === 'string' && v.trim() !== '') return v.trim();
      if (v instanceof Date) return String(v.getMonth() + 1) + '월';
    }
    return '열 ' + colLetter(col);
  }

  function colLetter(n) {
    var s = '';
    n = n + 1;
    while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  /** 이름 열 + 값 열 → [{kpiEn, value}] */
  function extractRows(grid, nameCol, valueCol) {
    var out = [];
    for (var r = 0; r < grid.length; r++) {
      var name = grid[r] && grid[r][nameCol];
      if (name === null || name === undefined || String(name).trim() === '') continue;
      out.push({ kpiEn: String(name).trim(), value: grid[r][valueCol], row: r + 1 });
    }
    return out;
  }

  /** 이 저장소가 항상 읽을 수 있는 표준 양식을 만들어 준다. */
  function buildTemplate(mappings, month) {
    var XLSX = root.XLSX;
    var aoa = [['KPI(영문 원본명)', 'KPI(국문 총괄명)', '모듈', month + ' 실적', '단위/비고']];
    (mappings || []).forEach(function (m) {
      aoa.push([m.kpiEn, m.kpiKo, m.module, null, m.format === '숫자' ? '' : m.format]);
    });
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 52 }, { wch: 40 }, { wch: 26 }, { wch: 12 }, { wch: 14 }];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '원본실적');
    return wb;
  }

  return {
    readWorkbook: readWorkbook,
    detectNameColumn: detectNameColumn,
    candidateValueColumns: candidateValueColumns,
    extractRows: extractRows,
    buildTemplate: buildTemplate,
    colLetter: colLetter
  };
});
