-- ============================================================================
-- hd-project11 — 글로벌 사업장 HDPS KPI 자동집계 포털
-- Supabase(Postgres) 운영 스키마 + RLS 정책
--
--  실행 위치 : Supabase Dashboard → SQL Editor
--  재실행    : 안전합니다 (IF NOT EXISTS / DROP ... IF EXISTS 선행)
--
--  이 스키마는 **수강생 본인의 Supabase 프로젝트**에 올리는 것을 전제로 합니다.
--  프로젝트가 본인 것이라 테이블 이름에 접두사를 붙이지 않았습니다.
--  (여러 앱을 한 프로젝트에 몰아 쓸 계획이면 이름 충돌을 먼저 확인하세요.)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 테이블
-- ----------------------------------------------------------------------------

-- 사업장 (울산·인천·군산·인도·브라질 …)
create table if not exists public.site (
  id          text primary key,                     -- 'IND', 'BRA' …
  name        text not null,
  region      text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- 성과지표
create table if not exists public.kpi (
  id           text primary key,                    -- 'IND-EHS-004'
  site_id      text not null references public.site(id) on delete cascade,
  module       text not null,                       -- 국문 모듈명 (안전과환경 …)
  module_code  text,                                -- EHS, TPM, VSM …
  name_ko      text not null,
  name_en      text,
  unit         text,
  -- 판정방향. 값을 제약으로 묶어 둔다 — 오타가 들어오면 판정이 조용히 뒤집힌다.
  direction    text not null default '상향(높을수록 좋음)'
               check (direction in ('상향(높을수록 좋음)', '하향(낮을수록 좋음)', '목표일치', '범위내')),
  target       numeric,
  tolerance    numeric,                             -- 목표일치·범위내 허용오차 (null이면 목표의 5%)
  owner        text,                                -- R&R. '생산팀\n혁신팀' 처럼 여러 팀이 들어올 수 있다
  scale        numeric not null default 1,          -- 환산배율 (원본 0.96 → 총괄 96)
  format       text not null default '숫자'
               check (format in ('숫자', '시간serial', '퍼센트텍스트')),
  sort_order   int,
  created_at   timestamptz not null default now()
);
create index if not exists kpi_site_idx on public.kpi (site_id);

-- 월별 실적
create table if not exists public.actual (
  id          bigint generated always as identity primary key,
  kpi_id      text not null references public.kpi(id) on delete cascade,
  month       text not null check (month ~ '^(1[0-2]|[1-9])월$'),
  value       numeric,
  source      text,                                 -- 'import' | 'manual'
  updated_at  timestamptz not null default now(),
  -- 같은 지표·같은 달은 한 행만. 중복 방지는 클라이언트가 아니라 여기서 한다.
  -- ⚠ 프런트에서 upsert 할 때 onConflict 를 이 제약 이름과 같은 컬럼 조합으로 지정할 것.
  constraint actual_kpi_month_key unique (kpi_id, month)
);
create index if not exists actual_month_idx on public.actual (month);

-- 매핑표 (원본 영문 지표명 ↔ 총괄 지표)
create table if not exists public.mapping (
  id          bigint generated always as identity primary key,
  site_id     text not null references public.site(id) on delete cascade,
  kpi_id      text references public.kpi(id) on delete set null,
  kpi_en      text not null,
  excluded    boolean not null default false,       -- '제외' 지표 (현지 자체관리)
  note        text,
  constraint mapping_site_en_key unique (site_id, kpi_en)
);

-- 담당자 (팀별 수신자)
create table if not exists public.contact (
  id          bigint generated always as identity primary key,
  site_id     text not null references public.site(id) on delete cascade,
  owner       text not null,                        -- 팀/부서명
  name        text,
  email       text,
  constraint contact_site_owner_key unique (site_id, owner)
);

-- 실행로그 — 기록성 테이블이라 UPDATE/DELETE 정책을 두지 않는다(사후 조작 방지)
create table if not exists public.log (
  id          bigint generated always as identity primary key,
  ran_at      timestamptz not null default now(),
  kind        text not null,                        -- '데이터 자동입력' | '달성 판정' | '미달성 메일'
  site_id     text,
  month       text,
  processed   int not null default 0,
  failed      int not null default 0,
  note        text,
  actor       uuid default auth.uid()
);
create index if not exists log_ran_at_idx on public.log (ran_at desc);

-- 관리자 (이 사이트를 운영하는 사람)
create table if not exists public.admin (
  user_id     uuid primary key,
  email       text,
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 2. 판정 함수
--
--  ⚠ search_path 를 고정한다. 고정하지 않으면 호출자의 search_path 에 따라
--    엉뚱한 스키마의 객체를 잡을 수 있고, 트리거에서는 그 사고가 조용히 번진다.
-- ----------------------------------------------------------------------------

-- 이 사람이 이 사이트의 관리자인가
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (select 1 from public.admin a where a.user_id = auth.uid());
$fn$;

-- 값 하나를 총괄 기준 숫자로 변환 (js/logic.js convertValue 와 같은 규칙)
create or replace function public.convert_value(
  p_raw text, p_scale numeric, p_format text
) returns numeric
language plpgsql
immutable
set search_path = public
as $fn$
declare
  v_txt  text;
  v_num  numeric;
  v_pct  boolean := false;
begin
  if p_raw is null then return null; end if;
  v_txt := btrim(p_raw);
  if v_txt = '' then return null; end if;

  if p_format = '시간serial' then
    -- "00:48:00" → 0.8 (시간 단위)
    if v_txt ~ '^\d+:[0-5]?\d(:[0-5]?\d)?$' then
      return round((
        split_part(v_txt, ':', 1)::numeric
        + split_part(v_txt, ':', 2)::numeric / 60
        + coalesce(nullif(split_part(v_txt, ':', 3), ''), '0')::numeric / 3600
      ) * coalesce(nullif(p_scale, 0), 1), 4);
    end if;
    -- 엑셀 시간 serial (1 = 24시간)
    if v_txt ~ '^[+-]?\d+(\.\d+)?$' then
      return round(v_txt::numeric * 24 * coalesce(nullif(p_scale, 0), 1), 4);
    end if;
    return null;
  end if;

  if p_format = '퍼센트텍스트' then
    v_txt := replace(replace(v_txt, ' ', ''), ',', '');
    if v_txt ~ '^[+-]?\d+(\.\d+)?%?$' then
      return round(rtrim(v_txt, '%')::numeric * coalesce(nullif(p_scale, 0), 1), 4);
    end if;
    return null;
  end if;

  -- 숫자
  v_txt := replace(v_txt, ',', '');
  if right(v_txt, 1) = '%' then
    v_pct := true;
    v_txt := btrim(rtrim(v_txt, '%'));
  end if;
  if v_txt !~ '^[+-]?\d+(\.\d+)?$' then
    return null;   -- '제외', 'TBD', '확인필요' … 여기서 걸린다
  end if;
  v_num := v_txt::numeric;

  -- "96%" 처럼 이미 정수 퍼센트로 적힌 값에 배율 100 을 또 곱하면 9600 이 된다
  if v_pct and p_scale = 100 then
    return round(v_num, 4);
  end if;
  return round(v_num * coalesce(nullif(p_scale, 0), 1), 4);
end;
$fn$;

-- 실적 하나의 달성 여부
create or replace function public.judge(
  p_actual numeric, p_target numeric, p_direction text, p_tolerance numeric default null
) returns text
language plpgsql
immutable
set search_path = public
as $fn$
declare
  v_tol numeric;
begin
  if p_actual is null or p_target is null then
    return '판정불가';
  end if;

  if p_direction in ('목표일치', '범위내') then
    v_tol := coalesce(p_tolerance, abs(p_target) * 0.05);
    return case when abs(p_actual - p_target) <= v_tol then '달성' else '미달성' end;
  elsif p_direction = '하향(낮을수록 좋음)' then
    return case when p_actual <= p_target then '달성' else '미달성' end;
  else
    return case when p_actual >= p_target then '달성' else '미달성' end;
  end if;
end;
$fn$;

-- ----------------------------------------------------------------------------
-- 3. 뷰 — 판정 결과 / 미달성 목록 / 사업장 요약
-- ----------------------------------------------------------------------------

create or replace view public.evaluation as
select
  k.id            as kpi_id,
  k.site_id,
  s.name          as site_name,
  k.module,
  k.name_ko,
  k.unit,
  k.owner,
  k.direction,
  k.target,
  a.month,
  a.value         as actual,
  public.judge(a.value, k.target, k.direction, k.tolerance) as status,
  -- gap 부호는 방향과 무관하게 "양수면 좋은 쪽"
  case
    when a.value is null or k.target is null then null
    when k.direction = '하향(낮을수록 좋음)' then k.target - a.value
    when k.direction in ('목표일치', '범위내')  then -abs(a.value - k.target)
    else a.value - k.target
  end as gap
from public.kpi k
join public.site s on s.id = k.site_id
left join public.actual a on a.kpi_id = k.id;

create or replace view public.underperformance as
select * from public.evaluation where status = '미달성';

create or replace view public.site_summary as
select
  site_id,
  site_name,
  month,
  count(*)                                            as total,
  count(*) filter (where status = '달성')             as achieved,
  count(*) filter (where status = '미달성')           as under,
  count(*) filter (where status = '판정불가')         as na,
  -- 달성률의 분모는 판정 가능한 것만. 미입력을 미달성으로 세면
  -- 자료가 늦게 오는 달마다 달성률이 통째로 무너져 보인다.
  case
    when count(*) filter (where status in ('달성', '미달성')) = 0 then null
    else round(
      count(*) filter (where status = '달성')::numeric
      / count(*) filter (where status in ('달성', '미달성')) * 100, 1)
  end as rate
from public.evaluation
where month is not null
group by site_id, site_name, month;

-- ----------------------------------------------------------------------------
-- 4. RLS
--
--  이 사이트는 사내 담당자만 쓰는 관리 도구다.
--  읽기는 로그인 사용자, 쓰기는 관리자만.
-- ----------------------------------------------------------------------------

alter table public.site    enable row level security;
alter table public.kpi     enable row level security;
alter table public.actual  enable row level security;
alter table public.mapping enable row level security;
alter table public.contact enable row level security;
alter table public.log     enable row level security;
alter table public.admin   enable row level security;

do $rls$
declare
  t text;
begin
  foreach t in array array['site','kpi','actual','mapping','contact']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_read',   t);
    execute format('drop policy if exists %I on public.%I', t || '_write',  t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);

    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_read', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.is_admin())',
      t || '_write', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())',
      t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.is_admin())',
      t || '_delete', t);
  end loop;
end;
$rls$;

-- 실행로그 — 남기고 읽을 수는 있으나 고치거나 지울 수는 없다.
-- UPDATE/DELETE 정책을 아예 만들지 않는 것이 곧 금지다.
drop policy if exists log_read on public.log;
drop policy if exists log_write on public.log;
create policy log_read  on public.log for select to authenticated using (true);
create policy log_write on public.log for insert to authenticated with check (true);

-- 관리자 목록은 관리자만 본다
drop policy if exists admin_read on public.admin;
create policy admin_read on public.admin for select to authenticated using (public.is_admin());

-- ----------------------------------------------------------------------------
-- 5. 함수 실행 권한
--
--  ⚠ GRANT 만으로는 제한되지 않는다. 권한이 두 겹으로 미리 붙어 있다.
--    ① Postgres 가 함수 생성 시 PUBLIC 에 EXECUTE 기본 부여
--    ② Supabase 가 ALTER DEFAULT PRIVILEGES 로 신규 함수마다
--       anon·authenticated·service_role 에 자동 부여
--    PUBLIC 만 지우면 anon=X 가 남아 비로그인 호출이 그대로 뚫린다.
-- ----------------------------------------------------------------------------

revoke all on function public.is_admin()                            from public, anon;
revoke all on function public.convert_value(text, numeric, text)    from public, anon;
revoke all on function public.judge(numeric, numeric, text, numeric) from public, anon;

grant execute on function public.is_admin()                            to authenticated;
grant execute on function public.convert_value(text, numeric, text)    to authenticated;
grant execute on function public.judge(numeric, numeric, text, numeric) to authenticated;

-- 확인용 — anon 에 EXECUTE 가 남아 있지 않아야 한다.
--   select proname, array_to_string(proacl, E'\n')
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and proname like 'hdp11\_%';

-- ----------------------------------------------------------------------------
-- 6. 시드 (사업장·팀만. KPI 는 화면의 엑셀 임포트로 넣는다)
-- ----------------------------------------------------------------------------

insert into public.site (id, name, region) values
  ('ULS', '울산캠퍼스', '국내'),
  ('ICN', '인천공장',   '국내'),
  ('GSN', '군산공장',   '국내'),
  ('IND', '인도법인',   '해외'),
  ('BRA', '브라질법인', '해외'),
  ('EUR', '유럽법인',   '해외')
on conflict (id) do nothing;

insert into public.contact (site_id, owner)
select s.id, o
from public.site s
cross join unnest(array[
  'ALC','EHS팀','PPIC팀','보전팀','생기팀','생산운영팀','생산팀','품질팀','혁신팀','전체 팀'
]) as o
on conflict (site_id, owner) do nothing;

-- ----------------------------------------------------------------------------
-- 끝. 관리자 등록은 계정 생성 후 아래를 실행합니다.
--   insert into public.admin (user_id, email)
--   select id, email from auth.users where email = '<관리자 이메일>'
--   on conflict (user_id) do nothing;
-- ----------------------------------------------------------------------------
