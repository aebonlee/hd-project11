/**
 * Supabase 어댑터 — js/store.js 와 같은 모양의 API를 Postgres 위에 올린다.
 *
 * 설계 원칙: **화면(app.js)과 계산(logic.js)은 저장 위치를 몰라야 한다.**
 * 그래서 이 파일은 Store 와 똑같은 함수 이름·반환값을 내놓고,
 * app.js 는 `DB` 하나만 보고 쓴다.
 *
 * 읽기는 시작할 때 한 번에 받아 메모리에 올리고, 쓰기는 그때그때 보낸다.
 * 지표가 사업장당 100여 개 · 사업장 6곳이라 전량을 받아도 가볍고,
 * 화면 계산이 전부 동기 함수라 이 방식이 코드가 훨씬 단순하다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.SupabaseStore = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  // 각자 자기 Supabase 프로젝트에 올리므로 테이블 접두사를 쓰지 않는다.
  var P = '';
  var client = null;
  var db = null;          // 메모리에 올린 전체 데이터 (Store 와 같은 모양)
  var lastError = null;

  function t(name) { return P + name; }

  /** supabase-js 가 로드되어 있고 설정이 켜져 있는가 */
  function available() {
    var c = root.APP_CONFIG || {};
    return !!(c.USE_SUPABASE && c.SUPABASE_URL && c.SUPABASE_ANON_KEY
      && root.supabase && typeof root.supabase.createClient === 'function');
  }

  function getClient() {
    if (client) return client;
    var c = root.APP_CONFIG;
    client = root.supabase.createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY);
    return client;
  }

  /**
   * 전체를 읽어 Store 와 같은 모양으로 조립한다.
   * @param {function} done  (err, db)
   */
  function init(done) {
    if (!available()) { done(new Error('Supabase 설정이 꺼져 있습니다.')); return; }
    var sb = getClient();

    Promise.all([
      sb.from(t('site')).select('*').order('id'),
      sb.from(t('kpi')).select('*').order('sort_order', { ascending: true, nullsFirst: false }),
      sb.from(t('actual')).select('*'),
      sb.from(t('contact')).select('*').order('owner'),
      sb.from(t('mapping')).select('*'),
      sb.from(t('log')).select('*').order('ran_at', { ascending: false }).limit(200)
    ]).then(function (res) {
      var bad = res.filter(function (r) { return r.error; });
      if (bad.length) throw bad[0].error;

      var sites = res[0].data || [];
      var kpis = res[1].data || [];
      var actuals = res[2].data || [];
      var contacts = res[3].data || [];
      var mappings = res[4].data || [];
      var logs = res[5].data || [];

      // 실적을 지표에 붙인다 — 화면 계산이 kpi.actuals['9월'] 형태를 쓴다
      var byKpi = {};
      actuals.forEach(function (a) {
        if (!byKpi[a.kpi_id]) byKpi[a.kpi_id] = {};
        byKpi[a.kpi_id][a.month] = a.value === null ? null : Number(a.value);
      });

      var kpisBySite = {};
      kpis.forEach(function (k) {
        var row = {
          id: k.id,
          module: k.module,
          moduleCode: k.module_code,
          nameKo: k.name_ko,
          nameEn: k.name_en,
          unit: k.unit,
          direction: k.direction,
          target: k.target === null ? null : Number(k.target),
          tolerance: k.tolerance === null ? null : Number(k.tolerance),
          owner: k.owner,
          scale: k.scale === null ? 1 : Number(k.scale),
          format: k.format,
          actuals: byKpi[k.id] || {}
        };
        if (!kpisBySite[k.site_id]) kpisBySite[k.site_id] = [];
        kpisBySite[k.site_id].push(row);
      });

      db = {
        source: 'supabase',
        sites: sites.map(function (s) {
          return { id: s.id, name: s.name, region: s.region, kpis: kpisBySite[s.id] || [] };
        }),
        contacts: contacts.map(function (c) {
          return { siteId: c.site_id, owner: c.owner, name: c.name || '', email: c.email || '' };
        }),
        mappings: mappings.length
          ? mappings.map(function (m) {
              var k = kpis.filter(function (x) { return x.id === m.kpi_id; })[0] || {};
              return {
                siteId: m.site_id, kpiId: m.kpi_id, kpiEn: m.kpi_en, kpiKo: k.name_ko || '',
                module: k.module || '', direction: k.direction, scale: k.scale,
                format: k.format, excluded: !!m.excluded
              };
            })
          : deriveMappings(db, kpisBySite, sites),
        logs: logs.map(function (l) {
          return {
            at: l.ran_at, kind: l.kind, siteId: l.site_id, month: l.month,
            processed: l.processed, failed: l.failed, note: l.note || ''
          };
        }),
        settings: { currentMonth: null, sender: 'HDPS 사무국', sendDirectly: false }
      };

      done(null, db);
    }).catch(function (err) {
      lastError = err;
      done(err);
    });
  }

  /** 매핑표를 따로 넣지 않았으면 지표 목록에서 파생시킨다. */
  function deriveMappings(_ignored, kpisBySite, sites) {
    var out = [];
    (sites || []).forEach(function (s) {
      (kpisBySite[s.id] || []).forEach(function (k) {
        out.push({
          siteId: s.id, kpiId: k.id, kpiEn: k.nameEn, kpiKo: k.nameKo, module: k.module,
          direction: k.direction, scale: k.scale, format: k.format, excluded: false
        });
      });
    });
    return out;
  }

  function load() { return db; }

  function getSite(siteId) {
    if (!db) return null;
    return db.sites.filter(function (s) { return s.id === siteId; })[0] || null;
  }

  function mappingsFor(siteId) {
    return db ? db.mappings.filter(function (m) { return m.siteId === siteId; }) : [];
  }

  function contactsFor(siteId) {
    return db ? db.contacts.filter(function (c) { return c.siteId === siteId; }) : [];
  }

  function setContact(siteId, owner, name, email, done) {
    var hit = (db.contacts || []).filter(function (c) {
      return c.siteId === siteId && c.owner === owner;
    })[0];
    if (hit) { hit.name = name; hit.email = email; }
    else db.contacts.push({ siteId: siteId, owner: owner, name: name, email: email });

    // ⚠ onConflict 를 반드시 지정한다. 생략하면 PK 기준이 되는데 id 를 보내지 않으므로
    //   매번 INSERT 가 되고 UNIQUE 제약(site_id, owner)에 걸려 저장이 통째로 실패한다.
    getClient().from(t('contact'))
      .upsert({ site_id: siteId, owner: owner, name: name, email: email },
              { onConflict: 'site_id,owner' })
      .then(function (r) { if (done) done(r.error || null); });
  }

  function applyImport(siteId, month, appliedRows, done) {
    var site = getSite(siteId);
    if (!site) { if (done) done(new Error('사업장을 찾지 못했습니다.'), 0); return 0; }

    var byId = {};
    site.kpis.forEach(function (k) { byId[k.id] = k; });

    var payload = [];
    (appliedRows || []).forEach(function (r) {
      var k = byId[r.kpiId];
      if (!k) return;
      if (!k.actuals) k.actuals = {};
      k.actuals[month] = r.value;
      payload.push({ kpi_id: r.kpiId, month: month, value: r.value, source: 'import' });
    });
    if (!payload.length) { if (done) done(null, 0); return 0; }

    getClient().from(t('actual'))
      .upsert(payload, { onConflict: 'kpi_id,month' })
      .then(function (res) {
        if (res.error) alert('서버 저장에 실패했습니다: ' + res.error.message
          + '\n화면 값은 바뀌었지만 저장되지 않았습니다. 새로고침 후 다시 시도하세요.');
        if (done) done(res.error || null, payload.length);
      });
    // 메모리는 이미 갱신했으므로 건수를 바로 돌려준다 (Store.applyImport 와 같은 시그니처)
    return payload.length;
  }

  function setTarget(siteId, kpiId, target, done) {
    var site = getSite(siteId);
    var k = site && site.kpis.filter(function (x) { return x.id === kpiId; })[0];
    if (!k) { if (done) done(new Error('지표를 찾지 못했습니다.')); return; }
    k.target = target;
    getClient().from(t('kpi')).update({ target: target }).eq('id', kpiId)
      .then(function (r) { if (done) done(r.error || null); });
  }

  function log(kind, siteId, month, processed, failed, note) {
    var row = {
      at: new Date().toISOString(), kind: kind, siteId: siteId, month: month,
      processed: processed, failed: failed, note: note || ''
    };
    if (db) { db.logs.unshift(row); db.logs = db.logs.slice(0, 200); }
    getClient().from(t('log')).insert({
      kind: kind, site_id: siteId, month: month,
      processed: processed, failed: failed, note: note || ''
    }).then(function () { /* 로그 실패로 화면을 막지 않는다 */ });
  }

  function settings(patch) {
    if (!db) return {};
    if (patch) Object.keys(patch).forEach(function (k) { db.settings[k] = patch[k]; });
    return db.settings;
  }

  function reset() {
    // 운영 데이터를 화면 버튼으로 지우게 두지 않는다.
    throw new Error('Supabase 모드에서는 데모 초기화를 쓸 수 없습니다.');
  }

  return {
    available: available,
    init: init,
    load: load,
    save: function () { /* 쓰기는 각 함수가 즉시 보낸다 */ },
    reset: reset,
    getSite: getSite,
    mappingsFor: mappingsFor,
    contactsFor: contactsFor,
    setContact: setContact,
    applyImport: applyImport,
    setTarget: setTarget,
    log: log,
    settings: settings,
    lastError: function () { return lastError; }
  };
});
