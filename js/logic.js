/**
 * HDPS KPI 자동화 — 순수 비즈니스 로직 (UMD)
 *
 * 브라우저와 Node(단위 테스트) 양쪽에서 쓰기 위해 DOM·localStorage에 의존하지 않는다.
 * 기존 VBA 매크로 3개 모듈이 하던 계산을 그대로 옮겨 놓은 곳:
 *   modImport  → convertValue / applyMapping
 *   modCheck   → judge / evaluateMonth / collectUnderperformance
 *   modMail    → groupByOwner / buildMailDrafts
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Logic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MONTHS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

  /* ---------------------------------------------------------------
   * 1. 값 변환 (modImport 대체)
   * ------------------------------------------------------------- */

  /**
   * 원본 파일의 값 하나를 총괄 파일 기준 숫자로 변환한다.
   *
   * 매크로 셀프운영 가이드에 적힌 세 가지 함정을 그대로 처리한다.
   *  - 환산배율: 원본은 0.96(소수), 총괄은 96(정수)로 적는 관례 → 매핑표 L열을 곱한다
   *  - 시간serial: "00:48:00" 같은 시간 형식 → 시간 단위 숫자로 (엑셀 serial은 1 = 24시간)
   *  - 퍼센트텍스트: "+8%" 같은 텍스트 → 8
   *
   * 숫자로 해석되지 않는 값("제외", "확인필요", "TBD", 빈칸)은 null을 돌려준다.
   * VBA에서 Type Mismatch를 냈던 자리라, 여기서 걸러 내는 것이 이 함수의 핵심 역할이다.
   *
   * @returns {{value: number|null, reason: string|null}}
   */
  function convertValue(raw, scale, format) {
    var mult = Number(scale);
    if (!isFinite(mult) || mult === 0) mult = 1;
    var fmt = format || '숫자';

    if (raw === null || raw === undefined || raw === '') {
      return { value: null, reason: '빈값' };
    }

    // 시간serial — "00:48:00" 문자열 또는 엑셀 시간 serial(0~1 사이 소수)
    if (fmt === '시간serial') {
      var hours = parseTimeToHours(raw);
      if (hours === null) return { value: null, reason: '시간형식 아님' };
      return { value: round4(hours * mult), reason: null };
    }

    // 퍼센트텍스트 — "+8%", "-1.2 %", "8%"
    if (fmt === '퍼센트텍스트') {
      var pct = parsePercentText(raw);
      if (pct === null) return { value: null, reason: '퍼센트형식 아님' };
      return { value: round4(pct * mult), reason: null };
    }

    // 숫자
    if (typeof raw === 'number') {
      if (!isFinite(raw)) return { value: null, reason: '숫자 아님' };
      return { value: round4(raw * mult), reason: null };
    }

    var s = String(raw).trim().replace(/,/g, '');
    if (s === '') return { value: null, reason: '빈값' };
    // 퍼센트 기호가 붙어 오면 숫자형이어도 받아 준다(원본 파일마다 표기가 갈린다)
    var hadPercent = /%$/.test(s);
    if (hadPercent) s = s.replace(/%$/, '').trim();
    var n = Number(s);
    if (!isFinite(n)) return { value: null, reason: '숫자 아님(' + String(raw).slice(0, 20) + ')' };
    // "96%"처럼 이미 정수 퍼센트로 적힌 값에 배율 100을 또 곱하면 9600이 된다
    if (hadPercent && mult === 100) return { value: round4(n), reason: null };
    return { value: round4(n * mult), reason: null };
  }

  /** "00:48:00" / "1:30" / 엑셀 시간 serial(0.0333…) → 시간 단위 숫자 */
  function parseTimeToHours(raw) {
    if (typeof raw === 'number') {
      if (!isFinite(raw)) return null;
      return raw * 24; // 엑셀 시간 serial: 1 = 24시간
    }
    if (raw instanceof Date) {
      return raw.getHours() + raw.getMinutes() / 60 + raw.getSeconds() / 3600;
    }
    var s = String(raw).trim();
    var m = s.match(/^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/);
    if (!m) return null;
    return Number(m[1]) + Number(m[2]) / 60 + Number(m[3] || 0) / 3600;
  }

  /** "+8%" / "-1.2 %" → 8 / -1.2 */
  function parsePercentText(raw) {
    if (typeof raw === 'number') return isFinite(raw) ? raw : null;
    var s = String(raw).trim().replace(/,/g, '').replace(/\s+/g, '');
    var m = s.match(/^([+-]?\d+(?:\.\d+)?)%?$/);
    if (!m) return null;
    return Number(m[1]);
  }

  function round4(n) {
    return Math.round(n * 10000) / 10000;
  }

  /**
   * 원본 파일 행들을 매핑표에 따라 총괄 KPI 값으로 전사한다.
   *
   * @param {Array} sourceRows  [{ kpiEn, value }]  원본 파일에서 읽은 행
   * @param {Array} mappings    [{ kpiEn, kpiKo, module, direction, scale, format, excluded }]
   * @returns {{applied: Array, skipped: Array, unmatched: Array, stats: object}}
   */
  function applyMapping(sourceRows, mappings) {
    var byEn = {};
    (mappings || []).forEach(function (m) {
      byEn[normalizeKpiName(m.kpiEn)] = m;
    });

    var applied = [];
    var skipped = [];
    var unmatched = [];

    (sourceRows || []).forEach(function (row) {
      var key = normalizeKpiName(row.kpiEn);
      var map = byEn[key];
      if (!map) {
        unmatched.push({ kpiEn: row.kpiEn, raw: row.value, reason: '매핑표에 없음' });
        return;
      }
      if (map.excluded) {
        skipped.push({ kpiEn: row.kpiEn, kpiKo: map.kpiKo, raw: row.value, reason: '제외 지표' });
        return;
      }
      var conv = convertValue(row.value, map.scale, map.format);
      if (conv.value === null) {
        skipped.push({ kpiEn: row.kpiEn, kpiKo: map.kpiKo, raw: row.value, reason: conv.reason });
        return;
      }
      applied.push({
        kpiId: map.kpiId,
        kpiEn: row.kpiEn,
        kpiKo: map.kpiKo,
        module: map.module,
        value: conv.value,
        raw: row.value
      });
    });

    return {
      applied: applied,
      skipped: skipped,
      unmatched: unmatched,
      stats: {
        total: (sourceRows || []).length,
        applied: applied.length,
        skipped: skipped.length,
        unmatched: unmatched.length
      }
    };
  }

  /** 대소문자·공백·괄호 주변 표기가 파일마다 갈려서 비교 전에 눌러 준다. */
  function normalizeKpiName(name) {
    return String(name === null || name === undefined ? '' : name)
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/\s*\(\s*/g, ' (')
      .replace(/\s*\)\s*/g, ') ')
      .trim();
  }

  /* ---------------------------------------------------------------
   * 2. 달성 판정 (modCheck 대체)
   * ------------------------------------------------------------- */

  var UP = '상향(높을수록 좋음)';
  var DOWN = '하향(낮을수록 좋음)';
  var EQUAL = '목표일치';
  var RANGE = '범위내';

  /**
   * 실적 하나를 목표와 견줘 달성/미달성을 가른다.
   *
   * @param {number|null} actual
   * @param {number|null} target
   * @param {string} direction  상향/하향/목표일치/범위내
   * @param {number} [tolerance] 목표일치·범위내에서 허용 오차(기본 목표의 5%)
   * @returns {{status: '달성'|'미달성'|'판정불가', gap: number|null, gapRate: number|null}}
   */
  function judge(actual, target, direction, tolerance) {
    if (actual === null || actual === undefined || !isFinite(Number(actual))) {
      return { status: '판정불가', gap: null, gapRate: null, reason: '실적 없음' };
    }
    if (target === null || target === undefined || !isFinite(Number(target))) {
      return { status: '판정불가', gap: null, gapRate: null, reason: '목표 없음' };
    }
    var a = Number(actual);
    var t = Number(target);
    // gap = 목표 대비 얼마나 좋은가(양수면 좋은 쪽). 방향에 따라 부호가 뒤집힌다.
    var gap = direction === DOWN ? t - a : a - t;
    var gapRate = t === 0 ? null : round4((gap / Math.abs(t)) * 100);

    var tol = tolerance;
    if (tol === null || tol === undefined) tol = Math.abs(t) * 0.05;

    var ok;
    if (direction === EQUAL || direction === RANGE) {
      ok = Math.abs(a - t) <= tol;
      gap = -Math.abs(a - t);
      gapRate = t === 0 ? null : round4((gap / Math.abs(t)) * 100);
    } else if (direction === DOWN) {
      ok = a <= t;
    } else {
      ok = a >= t;
    }

    return { status: ok ? '달성' : '미달성', gap: round4(gap), gapRate: gapRate, reason: null };
  }

  /**
   * 한 사업장의 특정 월을 통째로 판정한다.
   * @param {Array} kpis  [{ id, module, nameKo, unit, target, direction, owner, actuals: {1월: n, …} }]
   */
  function evaluateMonth(kpis, month) {
    var rows = (kpis || []).map(function (k) {
      var actual = k.actuals ? k.actuals[month] : null;
      if (actual === undefined) actual = null;
      var v = judge(actual, k.target, k.direction, k.tolerance);
      return {
        id: k.id,
        module: k.module,
        nameKo: k.nameKo,
        unit: k.unit,
        owner: k.owner,
        direction: k.direction,
        target: k.target,
        actual: actual,
        status: v.status,
        gap: v.gap,
        gapRate: v.gapRate,
        reason: v.reason
      };
    });

    var achieved = rows.filter(function (r) { return r.status === '달성'; }).length;
    var under = rows.filter(function (r) { return r.status === '미달성'; }).length;
    var na = rows.filter(function (r) { return r.status === '판정불가'; }).length;
    var judged = achieved + under;

    return {
      month: month,
      rows: rows,
      summary: {
        total: rows.length,
        achieved: achieved,
        under: under,
        na: na,
        // 달성률은 판정 가능한 것만 분모로 삼는다. 미입력분을 미달성으로 세면
        // 자료가 늦게 오는 달마다 달성률이 통째로 무너져 보인다.
        rate: judged === 0 ? null : Math.round((achieved / judged) * 1000) / 10
      }
    };
  }

  /** 미달성만 추려 악화 정도(gapRate) 순으로 정렬한다. */
  function collectUnderperformance(evaluation) {
    return (evaluation.rows || [])
      .filter(function (r) { return r.status === '미달성'; })
      .sort(function (a, b) {
        var x = a.gapRate === null ? 0 : a.gapRate;
        var y = b.gapRate === null ? 0 : b.gapRate;
        return x - y; // 더 많이 벗어난 것(더 음수)이 위로
      });
  }

  /** 모듈별로 묶어 달성률을 낸다 — 대시보드용. */
  function summarizeByModule(evaluation) {
    var map = {};
    (evaluation.rows || []).forEach(function (r) {
      if (!map[r.module]) map[r.module] = { module: r.module, total: 0, achieved: 0, under: 0, na: 0 };
      var m = map[r.module];
      m.total += 1;
      if (r.status === '달성') m.achieved += 1;
      else if (r.status === '미달성') m.under += 1;
      else m.na += 1;
    });
    return Object.keys(map).map(function (k) {
      var m = map[k];
      var judged = m.achieved + m.under;
      m.rate = judged === 0 ? null : Math.round((m.achieved / judged) * 1000) / 10;
      return m;
    });
  }

  /** 월별 추이 — 12개월 달성률 배열. */
  function trendByMonth(kpis) {
    return MONTHS.map(function (mo) {
      var ev = evaluateMonth(kpis, mo);
      return { month: mo, rate: ev.summary.rate, achieved: ev.summary.achieved, under: ev.summary.under, na: ev.summary.na };
    });
  }

  /* ---------------------------------------------------------------
   * 3. 메일 초안 (modMail 대체)
   * ------------------------------------------------------------- */

  /** 미달성 지표를 담당팀(owner)별로 묶는다. 담당이 여러 팀이면 각 팀에 모두 들어간다. */
  function groupByOwner(underRows) {
    var map = {};
    (underRows || []).forEach(function (r) {
      splitOwners(r.owner).forEach(function (team) {
        if (!map[team]) map[team] = [];
        map[team].push(r);
      });
    });
    return Object.keys(map).sort().map(function (team) {
      return { owner: team, rows: map[team] };
    });
  }

  /** 총괄파일 R&R 칸에는 "생산팀\n혁신팀"처럼 줄바꿈으로 여러 팀이 들어 있다. */
  function splitOwners(owner) {
    if (!owner) return ['(담당 미지정)'];
    var parts = String(owner)
      .split(/[\n,/·]+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s !== ''; });
    return parts.length ? parts : ['(담당 미지정)'];
  }

  /**
   * 담당팀별 "사유 및 만회대책 요청" 메일 초안을 만든다.
   * @param {object} opts { site, month, contacts: [{owner, name, email}], sender }
   */
  function buildMailDrafts(underRows, opts) {
    var o = opts || {};
    var contacts = {};
    (o.contacts || []).forEach(function (c) {
      if (c && c.owner) contacts[String(c.owner).trim()] = c;
    });

    return groupByOwner(underRows).map(function (g) {
      var c = contacts[g.owner] || {};
      var subject = '[HDPS KPI] ' + (o.site || '') + ' ' + (o.month || '') + ' 미달성 지표 '
        + g.rows.length + '건 — 사유 및 만회대책 요청';

      var lines = [];
      lines.push((c.name ? c.name + '님' : g.owner + ' 담당자님') + ', 안녕하세요.');
      lines.push('');
      lines.push((o.site || '') + ' ' + (o.month || '') + ' HDPS KPI 점검 결과, 아래 ' + g.rows.length + '개 지표가 목표에 미달했습니다.');
      lines.push('각 지표의 미달 사유와 만회대책을 회신해 주시기 바랍니다.');
      lines.push('');
      g.rows.forEach(function (r, i) {
        var unit = r.unit ? ' ' + r.unit : '';
        lines.push(
          (i + 1) + '. [' + r.module + '] ' + r.nameKo + '\n'
          + '   목표 ' + fmt(r.target) + unit
          + ' / 실적 ' + fmt(r.actual) + unit
          + ' / 차이 ' + fmt(r.gap) + unit
          + (r.gapRate === null ? '' : ' (' + fmt(r.gapRate) + '%)')
          + '\n   판정기준: ' + (r.direction || '')
        );
      });
      lines.push('');
      lines.push('회신 항목: ① 미달 사유  ② 만회대책  ③ 완료 목표일  ④ 담당자');
      lines.push('');
      lines.push(o.sender || 'HDPS 사무국');

      return {
        owner: g.owner,
        to: c.email || '',
        name: c.name || '',
        count: g.rows.length,
        subject: subject,
        body: lines.join('\n'),
        rows: g.rows,
        ready: !!c.email
      };
    });
  }

  function fmt(n) {
    if (n === null || n === undefined || !isFinite(Number(n))) return '-';
    var x = Number(n);
    if (Math.abs(x - Math.round(x)) < 1e-9) return String(Math.round(x));
    return String(Math.round(x * 100) / 100);
  }

  /* ---------------------------------------------------------------
   * 4. 사업장 종합 (대시보드)
   * ------------------------------------------------------------- */

  function buildOverview(sites, month) {
    return (sites || []).map(function (s) {
      var ev = evaluateMonth(s.kpis, month);
      return {
        siteId: s.id,
        site: s.name,
        region: s.region,
        total: ev.summary.total,
        achieved: ev.summary.achieved,
        under: ev.summary.under,
        na: ev.summary.na,
        rate: ev.summary.rate
      };
    });
  }

  return {
    MONTHS: MONTHS,
    UP: UP, DOWN: DOWN, EQUAL: EQUAL, RANGE: RANGE,
    convertValue: convertValue,
    parseTimeToHours: parseTimeToHours,
    parsePercentText: parsePercentText,
    normalizeKpiName: normalizeKpiName,
    applyMapping: applyMapping,
    judge: judge,
    evaluateMonth: evaluateMonth,
    collectUnderperformance: collectUnderperformance,
    summarizeByModule: summarizeByModule,
    trendByMonth: trendByMonth,
    splitOwners: splitOwners,
    groupByOwner: groupByOwner,
    buildMailDrafts: buildMailDrafts,
    buildOverview: buildOverview,
    formatNumber: fmt
  };
});
