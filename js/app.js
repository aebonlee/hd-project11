/* 화면 컨트롤러 — 계산은 전부 Logic, 저장은 전부 Store를 거친다. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };
  var fmt = Logic.formatNumber;

  var state = {
    siteId: null,
    month: null,
    tab: 'dashboard',
    pending: null,       // 임포트 미반영 결과
    parsedSheets: null,  // 업로드한 워크북
    checkFilter: { module: '', status: '' }
  };

  /* =============== 초기화 =============== */

  function init() {
    var db = Store.load();
    state.siteId = db.sites[0] ? db.sites[0].id : null;
    state.month = db.settings.currentMonth;

    $('siteSelect').innerHTML = db.sites.map(function (s) {
      return '<option value="' + esc(s.id) + '">' + esc(s.name) + ' (' + esc(s.region) + ')</option>';
    }).join('');
    $('siteSelect').value = state.siteId;

    $('monthSelect').innerHTML = Logic.MONTHS.map(function (m) {
      return '<option value="' + esc(m) + '">' + esc(m) + '</option>';
    }).join('');
    $('monthSelect').value = state.month;

    $('senderName').value = db.settings.sender || 'HDPS 사무국';

    bind();
    renderAll();
  }

  function bind() {
    $('siteSelect').addEventListener('change', function () {
      state.siteId = this.value;
      state.pending = null;
      $('importResult').classList.add('hidden');
      renderAll();
    });
    $('monthSelect').addEventListener('change', function () {
      state.month = this.value;
      Store.settings({ currentMonth: state.month });
      renderAll();
    });
    $('btnReset').addEventListener('click', function () {
      if (!confirm('데모 데이터를 처음 상태로 되돌립니다. 계속할까요?')) return;
      Store.reset();
      location.reload();
    });

    $('tabs').addEventListener('click', function (e) {
      var b = e.target.closest('.tab');
      if (!b) return;
      state.tab = b.dataset.tab;
      Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
        t.classList.toggle('active', t === b);
      });
      Array.prototype.forEach.call(document.querySelectorAll('.panel'), function (p) {
        p.classList.toggle('hidden', p.id !== 'tab-' + state.tab);
      });
      renderAll();
    });

    $('importFile').addEventListener('change', onFilePicked);
    $('sheetSelect').addEventListener('change', onSheetChanged);
    $('nameColSelect').addEventListener('change', refreshValueColumns);
    $('btnRunImport').addEventListener('click', runImport);
    $('btnCommitImport').addEventListener('click', commitImport);
    $('btnTemplate').addEventListener('click', downloadTemplate);

    $('checkModule').addEventListener('change', function () {
      state.checkFilter.module = this.value; renderCheck();
    });
    $('checkStatus').addEventListener('change', function () {
      state.checkFilter.status = this.value; renderCheck();
    });
    $('btnExportCheck').addEventListener('click', exportCheck);

    $('senderName').addEventListener('change', function () {
      Store.settings({ sender: this.value.trim() || 'HDPS 사무국' });
      renderMail();
    });
    $('btnExportMail').addEventListener('click', exportMail);

    $('mappingSearch').addEventListener('input', renderMapping);
  }

  function site() { return Store.getSite(state.siteId); }
  function evaluation() { return Logic.evaluateMonth(site().kpis, state.month); }

  function renderAll() {
    if (state.tab === 'dashboard') renderDashboard();
    else if (state.tab === 'import') renderImportTab();
    else if (state.tab === 'check') renderCheck();
    else if (state.tab === 'mail') renderMail();
    else if (state.tab === 'mapping') renderMapping();
    else if (state.tab === 'contacts') renderContacts();
    else if (state.tab === 'logs') renderLogs();
  }

  /* =============== 대시보드 =============== */

  function renderDashboard() {
    var db = Store.load();
    $('dashMonth').textContent = state.month + ' 기준';
    $('moduleSite').textContent = site().name;
    $('trendSite').textContent = site().name;

    var ov = Logic.buildOverview(db.sites, state.month);
    $('overviewCards').innerHTML = ov.map(function (o) {
      var cls = o.siteId === state.siteId ? ' sel' : '';
      var rate = o.rate === null ? '-' : o.rate + '%';
      var tone = o.rate === null ? '' : (o.rate >= 80 ? ' ok' : (o.rate < 60 ? ' bad' : ''));
      return '<div class="stat clickable' + cls + '" data-site="' + esc(o.siteId) + '">'
        + '<div class="k">' + esc(o.site) + '</div>'
        + '<div class="v' + tone + '">' + rate + '</div>'
        + '<div class="m">달성 ' + o.achieved + ' · 미달성 ' + o.under
        + (o.na ? ' · 미입력 ' + o.na : '') + '</div></div>';
    }).join('');
    Array.prototype.forEach.call($('overviewCards').querySelectorAll('[data-site]'), function (el) {
      el.addEventListener('click', function () {
        state.siteId = el.dataset.site;
        $('siteSelect').value = state.siteId;
        renderAll();
      });
    });

    var ev = evaluation();

    var mods = Logic.summarizeByModule(ev).sort(function (a, b) {
      var x = a.rate === null ? 999 : a.rate;
      var y = b.rate === null ? 999 : b.rate;
      return x - y;
    });
    $('moduleTable').innerHTML =
      '<thead><tr><th>모듈</th><th class="num">지표</th><th class="num">달성</th>'
      + '<th class="num">미달성</th><th class="num">미입력</th><th class="num">달성률</th></tr></thead><tbody>'
      + (mods.length ? mods.map(function (m) {
        var tone = m.rate === null ? 'na' : (m.rate >= 80 ? 'ok' : (m.rate < 60 ? 'bad' : 'warn'));
        return '<tr><td>' + esc(m.module) + '</td><td class="num">' + m.total + '</td>'
          + '<td class="num">' + m.achieved + '</td><td class="num">' + m.under + '</td>'
          + '<td class="num">' + m.na + '</td>'
          + '<td class="num"><span class="pill ' + tone + '">'
          + (m.rate === null ? '-' : m.rate + '%') + '</span></td></tr>';
      }).join('') : '<tr><td class="empty" colspan="6">자료 없음</td></tr>')
      + '</tbody>';

    var tr = Logic.trendByMonth(site().kpis);
    $('trendChart').innerHTML = tr.map(function (t) {
      var h = t.rate === null ? 4 : Math.max(4, t.rate);
      var cls = t.rate === null ? 'na' : (t.rate >= 80 ? '' : (t.rate < 60 ? 'low' : 'mid'));
      return '<div class="bar" title="' + esc(t.month) + ' 달성 ' + t.achieved + ' / 미달성 ' + t.under + '">'
        + '<div class="val">' + (t.rate === null ? '' : t.rate) + '</div>'
        + '<div class="fill ' + cls + '" style="height:' + h + '%"></div>'
        + '<div class="lbl">' + esc(t.month.replace('월', '')) + '</div></div>';
    }).join('');

    var top = Logic.collectUnderperformance(ev).slice(0, 12);
    $('topUnderTable').innerHTML =
      '<thead><tr><th>모듈</th><th>지표</th><th>담당</th><th class="num">목표</th>'
      + '<th class="num">실적</th><th class="num">차이</th><th class="num">이탈률</th></tr></thead><tbody>'
      + (top.length ? top.map(function (r) {
        return '<tr class="is-bad"><td>' + esc(r.module) + '</td><td>' + esc(r.nameKo) + '</td>'
          + '<td>' + esc(String(r.owner || '').replace(/\n/g, ', ')) + '</td>'
          + '<td class="num">' + fmt(r.target) + ' ' + esc(r.unit || '') + '</td>'
          + '<td class="num">' + fmt(r.actual) + '</td>'
          + '<td class="num">' + fmt(r.gap) + '</td>'
          + '<td class="num">' + (r.gapRate === null ? '-' : fmt(r.gapRate) + '%') + '</td></tr>';
      }).join('') : '<tr><td class="empty" colspan="7">미달성 지표가 없습니다.</td></tr>')
      + '</tbody>';
  }

  /* =============== 임포트 =============== */

  function renderImportTab() {
    if (state.pending) renderImportResult();
  }

  function onFilePicked(e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      try {
        state.parsedSheets = Importer.readWorkbook(new Uint8Array(fr.result));
      } catch (err) {
        alert('엑셀을 읽지 못했습니다: ' + err.message);
        return;
      }
      $('sheetSelect').innerHTML = state.parsedSheets.map(function (s, i) {
        return '<option value="' + i + '">' + esc(s.name) + ' (' + s.grid.length + '행)</option>';
      }).join('');
      $('importSetup').classList.remove('hidden');
      onSheetChanged();
    };
    fr.readAsArrayBuffer(f);
  }

  function currentGrid() {
    var i = Number($('sheetSelect').value || 0);
    return state.parsedSheets[i] ? state.parsedSheets[i].grid : [];
  }

  function onSheetChanged() {
    var grid = currentGrid();
    var maps = Store.mappingsFor(state.siteId);
    var det = Importer.detectNameColumn(grid, maps);

    var width = 0;
    grid.forEach(function (r) { if (r && r.length > width) width = r.length; });
    var opts = [];
    for (var c = 0; c < width; c++) {
      opts.push('<option value="' + c + '">' + esc(Importer.colLetter(c)) + '열</option>');
    }
    $('nameColSelect').innerHTML = opts.join('');
    if (det.col >= 0) $('nameColSelect').value = String(det.col);

    $('detectNote').innerHTML = det.hits > 0
      ? '자동 인식: <b>' + esc(Importer.colLetter(det.col)) + '열</b>에서 매핑표와 일치하는 지표명 <b>'
        + det.hits + '건</b>을 찾았습니다.'
      : '<b>지표명이 하나도 맞지 않습니다.</b> 열을 직접 고르거나, 표준 양식을 내려받아 채워 올려 주세요.';

    refreshValueColumns();
  }

  function refreshValueColumns() {
    var grid = currentGrid();
    var nameCol = Number($('nameColSelect').value || 0);
    var cands = Importer.candidateValueColumns(grid, nameCol);
    $('valueColSelect').innerHTML = cands.length
      ? cands.map(function (c) {
          var sample = c.sample.map(function (v) { return String(v).slice(0, 10); }).join(', ');
          return '<option value="' + c.col + '">' + esc(Importer.colLetter(c.col)) + '열 — '
            + esc(c.header) + ' (' + sample + ')</option>';
        }).join('')
      : '<option value="-1">값 열 없음</option>';
  }

  function runImport() {
    var grid = currentGrid();
    var nameCol = Number($('nameColSelect').value || 0);
    var valueCol = Number($('valueColSelect').value);
    if (valueCol < 0) { alert('값 열을 고를 수 없습니다.'); return; }

    var rows = Importer.extractRows(grid, nameCol, valueCol);
    var maps = Store.mappingsFor(state.siteId);
    state.pending = Logic.applyMapping(rows, maps);
    renderImportResult();
  }

  function renderImportResult() {
    var r = state.pending;
    if (!r) return;
    $('importResult').classList.remove('hidden');

    $('importStats').innerHTML = [
      ['읽은 행', r.stats.total, ''],
      ['전사 대상', r.stats.applied, 'ok'],
      ['건너뜀', r.stats.skipped, ''],
      ['매핑 누락', r.stats.unmatched, r.stats.unmatched ? 'bad' : '']
    ].map(function (x) {
      return '<div class="stat"><div class="k">' + x[0] + '</div>'
        + '<div class="v ' + x[2] + '">' + x[1] + '</div></div>';
    }).join('');

    $('skippedTable').innerHTML =
      '<thead><tr><th>지표</th><th>원본값</th><th>사유</th></tr></thead><tbody>'
      + (r.skipped.length ? r.skipped.slice(0, 200).map(function (s) {
        return '<tr><td>' + esc(s.kpiKo || s.kpiEn) + '</td><td>' + esc(s.raw) + '</td>'
          + '<td>' + esc(s.reason) + '</td></tr>';
      }).join('') : '<tr><td class="empty" colspan="3">없음</td></tr>')
      + '</tbody>';

    $('unmatchedTable').innerHTML =
      '<thead><tr><th>원본 지표명</th><th>값</th></tr></thead><tbody>'
      + (r.unmatched.length ? r.unmatched.slice(0, 200).map(function (s) {
        return '<tr><td>' + esc(s.kpiEn) + '</td><td>' + esc(s.raw) + '</td></tr>';
      }).join('') : '<tr><td class="empty" colspan="2">없음</td></tr>')
      + '</tbody>';

    $('commitNote').textContent = state.month + ' 실적에 ' + r.stats.applied + '건이 들어갑니다.';
  }

  function commitImport() {
    if (!state.pending) return;
    var n = Store.applyImport(state.siteId, state.month, state.pending.applied);
    Store.log('데이터 자동입력', state.siteId, state.month, n,
      state.pending.stats.unmatched, '건너뜀 ' + state.pending.stats.skipped + '건');
    alert(state.month + ' 실적 ' + n + '건을 반영했습니다.');
    state.pending = null;
    $('importResult').classList.add('hidden');
    $('importFile').value = '';
    $('importSetup').classList.add('hidden');
  }

  function downloadTemplate() {
    var wb = Importer.buildTemplate(Store.mappingsFor(state.siteId), state.month);
    XLSX.writeFile(wb, 'HDPS_원본실적_양식_' + site().name + '_' + state.month + '.xlsx');
  }

  /* =============== 판정 =============== */

  function renderCheck() {
    var ev = evaluation();

    var mods = {};
    ev.rows.forEach(function (r) { mods[r.module] = true; });
    var cur = state.checkFilter.module;
    $('checkModule').innerHTML = '<option value="">전체 모듈</option>'
      + Object.keys(mods).sort().map(function (m) {
        return '<option value="' + esc(m) + '">' + esc(m) + '</option>';
      }).join('');
    $('checkModule').value = cur;

    $('checkStats').innerHTML = [
      ['전체 지표', ev.summary.total, ''],
      ['달성', ev.summary.achieved, 'ok'],
      ['미달성', ev.summary.under, 'bad'],
      ['미입력', ev.summary.na, ''],
      ['달성률', ev.summary.rate === null ? '-' : ev.summary.rate + '%', '']
    ].map(function (x) {
      return '<div class="stat"><div class="k">' + x[0] + '</div>'
        + '<div class="v ' + x[2] + '">' + x[1] + '</div></div>';
    }).join('');

    var rows = ev.rows.filter(function (r) {
      if (state.checkFilter.module && r.module !== state.checkFilter.module) return false;
      if (state.checkFilter.status && r.status !== state.checkFilter.status) return false;
      return true;
    });

    $('checkTable').innerHTML =
      '<thead><tr><th>모듈</th><th>지표</th><th>담당</th><th>판정기준</th>'
      + '<th class="num">목표</th><th class="num">실적</th><th class="num">차이</th>'
      + '<th class="num">이탈률</th><th>판정</th></tr></thead><tbody>'
      + (rows.length ? rows.map(function (r) {
        var cls = r.status === '미달성' ? 'is-bad' : (r.status === '달성' ? 'is-ok' : '');
        var pill = r.status === '미달성' ? 'bad' : (r.status === '달성' ? 'ok' : 'na');
        return '<tr class="' + cls + '"><td>' + esc(r.module) + '</td>'
          + '<td>' + esc(r.nameKo) + '</td>'
          + '<td>' + esc(String(r.owner || '').replace(/\n/g, ', ')) + '</td>'
          + '<td>' + esc(String(r.direction || '').replace(/\(.*\)/, '')) + '</td>'
          + '<td class="num">' + fmt(r.target) + ' ' + esc(r.unit || '') + '</td>'
          + '<td class="num">' + fmt(r.actual) + '</td>'
          + '<td class="num">' + fmt(r.gap) + '</td>'
          + '<td class="num">' + (r.gapRate === null ? '-' : fmt(r.gapRate) + '%') + '</td>'
          + '<td><span class="pill ' + pill + '">' + esc(r.status) + '</span></td></tr>';
      }).join('') : '<tr><td class="empty" colspan="9">해당 지표가 없습니다.</td></tr>')
      + '</tbody>';
  }

  function exportCheck() {
    var ev = evaluation();
    var aoa = [['모듈', '지표', '담당', '판정기준', '목표', '단위', '실적', '차이', '이탈률(%)', '판정']];
    ev.rows.forEach(function (r) {
      aoa.push([r.module, r.nameKo, String(r.owner || '').replace(/\n/g, ', '), r.direction,
        r.target, r.unit, r.actual, r.gap, r.gapRate, r.status]);
    });
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 20 }, { wch: 40 }, { wch: 16 }, { wch: 18 }, { wch: 10 },
                   { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '판정결과');

    var un = Logic.collectUnderperformance(ev);
    var aoa2 = [['모듈', '지표', '담당', '목표', '단위', '실적', '차이', '이탈률(%)']];
    un.forEach(function (r) {
      aoa2.push([r.module, r.nameKo, String(r.owner || '').replace(/\n/g, ', '),
        r.target, r.unit, r.actual, r.gap, r.gapRate]);
    });
    var ws2 = XLSX.utils.aoa_to_sheet(aoa2);
    ws2['!cols'] = [{ wch: 20 }, { wch: 40 }, { wch: 16 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws2, '미달성목록');

    XLSX.writeFile(wb, 'HDPS_KPI_판정_' + site().name + '_' + state.month + '.xlsx');
    Store.log('달성 판정', state.siteId, state.month, ev.summary.total, ev.summary.under, '엑셀 내보내기');
    renderLogs();
  }

  /* =============== 메일 =============== */

  function currentDrafts() {
    var ev = evaluation();
    return Logic.buildMailDrafts(Logic.collectUnderperformance(ev), {
      site: site().name,
      month: state.month,
      contacts: Store.contactsFor(state.siteId),
      sender: Store.settings().sender
    });
  }

  function renderMail() {
    var drafts = currentDrafts();
    if (!drafts.length) {
      $('mailList').innerHTML = '<p class="note">' + esc(state.month)
        + ' 미달성 지표가 없어 보낼 메일이 없습니다.</p>';
      return;
    }
    $('mailList').innerHTML = drafts.map(function (d, i) {
      var badge = d.ready
        ? '<span class="pill ok">발송 준비</span>'
        : '<span class="pill warn">이메일 미등록</span>';
      return '<div class="mail">'
        + '<div class="mail-head">'
        + '<span class="who">' + esc(d.owner) + '</span>'
        + '<span class="pill na">미달성 ' + d.count + '건</span>'
        + badge
        + '<span class="small">' + esc(d.to || '수신자 없음') + '</span>'
        + '<span class="spacer"></span>'
        + '<button type="button" class="btn small" data-copy="' + i + '">본문 복사</button>'
        + '<button type="button" class="btn small primary" data-send="' + i + '"'
        + (d.ready ? '' : ' disabled') + '>메일 열기</button>'
        + '</div>'
        + '<pre class="mail-body">' + esc(d.subject) + '\n\n' + esc(d.body) + '</pre>'
        + '</div>';
    }).join('');

    Array.prototype.forEach.call($('mailList').querySelectorAll('[data-copy]'), function (b) {
      b.addEventListener('click', function () {
        var d = drafts[Number(b.dataset.copy)];
        copyText(d.subject + '\n\n' + d.body, b);
      });
    });
    Array.prototype.forEach.call($('mailList').querySelectorAll('[data-send]'), function (b) {
      b.addEventListener('click', function () {
        var d = drafts[Number(b.dataset.send)];
        var href = 'mailto:' + encodeURIComponent(d.to)
          + '?subject=' + encodeURIComponent(d.subject)
          + '&body=' + encodeURIComponent(d.body);
        window.location.href = href;
        Store.log('미달성 메일', state.siteId, state.month, d.count, 0, d.owner + ' → ' + d.to);
      });
    });
  }

  function copyText(text, btn) {
    var done = function () {
      var old = btn.textContent;
      btn.textContent = '복사됨';
      setTimeout(function () { btn.textContent = old; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    } else fallback();

    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { alert('복사에 실패했습니다.'); }
      document.body.removeChild(ta);
    }
  }

  function exportMail() {
    var drafts = currentDrafts();
    var aoa = [['담당팀', '수신자명', '이메일', '미달성건수', '제목', '본문']];
    drafts.forEach(function (d) {
      aoa.push([d.owner, d.name, d.to, d.count, d.subject, d.body]);
    });
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 28 }, { wch: 10 }, { wch: 50 }, { wch: 80 }];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '메일초안');
    XLSX.writeFile(wb, 'HDPS_미달성메일초안_' + site().name + '_' + state.month + '.xlsx');
  }

  /* =============== 매핑표 =============== */

  function renderMapping() {
    var q = ($('mappingSearch').value || '').trim().toLowerCase();
    var maps = Store.mappingsFor(state.siteId).filter(function (m) {
      if (!q) return true;
      return (m.kpiEn + ' ' + m.kpiKo + ' ' + m.module).toLowerCase().indexOf(q) >= 0;
    });
    $('mappingCount').textContent = maps.length + '건';
    $('mappingTable').innerHTML =
      '<thead><tr><th>모듈</th><th>원본 영문 지표명</th><th>총괄 국문 지표명</th>'
      + '<th>판정방향</th><th class="num">환산배율</th><th>값형식</th></tr></thead><tbody>'
      + (maps.length ? maps.map(function (m) {
        return '<tr><td>' + esc(m.module) + '</td><td>' + esc(m.kpiEn) + '</td>'
          + '<td>' + esc(m.kpiKo) + '</td>'
          + '<td>' + esc(String(m.direction || '').replace(/\(.*\)/, '')) + '</td>'
          + '<td class="num">×' + esc(m.scale) + '</td>'
          + '<td>' + esc(m.format) + '</td></tr>';
      }).join('') : '<tr><td class="empty" colspan="6">검색 결과 없음</td></tr>')
      + '</tbody>';
  }

  /* =============== 담당자 =============== */

  function renderContacts() {
    var list = Store.contactsFor(state.siteId);
    $('contactTable').innerHTML =
      '<thead><tr><th>담당팀/부서</th><th>담당자명</th><th>이메일</th><th class="num">이번 달 미달성</th></tr></thead><tbody>'
      + list.map(function (c, i) {
        var drafts = currentDrafts().filter(function (d) { return d.owner === c.owner; });
        var cnt = drafts.length ? drafts[0].count : 0;
        return '<tr><td>' + esc(c.owner) + '</td>'
          + '<td><input type="text" data-ci="' + i + '" data-f="name" value="' + esc(c.name) + '" placeholder="담당자명"></td>'
          + '<td><input type="email" data-ci="' + i + '" data-f="email" value="' + esc(c.email) + '" placeholder="name@example.com"></td>'
          + '<td class="num">' + (cnt ? '<span class="pill bad">' + cnt + '건</span>' : '-') + '</td></tr>';
      }).join('')
      + '</tbody>';

    Array.prototype.forEach.call($('contactTable').querySelectorAll('input[data-ci]'), function (inp) {
      inp.addEventListener('change', function () {
        var c = list[Number(inp.dataset.ci)];
        var name = inp.dataset.f === 'name' ? inp.value.trim() : c.name;
        var email = inp.dataset.f === 'email' ? inp.value.trim() : c.email;
        Store.setContact(state.siteId, c.owner, name, email);
        renderContacts();
      });
    });
  }

  /* =============== 로그 =============== */

  function renderLogs() {
    var logs = Store.load().logs;
    $('logTable').innerHTML =
      '<thead><tr><th>실행일시</th><th>작업</th><th>사업장</th><th>월</th>'
      + '<th class="num">처리</th><th class="num">실패</th><th>비고</th></tr></thead><tbody>'
      + (logs.length ? logs.map(function (l) {
        var s = Store.getSite(l.siteId);
        return '<tr><td>' + esc(new Date(l.at).toLocaleString('ko-KR')) + '</td>'
          + '<td>' + esc(l.kind) + '</td><td>' + esc(s ? s.name : l.siteId) + '</td>'
          + '<td>' + esc(l.month) + '</td><td class="num">' + l.processed + '</td>'
          + '<td class="num">' + l.failed + '</td><td>' + esc(l.note) + '</td></tr>';
      }).join('') : '<tr><td class="empty" colspan="7">실행 이력이 없습니다.</td></tr>')
      + '</tbody>';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
