/**
 * 서버 모드 통합 테스트 — 실행: scripts/sqltest/run-server-test.sh
 *
 * 왜 필요한가
 *   이 프로젝트는 서버 모드가 **죽어 있었다.** 스키마는 사업장·팀까지만 심고
 *   지표(kpi)는 비워 두는데, 엑셀 임포트는 `kpi.id` 로 행을 맞춰 실적만 넣는다.
 *   그래서 정의가 없으면 맞출 대상이 없어 **매번 "0건 반영"** 이 되고
 *   화면에도 지표가 하나도 안 떴다.
 *   단위 테스트(계산)도 SQL 하네스(제약)도 이걸 못 봤다 — 둘 사이의 일이라서다.
 */
"use strict";
const assert = require("assert");
const path = require("path");
const vm = require("vm");
const fs = require("fs");
const { makeClient, query } = require("./fake-supabase.js");

const root = path.join(__dirname, "..");
const SeedData = require(path.join(root, "js/seed-data.js"));

// 어댑터를 그대로 올린다
const sandbox = { self: null, window: null, console,
  APP_CONFIG: { USE_SUPABASE: true, SUPABASE_URL: "http://local", SUPABASE_ANON_KEY: "local" },
  supabase: { createClient: makeClient },
  SeedData };
sandbox.self = sandbox; sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "js/supabase-store.js"), "utf8"), sandbox);
const S = sandbox.SupabaseStore;

const one = (q) => (query(q).data || [])[0];
const cnt = (t, cond) => Number(one("select count(*)::int as n from public." + t + (cond ? " where " + cond : "")).n);

let passed = 0, failed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const init = () => new Promise((res, rej) => S.init((e, db) => (e ? rej(e) : res(db))));

test("스키마만 올린 직후에는 지표가 비어 있다 (이것이 문제였다)", () => {
  assert.strictEqual(cnt("kpi"), 0, "이 테스트의 전제가 깨졌다");
  assert.ok(cnt("site") > 0, "사업장은 스키마가 심는다");
});

test("첫 연결에서 지표 정의를 심는다", async () => {
  const db = await init();
  const expected = SeedData.sites.reduce((n, s) => n + (s.kpis || []).length, 0);
  assert.strictEqual(cnt("kpi"), expected, "지표 정의가 다 안 들어갔다");
  assert.strictEqual(S.seededCount(), expected, "심은 건수를 화면에 알려야 한다");
  assert.ok(db.sites.length > 0, "사업장이 비어 있다");
  assert.ok(db.sites[0].kpis.length > 0, "지표가 화면 모양으로 안 돌아왔다");
});

test("두 번째 연결에서는 다시 심지 않는다", async () => {
  const before = cnt("kpi");
  await init();
  assert.strictEqual(cnt("kpi"), before, "지표가 늘어났다 — 남의 정의를 덮을 수 있다");
  assert.strictEqual(S.seededCount(), 0, "다시 심지 않았으면 0 이어야 한다");
});

test("엑셀 임포트가 실적을 실제로 넣는다 (예전에는 0건이었다)", async () => {
  await init();
  const site = S.getSite("ULS");
  assert.ok(site && site.kpis.length, "사업장 지표가 없다");
  const rows = site.kpis.slice(0, 5).map((k, i) => ({ kpiId: k.id, value: 10 + i }));
  const n = await new Promise((res, rej) =>
    S.applyImport("ULS", "9월", rows, (e, c) => (e ? rej(e) : res(c))));
  assert.strictEqual(n, 5, "반영 건수가 다르다 (" + n + ")");
  assert.strictEqual(cnt("actual", "month = '9월' and kpi_id like 'ULS-%'"), 5);
});

test("같은 달을 다시 올리면 덮어쓴다 — 행이 늘지 않는다", async () => {
  await init();
  const site = S.getSite("ULS");
  const rows = site.kpis.slice(0, 5).map((k) => ({ kpiId: k.id, value: 99 }));
  await new Promise((res, rej) => S.applyImport("ULS", "9월", rows, (e, c) => (e ? rej(e) : res(c))));
  assert.strictEqual(cnt("actual", "month = '9월' and kpi_id like 'ULS-%'"), 5, "중복이 쌓였다");
  const v = one("select value from public.actual where month='9월' and kpi_id like 'ULS-%' limit 1");
  assert.strictEqual(Number(v.value), 99, "덮어쓰지 않았다");
});

test("목표 수정이 서버에 반영된다", async () => {
  await init();
  const site = S.getSite("ULS");
  const id = site.kpis[0].id;
  await new Promise((res, rej) => S.setTarget("ULS", id, 77.7, (e) => (e ? rej(e) : res())));
  assert.strictEqual(Number(one("select target from public.kpi where id='" + id + "'").target), 77.7);
});

test("담당자 연락처가 저장되고 중복되지 않는다", async () => {
  await init();
  await new Promise((res, rej) => S.setContact("ULS", "생산팀", "김담당", "a@b.com", (e) => (e ? rej(e) : res())));
  await new Promise((res, rej) => S.setContact("ULS", "생산팀", "박담당", "c@d.com", (e) => (e ? rej(e) : res())));
  assert.strictEqual(cnt("contact", "site_id='ULS' and owner='생산팀'"), 1, "연락처가 중복으로 쌓였다");
  assert.strictEqual(one("select name from public.contact where site_id='ULS' and owner='생산팀'").name, "박담당");
});

test("정의에 없는 지표는 조용히 버리지 않고 0건으로 알린다", async () => {
  await init();
  const n = await new Promise((res, rej) =>
    S.applyImport("ULS", "10월", [{ kpiId: "없는지표", value: 1 }], (e, c) => (e ? rej(e) : res(c))));
  assert.strictEqual(n, 0, "없는 지표를 넣었다");
  assert.strictEqual(cnt("actual", "month='10월'"), 0);
});

test("실행 이력이 남는다", async () => {
  await init();
  const before = cnt("log");
  S.log("데이터 자동입력", "ULS", "9월", 5, 0, "테스트");
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(cnt("log") > before, "로그가 안 남았다");
});

(async () => {
  for (const t of tests) {
    try { await t.fn(); passed++; console.log("  ✔ " + t.name); }
    catch (e) { failed++; console.error("  ✘ " + t.name); console.error("    " + (e && e.message)); }
  }
  console.log("\n결과: " + passed + " 통과, " + failed + " 실패");
  if (failed > 0) process.exit(1);
})();
