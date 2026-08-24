/**
 * 데모 저장소 — localStorage 단일 JSON 문서.
 *
 * 데이터 접근은 전부 이 파일을 거친다. 실서비스로 옮길 때
 * load/save/log 세 함수만 Supabase 호출로 바꾸면 나머지는 그대로 돌아간다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.Store = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var KEY = 'hdps_kpi_db_v1';
  var Seed = root.SeedData || (typeof require === 'function' ? require('./seed-data.js') : null);

  var cache = null;

  function seed() {
    var src = Seed || { sites: [], contacts: [], months: [] };
    return {
      version: 1,
      sites: deepCopy(src.sites || []),
      contacts: deepCopy(src.contacts || []),
      mappings: buildMappingsFromSites(src.sites || []),
      logs: [],
      settings: {
        currentMonth: pickDefaultMonth(src.sites || []),
        sender: 'HDPS 사무국',
        sendDirectly: false
      }
    };
  }

  /**
   * 매핑표는 KPI 목록에서 파생시킨다(영문 원본명 → 국문 총괄명).
   * 매크로 설정워크북의 "매핑_인도"·"매핑_브라질" 탭에 해당한다.
   */
  function buildMappingsFromSites(sites) {
    var out = [];
    sites.forEach(function (s) {
      (s.kpis || []).forEach(function (k) {
        out.push({
          siteId: s.id,
          kpiId: k.id,
          kpiEn: k.nameEn,
          kpiKo: k.nameKo,
          module: k.module,
          direction: k.direction,
          scale: k.scale,
          format: k.format,
          excluded: false
        });
      });
    });
    return out;
  }

  /**
   * 기본 선택은 "마지막으로 자료가 거의 다 들어온 달"이다.
   *
   * 단순히 값이 하나라도 있는 마지막 달을 고르면, 자료가 이제 막 들어오기
   * 시작한 달이 잡혀 첫 화면이 온통 '미입력'으로 보인다. 실제 업무에서
   * 보고 기준이 되는 달도 직전 마감월이라, 채움률 80%를 문턱으로 둔다.
   */
  function pickDefaultMonth(sites) {
    var months = (Seed && Seed.months) || [];
    var best = null;
    for (var i = months.length - 1; i >= 0; i--) {
      var mo = months[i];
      var total = 0, filled = 0;
      sites.forEach(function (s) {
        (s.kpis || []).forEach(function (k) {
          total++;
          if (k.actuals && k.actuals[mo] !== undefined && k.actuals[mo] !== null) filled++;
        });
      });
      if (total === 0) continue;
      if (best === null && filled > 0) best = mo;        // 최소한의 대비책
      if (filled / total >= 0.8) return mo;
    }
    return best || months[0] || '1월';
  }

  function deepCopy(v) { return JSON.parse(JSON.stringify(v)); }

  function storage() {
    try { return root.localStorage || null; } catch (e) { return null; }
  }

  function load() {
    if (cache) return cache;
    var ls = storage();
    if (ls) {
      try {
        var raw = ls.getItem(KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && parsed.sites) { cache = parsed; return cache; }
        }
      } catch (e) { /* 깨진 값이면 새로 만든다 */ }
    }
    cache = seed();
    save();
    return cache;
  }

  function save() {
    var ls = storage();
    if (!ls || !cache) return;
    try { ls.setItem(KEY, JSON.stringify(cache)); }
    catch (e) { /* 용량 초과 등 — 데모라 조용히 넘긴다 */ }
  }

  function reset() {
    cache = seed();
    save();
    return cache;
  }

  function getSite(siteId) {
    return load().sites.filter(function (s) { return s.id === siteId; })[0] || null;
  }

  function mappingsFor(siteId) {
    return load().mappings.filter(function (m) { return m.siteId === siteId; });
  }

  function contactsFor(siteId) {
    return load().contacts.filter(function (c) { return c.siteId === siteId; });
  }

  function setContact(siteId, owner, name, email) {
    var db = load();
    var hit = db.contacts.filter(function (c) { return c.siteId === siteId && c.owner === owner; })[0];
    if (hit) { hit.name = name; hit.email = email; }
    else db.contacts.push({ siteId: siteId, owner: owner, name: name, email: email });
    save();
  }

  /** 임포트 결과를 KPI 실적에 반영한다. */
  function applyImport(siteId, month, appliedRows) {
    var site = getSite(siteId);
    if (!site) return 0;
    var byId = {};
    site.kpis.forEach(function (k) { byId[k.id] = k; });
    var n = 0;
    (appliedRows || []).forEach(function (r) {
      var k = byId[r.kpiId];
      if (!k) return;
      if (!k.actuals) k.actuals = {};
      k.actuals[month] = r.value;
      n++;
    });
    save();
    return n;
  }

  function setTarget(siteId, kpiId, target) {
    var site = getSite(siteId);
    if (!site) return false;
    var k = site.kpis.filter(function (x) { return x.id === kpiId; })[0];
    if (!k) return false;
    k.target = target;
    save();
    return true;
  }

  function log(kind, siteId, month, processed, failed, note) {
    var db = load();
    db.logs.unshift({
      at: new Date().toISOString(),
      kind: kind,
      siteId: siteId,
      month: month,
      processed: processed,
      failed: failed,
      note: note || ''
    });
    db.logs = db.logs.slice(0, 200);
    save();
  }

  function settings(patch) {
    var db = load();
    if (patch) { Object.keys(patch).forEach(function (k) { db.settings[k] = patch[k]; }); save(); }
    return db.settings;
  }

  return {
    KEY: KEY,
    load: load,
    save: save,
    reset: reset,
    getSite: getSite,
    mappingsFor: mappingsFor,
    contactsFor: contactsFor,
    setContact: setContact,
    applyImport: applyImport,
    setTarget: setTarget,
    log: log,
    settings: settings,
    _seed: seed
  };
});
