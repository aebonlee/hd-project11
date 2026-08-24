# Supabase 설정 — hd-project11

이 폴더의 `schema.sql` 을 **Supabase Dashboard → SQL Editor** 에 붙여 넣고 실행하면 됩니다.
붙여 넣을 파일 원본: [`supabase/schema.sql`](schema.sql)

---

## 1. 어디에 올리나

**본인 Supabase 프로젝트**에 올립니다. 회사 프로젝트가 아닙니다.

1. [supabase.com](https://supabase.com) 에서 무료 프로젝트를 하나 만듭니다.
2. Settings → API 에서 **Project URL** 과 **anon / public 키**를 복사합니다.
3. `js/config.js` 의 `SUPABASE_URL` · `SUPABASE_ANON_KEY` 에 붙여 넣습니다.

프로젝트가 본인 것이라 테이블 이름에 접두사를 붙이지 않았습니다.
(여러 앱을 한 프로젝트에 몰아 쓸 계획이라면 이름 충돌을 먼저 확인하세요.)

| 테이블 | 담는 것 |
|---|---|
| `site` | 사업장 (울산·인천·군산·인도·브라질·유럽) |
| `kpi` | 성과지표 (모듈·지표명·단위·판정방향·목표·담당팀·환산배율·값형식) |
| `actual` | 월별 실적 — `(kpi_id, month)` UNIQUE |
| `mapping` | 매핑표 (원본 영문 지표명 ↔ 총괄 지표) |
| `contact` | 팀별 담당자·이메일 |
| `log` | 실행로그 (INSERT·SELECT 만 가능) |
| `admin` | 이 사이트 관리자 |

| 함수 / 뷰 | 하는 일 |
|---|---|
| `convert_value(raw, scale, format)` | 환산배율·시간serial·퍼센트텍스트 변환 (매크로 `modImport`) |
| `judge(actual, target, direction, tol)` | 달성/미달성/판정불가 (매크로 `modCheck`) |
| `is_admin()` | RLS 판정용 |
| `evaluation` | 지표 × 월 판정 결과 |
| `underperformance` | 미달성만 |
| `site_summary` | 사업장 × 월 달성률 |

## 2. 실행 순서

1. **본인 프로젝트의 **SQL Editor** 를 엽니다.**
2. `supabase/schema.sql` **전체를 복사해 붙여 넣고 실행**합니다.
   재실행해도 안전합니다(`IF NOT EXISTS` / `DROP ... IF EXISTS` 를 앞에 두었습니다).
   실행이 끝나면 사업장 6곳과 팀별 담당자 60행이 들어가 있습니다.
3. **관리자를 등록합니다.** 쓰기 권한은 여기 등록된 사람만 갖습니다.

   ```sql
   insert into public.admin (user_id, email)
   select id, email from auth.users where email = '<본인 로그인 이메일>'
   on conflict (user_id) do nothing;
   ```

4. **`js/config.js` 에서 `USE_SUPABASE` 를 `true` 로 바꾸고 커밋**합니다.
   커밋 전에 확인만 하려면 주소 뒤에 **`?supabase=1`** 을 붙이면 됩니다.

   ```
   https://aebonlee.github.io/hd-project11/?supabase=1
   ```

5. 상단 띠가 **"Supabase 연결됨"** 으로 바뀌면 끝입니다.
   연결에 실패하면 띠에 이유가 그대로 나오고 화면은 더미 데이터로 계속 돕니다.

> **지표(KPI)는 시드에 넣지 않았습니다.** 사업장·팀만 넣어 두었습니다.
> 실제 지표는 화면의 **① 데이터 자동입력** 탭에서 엑셀로 올리는 것이 맞고,
> 그래야 회사 데이터가 이 공개 저장소에 남지 않습니다.

## 3. 권한 구조

- **읽기**: 로그인한 사용자 전체
- **쓰기(INSERT/UPDATE/DELETE)**: `admin` 에 등록된 사람만
- **실행로그**: 남기고 읽을 수는 있으나 **고치거나 지울 수 없습니다.**
  UPDATE/DELETE 정책을 아예 만들지 않았습니다 — 사후 조작을 막기 위함입니다.
- **anon(비로그인)** 은 테이블도 함수도 건드릴 수 없습니다.

> ⚠ 함수 권한은 `GRANT` 만으로 제한되지 않습니다. 권한이 두 겹으로 미리 붙습니다.
> ① Postgres 가 함수 생성 시 PUBLIC 에 EXECUTE 를 기본 부여하고,
> ② Supabase 가 `ALTER DEFAULT PRIVILEGES` 로 신규 함수마다 `anon`·`authenticated`·`service_role` 에 자동 부여합니다.
> PUBLIC 만 지우면 `anon=X` 가 남아 **비로그인 호출이 그대로 뚫립니다.**
> `schema.sql` 은 `revoke ... from public, anon` 으로 두 겹을 모두 벗깁니다.

확인하려면:

```sql
select proname, array_to_string(proacl, E'\n')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public';
```

`anon=X/postgres` 가 보이면 안 됩니다.

## 4. 이 SQL 은 검증하고 올렸습니다

운영에서 처음 돌리지 않았습니다. 임시 로컬 PostgreSQL 을 띄워 **실제로 적용해** 검증했습니다.

```bash
./scripts/sqltest/run.sh
```

무엇을 하는지:

1. 임시 클러스터를 만들고 Supabase 환경(역할 `anon`/`authenticated`/`service_role`,
   `auth.uid()`, 그리고 **함수 기본 권한 자동 부여**)을 스텁으로 재현
2. `schema.sql` 을 적용하고 **한 번 더 적용**해 재실행 안전성 확인
3. 40여 개 ASSERT 로 검증 — 접두사, 값 변환 15종, 판정 10종, check/UNIQUE 제약,
   뷰 판정 결과, **anon EXECUTE 잔존 여부**, RLS 활성화, 로그 테이블 정책, 시드
4. 끝나면 클러스터를 지움 (기존 PostgreSQL 설치에 영향 없음)

**이 하네스가 실패를 잡는지도 일부러 깨뜨려 확인했습니다.**

| 심은 결함 | 잡혔나 |
|---|---|
| `revoke ... from anon` 한 줄 제거 | ✅ `anon 에 EXECUTE 가 남은 함수가 없다` 실패 |
| 달성률 분모에 판정불가 포함 | ✅ `50% 기대, 실제 33.3` 으로 실패 |
| 판정방향 `check` 제약 제거 | ✅ `판정방향 오타는 check 제약이 막는다` 실패 |

> 두 번째는 처음에 **통과해 버렸습니다.** 판정불가 행이 `month is null` 이라
> 월별 집계에서 아예 빠져 분모 검사가 성립하지 않았기 때문입니다.
> 목표가 비어 판정불가가 되는 지표를 같은 달에 넣고서야 검사가 의미를 갖게 됐습니다.
> 통과만 확인한 검사는 통과해도 의미가 없습니다.

## 5. 로컬 검증용 파일을 여기 두지 않은 이유

`scripts/sqltest/*.local.sql` 은 **운영에서 실행하면 안 되는 파일**입니다.
`supabase/` 폴더의 다른 파일은 전부 "SQL Editor 에서 실행하라"고 안내한 것이라,
**폴더가 주는 신호가 주석보다 셉니다.** 그래서 다른 폴더에 두었고,
파일 첫머리에 `supabase_admin`·`authenticator` 역할이나 `graphql` 스키마가 보이면
**스스로 예외를 던지고 멈추는 가드**를 넣었습니다.
"실행하지 말 것"이라고 적는 대신 실행할 수 없게 만들었습니다.
