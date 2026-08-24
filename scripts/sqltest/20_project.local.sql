-- ============================================================================
-- 로컬 검증 전용 — schema.sql 검증 (ASSERT)
--
-- ⚠ 운영 SQL Editor 에서 실행하면 안 되는 파일입니다. 00_supabase_stub 와 같은 가드가 있습니다.
--   실행: npm run test:sql  (scripts/sqltest/run.sh)
-- ============================================================================

do $guard$
begin
  if exists (select 1 from pg_roles where rolname in ('supabase_admin', 'authenticator'))
     or exists (select 1 from pg_namespace where nspname = 'graphql') then
    raise exception '이 파일은 로컬 검증 전용입니다. 운영 데이터베이스에서 실행할 수 없습니다.';
  end if;
end;
$guard$;

create or replace function public._assert(p_ok boolean, p_label text)
returns void language plpgsql set search_path = public as $fn$
begin
  if p_ok then
    raise notice '  OK   %', p_label;
  else
    raise exception 'FAIL  %', p_label;
  end if;
end;
$fn$;

create or replace function public._assert_eq(p_actual anyelement, p_expected anyelement, p_label text)
returns void language plpgsql set search_path = public as $fn$
begin
  if p_actual is not distinct from p_expected then
    raise notice '  OK   %', p_label;
  else
    raise exception 'FAIL  %  (기대 %, 실제 %)', p_label, p_expected, p_actual;
  end if;
end;
$fn$;

-- ----------------------------------------------------------------------------
do $t$ begin raise notice '[2] 값 변환 — 매크로가 틀렸던 자리'; end $t$;

do $t$ begin
  perform public._assert_eq(public.convert_value('0.96', 100, '숫자'), 96::numeric,
    '환산배율 100 — 0.96 → 96');
  perform public._assert_eq(public.convert_value('3.81', 1, '숫자'), 3.81::numeric,
    '환산배율 1 — 그대로');
  perform public._assert_eq(public.convert_value('1,234', 1, '숫자'), 1234::numeric,
    '천단위 쉼표 제거');
  perform public._assert_eq(public.convert_value('96%', 100, '숫자'), 96::numeric,
    '이미 퍼센트인 값에 배율을 또 곱하지 않는다');
  perform public._assert_eq(public.convert_value('00:48:00', 1, '시간serial'), 0.8::numeric,
    '시간serial "00:48:00" → 0.8시간');
  perform public._assert_eq(public.convert_value('1:30', 1, '시간serial'), 1.5::numeric,
    '시간serial "1:30" → 1.5시간');
  perform public._assert_eq(public.convert_value('0.5', 1, '시간serial'), 12::numeric,
    '엑셀 시간 serial 0.5 → 12시간');
  perform public._assert_eq(public.convert_value('+8%', 1, '퍼센트텍스트'), 8::numeric,
    '퍼센트텍스트 "+8%" → 8');
  perform public._assert_eq(public.convert_value('-1.2 %', 1, '퍼센트텍스트'), -1.2::numeric,
    '퍼센트텍스트 음수');
  -- VBA 에서 Type Mismatch 를 내던 자리
  perform public._assert(public.convert_value('제외', 1, '숫자') is null,     '"제외" 는 null');
  perform public._assert(public.convert_value('TBD', 1, '숫자') is null,      '"TBD" 는 null');
  perform public._assert(public.convert_value('확인필요', 100, '숫자') is null, '"확인필요" 는 null');
  perform public._assert(public.convert_value(null, 1, '숫자') is null,       'null 은 null');
  perform public._assert(public.convert_value('', 100, '숫자') is null,       '빈 문자열은 null');
  perform public._assert_eq(public.convert_value('5', 0, '숫자'), 5::numeric, '환산배율 0 은 1 로 취급');
end $t$;

-- ----------------------------------------------------------------------------
do $t$ begin raise notice '[3] 달성 판정 — js/logic.js 와 같은 규칙'; end $t$;

do $t$ begin
  perform public._assert_eq(public.judge(95, 90, '상향(높을수록 좋음)'), '달성',   '상향: 목표 이상이면 달성');
  perform public._assert_eq(public.judge(85, 90, '상향(높을수록 좋음)'), '미달성', '상향: 목표 미만이면 미달성');
  perform public._assert_eq(public.judge(90, 90, '상향(높을수록 좋음)'), '달성',   '상향: 목표와 같으면 달성');
  perform public._assert_eq(public.judge(3.2, 3.81, '하향(낮을수록 좋음)'), '달성',   '하향: 목표보다 낮으면 달성');
  perform public._assert_eq(public.judge(5.41, 3.81, '하향(낮을수록 좋음)'), '미달성', '하향: 목표보다 높으면 미달성');
  perform public._assert_eq(public.judge(null, 90, '상향(높을수록 좋음)'), '판정불가', '실적 없으면 판정불가');
  perform public._assert_eq(public.judge(90, null, '상향(높을수록 좋음)'), '판정불가', '목표 없으면 판정불가');
  perform public._assert_eq(public.judge(104, 100, '목표일치'), '달성',   '목표일치: 기본 허용오차 5% 안');
  perform public._assert_eq(public.judge(120, 100, '목표일치'), '미달성', '목표일치: 허용오차 밖');
  perform public._assert_eq(public.judge(120, 100, '범위내', 25), '달성',  '범위내: 허용오차 직접 지정');
end $t$;

-- ----------------------------------------------------------------------------
do $t$ begin raise notice '[4] 제약 — 오타가 판정을 뒤집지 못하게'; end $t$;

do $t$
declare v_raised boolean := false;
begin
  begin
    insert into public.kpi (id, site_id, module, name_ko, direction)
    values ('T-BAD-1', 'IND', 'X', 'Y', '상향');   -- 축약 표기는 막혀야 한다
  exception when check_violation then v_raised := true;
  end;
  perform public._assert(v_raised, '판정방향 오타는 check 제약이 막는다');
end $t$;

do $t$
declare v_raised boolean := false;
begin
  begin
    insert into public.kpi (id, site_id, module, name_ko, format)
    values ('T-BAD-2', 'IND', 'X', 'Y', '시간');   -- '시간serial' 이 정확한 값
  exception when check_violation then v_raised := true;
  end;
  perform public._assert(v_raised, '값형식 오타는 check 제약이 막는다');
end $t$;

do $t$
declare v_raised boolean := false;
begin
  insert into public.kpi (id, site_id, module, name_ko, unit, direction, target, owner)
  values ('T-OK-1', 'IND', '안전과환경', 'LTIR', '건', '하향(낮을수록 좋음)', 2, 'EHS팀')
  on conflict (id) do nothing;

  insert into public.actual (kpi_id, month, value) values ('T-OK-1', '1월', 1)
  on conflict (kpi_id, month) do update set value = excluded.value;

  begin
    -- onConflict 없이 두 번 넣으면 UNIQUE 에 걸려야 한다.
    -- 중복 방지를 클라이언트가 아니라 DB 제약으로 하는 것이 이 검사의 취지다.
    insert into public.actual (kpi_id, month, value) values ('T-OK-1', '1월', 99);
  exception when unique_violation then v_raised := true;
  end;
  perform public._assert(v_raised, '같은 지표·같은 달은 UNIQUE 로 중복이 막힌다');
end $t$;

do $t$
declare v_raised boolean := false;
begin
  begin
    insert into public.actual (kpi_id, month, value) values ('T-OK-1', '13월', 1);
  exception when check_violation then v_raised := true;
  end;
  perform public._assert(v_raised, '없는 달(13월)은 check 제약이 막는다');
end $t$;

-- ----------------------------------------------------------------------------
do $t$ begin raise notice '[5] 뷰 — 판정 결과와 달성률'; end $t$;

do $t$ begin
  insert into public.kpi (id, site_id, module, name_ko, unit, direction, target, owner)
  values
    ('T-UP-1',  'IND', '품질보증', '입고 직행율', '%', '상향(높을수록 좋음)', 92.5, 'ALC'),
    ('T-NA-1',  'IND', '품질보증', '자료미도착',  '%', '상향(높을수록 좋음)', 90,   'ALC'),
    ('T-NA-2',  'IND', '품질보증', '목표미정',    '%', '상향(높을수록 좋음)', null, 'ALC')
  on conflict (id) do nothing;

  insert into public.actual (kpi_id, month, value) values ('T-UP-1', '1월', 80)
  on conflict (kpi_id, month) do update set value = excluded.value;
  -- T-NA-1 은 실적을 넣지 않는다 → month 가 null 이라 월별 집계에 아예 안 들어간다
  -- T-NA-2 는 1월 실적은 있는데 목표가 없다 → **1월 집계 안에서** 판정불가가 된다.
  --   달성률 분모 검사는 이 행이 있어야 의미가 있다. 처음엔 T-NA-1 만 두었는데,
  --   분모에 판정불가를 넣도록 일부러 깨뜨려도 검사가 통과해 버렸다(§5.5).
  insert into public.actual (kpi_id, month, value) values ('T-NA-2', '1월', 77)
  on conflict (kpi_id, month) do update set value = excluded.value;

  perform public._assert_eq(
    (select status from public.evaluation where kpi_id = 'T-OK-1' and month = '1월'),
    '달성', '하향 지표 달성 판정이 뷰에 반영된다');

  perform public._assert_eq(
    (select status from public.evaluation where kpi_id = 'T-UP-1' and month = '1월'),
    '미달성', '상향 지표 미달성 판정이 뷰에 반영된다');

  perform public._assert_eq(
    (select status from public.evaluation where kpi_id = 'T-NA-1' and month is null),
    '판정불가', '실적 없는 지표는 판정불가');

  -- gap 부호는 방향과 무관하게 "양수면 좋은 쪽"
  perform public._assert(
    (select gap from public.evaluation where kpi_id = 'T-OK-1' and month = '1월') > 0,
    '하향 지표가 목표보다 낮으면 gap 이 양수');
  perform public._assert(
    (select gap from public.evaluation where kpi_id = 'T-UP-1' and month = '1월') < 0,
    '상향 지표가 목표보다 낮으면 gap 이 음수');

  perform public._assert_eq(
    (select under from public.site_summary where site_id = 'IND' and month = '1월'),
    1::bigint, '미달성 1건이 요약에 잡힌다');

  -- 달성률 분모에서 판정불가를 뺀다 — 미입력을 미달성으로 세면
  -- 자료가 늦게 오는 달마다 달성률이 통째로 무너져 보인다.
  perform public._assert_eq(
    (select na from public.site_summary where site_id = 'IND' and month = '1월'),
    1::bigint, '1월 집계 안에 판정불가가 1건 있다 (아래 분모 검사의 전제)');

  -- 1월: 달성 1 + 미달성 1 + 판정불가 1.
  -- 판정불가를 분모에 넣으면 33.3% 가 되므로, 50.0 이어야 규칙이 지켜진 것이다.
  perform public._assert_eq(
    (select rate from public.site_summary where site_id = 'IND' and month = '1월'),
    50.0::numeric, '달성률은 판정 가능한 것만 분모로 삼는다 (1/2 = 50%, 1/3 아님)');

  perform public._assert_eq(
    (select count(*) from public.underperformance where kpi_id = 'T-UP-1'),
    1::bigint, '미달성 뷰에 잡힌다');
end $t$;

-- ----------------------------------------------------------------------------
do $t$ begin raise notice '[6] 함수 권한 — anon 이 남아 있지 않아야 한다 (§3.7)'; end $t$;

do $t$
declare v_bad text;
begin
  -- GRANT 만으로는 제한되지 않는다. Supabase 가 ALTER DEFAULT PRIVILEGES 로
  -- 신규 함수마다 anon 에 EXECUTE 를 붙이기 때문에 REVOKE 가 실제로 필요하다.
  select string_agg(proname, ', ')
    into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and proname like 'hdp11\_%'
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  perform public._assert(v_bad is null,
    'anon 에 EXECUTE 가 남은 함수가 없다' || coalesce(' (발견: ' || v_bad || ')', ''));
end $t$;

do $t$
declare v_bad text;
begin
  select string_agg(proname, ', ')
    into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and proname like 'hdp11\_%'
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE');
  perform public._assert(v_bad is null,
    'authenticated 는 전 함수를 실행할 수 있다' || coalesce(' (막힌 함수: ' || v_bad || ')', ''));
end $t$;

-- ----------------------------------------------------------------------------
do $t$ begin raise notice '[7] RLS — 켜져 있고 정책이 붙어 있는가'; end $t$;

do $t$
declare v_bad text;
begin
  select string_agg(c.relname, ', ')
    into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and c.relname like 'hdp11\_%'
     and not c.relrowsecurity;
  perform public._assert(v_bad is null,
    'RLS 가 꺼진 테이블이 없다' || coalesce(' (발견: ' || v_bad || ')', ''));
end $t$;

do $t$
declare v_bad text;
begin
  select string_agg(c.relname, ', ')
    into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and c.relname like 'hdp11\_%'
     and not exists (select 1 from pg_policy p where p.polrelid = c.oid);
  perform public._assert(v_bad is null,
    '정책이 하나도 없는 테이블이 없다' || coalesce(' (발견: ' || v_bad || ')', ''));
end $t$;

-- 기록성 테이블은 사후 조작을 막기 위해 UPDATE/DELETE 정책을 두지 않는다
do $t$
declare v_cnt int;
begin
  select count(*) into v_cnt
    from pg_policy p join pg_class c on c.oid = p.polrelid
   where c.relname = 'log' and p.polcmd in ('w', 'd');
  perform public._assert_eq(v_cnt, 0, '실행로그에 UPDATE/DELETE 정책이 없다');
end $t$;

-- ----------------------------------------------------------------------------
do $t$ begin raise notice '[8] 시드'; end $t$;

do $t$ begin
  perform public._assert_eq((select count(*) from public.site), 6::bigint, '사업장 6곳');
  perform public._assert_eq((select count(*) from public.contact), 60::bigint,
    '담당자 행 60개 (6 사업장 x 10 팀)');
end $t$;

-- 정리 — 테스트가 넣은 행을 지운다(재실행 안전)
delete from public.kpi where id like 'T-%';

do $t$ begin raise notice ''; raise notice '전부 통과했습니다.'; end $t$;
