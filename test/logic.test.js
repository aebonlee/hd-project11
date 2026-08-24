/**
 * 단위 테스트 — node test/logic.test.js
 *
 * 매크로가 실제로 틀렸던 자리(환산배율 100배, 시간 형식, 퍼센트 텍스트,
 * "제외" 같은 텍스트와 숫자 비교)를 중심으로 검증한다.
 */
'use strict';

var Logic = require('../js/logic.js');

var pass = 0, fail = 0;

function eq(actual, expected, label) {
  var a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass++; }
  else { fail++; console.error('  ✗ ' + label + '\n      기대: ' + b + '\n      실제: ' + a); }
}
function ok(cond, label) { eq(!!cond, true, label); }
function group(name) { console.log('\n' + name); }

/* ---------------- 값 변환 ---------------- */
group('1. 값 변환 (modImport)');

eq(Logic.convertValue(0.96, 100, '숫자').value, 96, '환산배율 100 — 0.96 → 96');
eq(Logic.convertValue(3.81, 1, '숫자').value, 3.81, '환산배율 1 — 그대로');
eq(Logic.convertValue('0.88', 100, '숫자').value, 88, '문자열 숫자도 변환된다');
eq(Logic.convertValue('1,234', 1, '숫자').value, 1234, '천단위 쉼표 제거');

// 원본 파일마다 "96%"로 적힌 경우가 섞여 있다. 배율 100을 또 곱하면 9600이 된다.
eq(Logic.convertValue('96%', 100, '숫자').value, 96, '이미 퍼센트로 적힌 값에 배율을 또 곱하지 않는다');

eq(Logic.convertValue('00:48:00', 1, '시간serial').value, 0.8, '시간serial "00:48:00" → 0.8시간');
eq(Logic.convertValue('1:30', 1, '시간serial').value, 1.5, '시간serial "1:30" → 1.5시간');
eq(Logic.convertValue(0.5, 1, '시간serial').value, 12, '엑셀 시간 serial 0.5 → 12시간');

eq(Logic.convertValue('+8%', 1, '퍼센트텍스트').value, 8, '퍼센트텍스트 "+8%" → 8');
eq(Logic.convertValue('-1.2 %', 1, '퍼센트텍스트').value, -1.2, '퍼센트텍스트 음수');

// VBA에서 Type Mismatch를 내던 자리 — 여기서는 null로 걸러져야 한다
eq(Logic.convertValue('제외', 1, '숫자').value, null, '"제외" 텍스트는 null');
eq(Logic.convertValue('TBD', 1, '숫자').value, null, '"TBD" 텍스트는 null');
eq(Logic.convertValue(null, 1, '숫자').value, null, '빈값은 null');
eq(Logic.convertValue('', 100, '숫자').value, null, '빈 문자열은 null');
eq(Logic.convertValue('확인필요', 100, '숫자').reason, '숫자 아님(확인필요)', '거른 사유가 남는다');
eq(Logic.convertValue('abc', 1, '시간serial').value, null, '시간형식이 아니면 null');

// 배율이 0이거나 비어 있으면 1로 본다 — 매핑표 L열이 비어 오는 일이 잦다
eq(Logic.convertValue(5, 0, '숫자').value, 5, '환산배율 0은 1로 취급');
eq(Logic.convertValue(5, null, '숫자').value, 5, '환산배율 없음은 1로 취급');

/* ---------------- 매핑 ---------------- */
group('2. 매핑 적용');

var MAPS = [
  { kpiId: 'K1', kpiEn: 'Line wise SQDCEI KPIs Achievement Rate', kpiKo: 'SQDC 목표달성팀 비율',
    module: '목표지향적 팀운영', direction: Logic.UP, scale: 100, format: '숫자', excluded: false },
  { kpiId: 'K2', kpiEn: 'Man-hours Loss per machine', kpiKo: '대당 비가동 MH',
    module: '생산이슈관리', direction: Logic.DOWN, scale: 1, format: '숫자', excluded: false },
  { kpiId: 'K3', kpiEn: 'Self Improvements Participation Rate', kpiKo: '자발적 개선 참여율',
    module: '개선활동', direction: Logic.UP, scale: 100, format: '숫자', excluded: true }
];

var res = Logic.applyMapping([
  { kpiEn: 'Line wise SQDCEI KPIs Achievement Rate', value: 0.88 },
  { kpiEn: 'Man-hours Loss per machine', value: 5.41 },
  { kpiEn: 'Self Improvements Participation Rate', value: 0.7 },
  { kpiEn: 'Unknown Brand New KPI', value: 12 },
  { kpiEn: 'Man-hours Loss per machine', value: '제외' }
], MAPS);

eq(res.stats.total, 5, '읽은 행 수');
eq(res.stats.applied, 2, '전사 대상 2건');
eq(res.stats.skipped, 2, '건너뜀 2건 (제외 지표 + 숫자 아님)');
eq(res.stats.unmatched, 1, '매핑 누락 1건');
eq(res.applied[0].value, 88, '배율 적용된 값이 들어간다');
eq(res.applied[1].value, 5.41, '배율 1은 그대로');
eq(res.unmatched[0].kpiEn, 'Unknown Brand New KPI', '누락된 이름이 남는다');
eq(res.skipped[0].reason, '제외 지표', '제외 지표 사유');

// 대소문자·공백이 갈려도 같은 지표로 붙어야 한다
var res2 = Logic.applyMapping(
  [{ kpiEn: '  MAN-HOURS   LOSS per Machine ', value: 3 }], MAPS);
eq(res2.stats.applied, 1, '대소문자·공백이 달라도 매칭된다');

/* ---------------- 판정 ---------------- */
group('3. 달성 판정 (modCheck)');

eq(Logic.judge(95, 90, Logic.UP).status, '달성', '상향: 실적이 목표 이상이면 달성');
eq(Logic.judge(85, 90, Logic.UP).status, '미달성', '상향: 목표 미만이면 미달성');
eq(Logic.judge(90, 90, Logic.UP).status, '달성', '상향: 목표와 같으면 달성');

eq(Logic.judge(3.2, 3.81, Logic.DOWN).status, '달성', '하향: 목표보다 낮으면 달성');
eq(Logic.judge(5.41, 3.81, Logic.DOWN).status, '미달성', '하향: 목표보다 높으면 미달성');

// gap 부호는 방향과 무관하게 "양수면 좋은 쪽"이어야 메일 본문이 읽힌다
ok(Logic.judge(95, 90, Logic.UP).gap > 0, '상향 초과달성이면 gap 양수');
ok(Logic.judge(3.0, 3.81, Logic.DOWN).gap > 0, '하향 초과달성이면 gap 양수');
ok(Logic.judge(5.41, 3.81, Logic.DOWN).gap < 0, '하향 미달성이면 gap 음수');

eq(Logic.judge(null, 90, Logic.UP).status, '판정불가', '실적 없으면 판정불가');
eq(Logic.judge(90, null, Logic.UP).status, '판정불가', '목표 없으면 판정불가');
eq(Logic.judge('제외', 90, Logic.UP).status, '판정불가', '텍스트 실적은 판정불가(Type Mismatch 방지)');

eq(Logic.judge(100, 100, Logic.EQUAL).status, '달성', '목표일치: 같으면 달성');
eq(Logic.judge(104, 100, Logic.EQUAL).status, '달성', '목표일치: 기본 허용오차 5% 안이면 달성');
eq(Logic.judge(120, 100, Logic.EQUAL).status, '미달성', '목표일치: 허용오차 밖이면 미달성');
eq(Logic.judge(120, 100, Logic.RANGE, 25).status, '달성', '범위내: 허용오차를 직접 주면 그 값을 쓴다');

/* ---------------- 월 단위 평가 ---------------- */
group('4. 월 단위 평가');

var KPIS = [
  { id: 'A', module: '안전과환경', nameKo: 'LTIR', unit: '건', target: 2, direction: Logic.DOWN,
    owner: 'EHS팀', actuals: { '1월': 1, '2월': 3 } },
  { id: 'B', module: '안전과환경', nameKo: '위험발굴 건수', unit: '건/년', target: 420, direction: Logic.UP,
    owner: 'EHS팀\n생산팀', actuals: { '1월': 500, '2월': 300 } },
  { id: 'C', module: '품질보증', nameKo: '입고 직행율', unit: '%', target: 92.5, direction: Logic.UP,
    owner: 'ALC', actuals: { '1월': 93 } }
];

var ev1 = Logic.evaluateMonth(KPIS, '1월');
eq(ev1.summary, { total: 3, achieved: 3, under: 0, na: 0, rate: 100 }, '1월 전부 달성');

var ev2 = Logic.evaluateMonth(KPIS, '2월');
eq(ev2.summary, { total: 3, achieved: 0, under: 2, na: 1, rate: 0 },
  '2월 — 미입력 1건은 분모에서 빠진다');

// 미입력을 미달성으로 세면 자료가 늦는 달마다 달성률이 통째로 무너져 보인다
ok(ev2.summary.rate === 0 && ev2.summary.na === 1, '미입력은 미달성과 구분된다');

var ev3 = Logic.evaluateMonth(KPIS, '12월');
eq(ev3.summary.rate, null, '한 건도 없는 달의 달성률은 null (0%가 아니다)');

var mods = Logic.summarizeByModule(ev1).sort(function (a, b) { return a.module < b.module ? -1 : 1; });
eq(mods.length, 2, '모듈 2개로 묶인다');
eq(mods[0].total, 2, '안전과환경 2건');

var trend = Logic.trendByMonth(KPIS);
eq(trend.length, 12, '추이는 12개월');
eq(trend[0].rate, 100, '1월 추이 100%');
eq(trend[11].rate, null, '12월 추이 null');

/* ---------------- 미달성 정렬 ---------------- */
group('5. 미달성 수집');

var under = Logic.collectUnderperformance(ev2);
eq(under.length, 2, '미달성 2건');
// 건수가 어긋나면 아래 정렬 검사에서 터진다. 원인은 위 한 줄로 이미 드러났으니
// 여기서 멈추지 말고 뒤 항목까지 다 재고 넘어간다.
ok(under.length >= 2 && under[0].gapRate <= under[1].gapRate, '많이 벗어난 것이 앞에 온다');

/* ---------------- 담당팀 분해 ---------------- */
group('6. 담당팀 분해 (modMail)');

eq(Logic.splitOwners('생산팀\n혁신팀'), ['생산팀', '혁신팀'], '줄바꿈으로 두 팀');
eq(Logic.splitOwners('ALC, PPIC팀 / 품질팀'), ['ALC', 'PPIC팀', '품질팀'], '쉼표·슬래시도 나눈다');
eq(Logic.splitOwners(''), ['(담당 미지정)'], '빈 담당은 미지정');
eq(Logic.splitOwners(null), ['(담당 미지정)'], 'null 담당도 미지정');

var groups = Logic.groupByOwner(under);
var names = groups.map(function (g) { return g.owner; }).sort();
eq(names, ['EHS팀', '생산팀'], '두 팀에 각각 들어간다');
// B는 EHS팀·생산팀 양쪽 담당이라 두 묶음 모두에 나타나야 한다
var ehs = groups.filter(function (g) { return g.owner === 'EHS팀'; })[0];
eq(ehs.rows.length, 2, 'EHS팀은 A·B 둘 다 받는다');

/* ---------------- 메일 초안 ---------------- */
group('7. 메일 초안');

var drafts = Logic.buildMailDrafts(under, {
  site: '인도법인', month: '2월', sender: 'HDPS 사무국',
  contacts: [{ owner: 'EHS팀', name: 'Uday K.', email: 'uday.k@example.com' }]
});

// 앞 단계가 깨지면 초안이 아예 안 나올 수 있다. 그때 여기서 터져 버리면
// 진짜 원인(판정 로직)이 출력에서 잘려 보이지 않으므로 빈 객체로 받아 둔다.
var ehsDraft = drafts.filter(function (d) { return d.owner === 'EHS팀'; })[0] || {};
var prodDraft = drafts.filter(function (d) { return d.owner === '생산팀'; })[0] || {};
eq(typeof ehsDraft.body, 'string', 'EHS팀 초안이 만들어졌다');
eq(typeof prodDraft.body, 'string', '생산팀 초안이 만들어졌다');
ehsDraft.body = ehsDraft.body || '';
prodDraft.body = prodDraft.body || '';
ehsDraft.subject = ehsDraft.subject || '';

ok(ehsDraft.ready === true, '이메일이 등록된 팀은 발송 준비 완료');
ok(prodDraft.ready === false, '이메일이 없는 팀은 발송 대기');
eq(ehsDraft.to, 'uday.k@example.com', '수신자가 붙는다');
ok(ehsDraft.subject.indexOf('인도법인') >= 0, '제목에 사업장');
ok(ehsDraft.subject.indexOf('2월') >= 0, '제목에 기준월');
ok(ehsDraft.body.indexOf('Uday K.님') >= 0, '이름이 있으면 이름으로 부른다');
ok(prodDraft.body.indexOf('생산팀 담당자님') >= 0, '이름이 없으면 팀명으로 부른다');
ok(ehsDraft.body.indexOf('만회대책') >= 0, '만회대책 요청 문구');
ok(ehsDraft.body.indexOf('LTIR') >= 0, '지표명이 본문에 들어간다');
ok(ehsDraft.body.indexOf('HDPS 사무국') >= 0, '보내는 사람 표기');

/* ---------------- 사업장 종합 ---------------- */
group('8. 사업장 종합');

var ov = Logic.buildOverview([
  { id: 'IND', name: '인도법인', region: '해외', kpis: KPIS },
  { id: 'BRA', name: '브라질법인', region: '해외', kpis: [] }
], '1월');
eq(ov.length, 2, '사업장 2곳');
eq(ov[0].rate, 100, '인도법인 100%');
eq(ov[1].rate, null, 'KPI가 없는 사업장은 null');

/* ---------------- 시드 데이터 정합성 ---------------- */
group('9. 시드 데이터 정합성');

var Seed = require('../js/seed-data.js');
ok(Seed.sites.length === 6, '사업장 6곳');
eq(Seed.months.length, 12, '12개월');

var badTarget = [];
var badDirection = [];
var badId = {};
var dupId = 0;
Seed.sites.forEach(function (s) {
  ok(s.kpis.length >= 100, s.name + ' KPI 100개 이상 (' + s.kpis.length + ')');
  s.kpis.forEach(function (k) {
    if (!isFinite(Number(k.target))) badTarget.push(k.id);
    if ([Logic.UP, Logic.DOWN, Logic.EQUAL, Logic.RANGE].indexOf(k.direction) < 0) badDirection.push(k.id);
    if (badId[k.id]) dupId++;
    badId[k.id] = true;
    Object.keys(k.actuals || {}).forEach(function (mo) {
      if (Logic.MONTHS.indexOf(mo) < 0) badTarget.push(k.id + ':' + mo);
    });
  });
});
eq(badTarget, [], '모든 목표가 숫자이고 월 이름이 올바르다');
eq(badDirection, [], '모든 판정방향이 정의된 값이다');
eq(dupId, 0, 'KPI id 중복 없음');

// 더미가 실제로 미달성을 만들어 내야 화면이 의미를 갖는다
var anyUnder = Seed.sites.some(function (s) {
  return Logic.evaluateMonth(s.kpis, '6월').summary.under > 0;
});
ok(anyUnder, '6월에 미달성 지표가 존재한다 (화면 확인용)');

/* ---------------- 결과 ---------------- */
console.log('\n' + '─'.repeat(48));
console.log(pass + '개 통과, ' + fail + '개 실패');
if (fail > 0) process.exit(1);
