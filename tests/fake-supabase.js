/**
 * fake-supabase.js — psql 위에 올린 가짜 supabase-js
 *
 * 진짜 PostgreSQL 에 진짜 schema.sql 을 올려 두고, **고치지 않은 앱 어댑터를
 * 그대로** 태우기 위한 도구다. 단위 테스트는 계산만, SQL 하네스는 DB 규칙만 본다 —
 * 둘이 맞물리는 지점(컬럼 이름·저장 순서·제약)은 여기서만 잡힌다.
 *
 * 쓰는 법
 *   FI_PSQL, FI_PGSOCK 환경변수를 주고 require 한 뒤 makeClient() 를
 *   supabase.createClient 자리에 끼운다.
 */
"use strict";
const { execFileSync } = require("child_process");

const PSQL = process.env.FI_PSQL;
const SOCK = process.env.FI_PGSOCK;
if (!PSQL || !SOCK) {
  throw new Error("FI_PSQL / FI_PGSOCK 환경변수가 필요합니다 (run-server-test.sh 로 실행하세요).");
}

/* ────────────────────────── psql 말 옮기기 ────────────────────────── */

function sql(text) {
  // -t -A: 머리글·정렬 없이 값만. json_agg 로 한 줄에 담아 받는다.
  const out = execFileSync(PSQL, ["-h", SOCK, "-U", "postgres", "-d", "sqltest",
    "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", text], { encoding: "utf8" });
  return out.trim();
}

function query(text) {
  try {
    // ⚠ INSERT/UPDATE/DELETE 는 서브쿼리 자리에 올 수 없다 — CTE 로 감싼다.
    //    `select ... from (insert ...)` 로 쓰면 "syntax error at or near into" 가 난다.
    const dml = /^\s*(insert|update|delete)\b/i.test(text);
    const wrapped = dml
      ? "with t as (" + text + ") select coalesce(json_agg(t), '[]'::json)::text from t"
      : "select coalesce(json_agg(t), '[]'::json)::text from (" + text + ") t";
    return { data: JSON.parse(sql(wrapped) || "[]"), error: null };
  } catch (e) {
    const msg = String((e.stderr || e.message || "")).trim();
    return { data: null, error: { message: msg } };
  }
}

/** 값 하나를 SQL 리터럴로. jsonb·배열·null 을 구분해 넣는다. */
function lit(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return q(JSON.stringify(v)) + "::jsonb";
  return q(String(v));
}
function q(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
function ident(s) { return '"' + String(s).replace(/"/g, '""') + '"'; }

/* ────────────────────── 가짜 supabase 클라이언트 ────────────────────── */

const UPLOADS = {};                 // '버킷/경로' → {size,type}
const MEDIA = {};                   // media_id → {blob-like}

function makeClient() {
  function table(name) {
    const st = { table: name, op: null, rows: null, sets: null, eqs: [],
                 sel: "*", ord: null, lim: null, one: false, conflict: null };

    const api = {
      select(cols) { if (st.op === null) st.op = "select"; st.sel = cols || "*"; return api; },
      insert(rows) { st.op = "insert"; st.rows = Array.isArray(rows) ? rows : [rows]; return api; },
      upsert(rows, opts) { st.op = "upsert"; st.rows = Array.isArray(rows) ? rows : [rows];
                           st.conflict = (opts && opts.onConflict) || null; return api; },
      update(patch) { st.op = "update"; st.sets = patch; return api; },
      delete() { st.op = "delete"; return api; },
      eq(col, val) { st.eqs.push([col, val]); return api; },
      neq(col, val) { st.eqs.push(["!" + col, val]); return api; },
      order(col, o) { st.ord = [col, !o || o.ascending !== false]; return api; },
      limit(n) { st.lim = n; return api; },
      maybeSingle() { st.one = "maybe"; return api; },
      single() { st.one = true; return api; },
      then(res, rej) { return run(st).then(res, rej); }
    };
    return api;
  }

  function where(st) {
    if (!st.eqs.length) return "";
    return " where " + st.eqs.map(([c, v]) =>
      c[0] === "!" ? (ident(c.slice(1)) + " <> " + lit(v)) : (ident(c) + " = " + lit(v))
    ).join(" and ");
  }

  function run(st) {
    let text, r;
    const cols = st.sel === "*" ? "*" : st.sel;

    if (st.op === "insert" || st.op === "upsert") {
      if (!st.rows.length) return Promise.resolve({ data: [], error: null });
      const keys = Object.keys(st.rows[0]);
      const values = st.rows.map(r0 => "(" + keys.map(k => lit(r0[k])).join(", ") + ")").join(", ");
      let onc = "";
      if (st.op === "upsert" && st.conflict) {
        const cs = st.conflict.split(",").map(s => ident(s.trim())).join(", ");
        const sets = keys.filter(k => st.conflict.split(",").map(s => s.trim()).indexOf(k) === -1)
          .map(k => ident(k) + " = excluded." + ident(k)).join(", ");
        onc = " on conflict (" + cs + ") do " + (sets ? "update set " + sets : "nothing");
      }
      text = "insert into public." + ident(st.table) + " (" + keys.map(ident).join(", ") + ")"
           + " values " + values + onc + " returning " + cols;
      r = query(text);
    } else if (st.op === "update") {
      const sets = Object.keys(st.sets).map(k => ident(k) + " = " + lit(st.sets[k])).join(", ");
      text = "update public." + ident(st.table) + " set " + sets + where(st) + " returning " + cols;
      r = query(text);
    } else if (st.op === "delete") {
      text = "delete from public." + ident(st.table) + where(st) + " returning " + cols;
      r = query(text);
    } else {
      text = "select " + cols + " from public." + ident(st.table) + where(st)
           + (st.ord ? " order by " + ident(st.ord[0]) + (st.ord[1] ? " asc" : " desc") : "")
           + (st.lim ? " limit " + Number(st.lim) : "");
      r = query(text);
    }

    if (r.error) return Promise.resolve({ data: null, error: r.error });
    if (st.one) {
      const rows = r.data || [];
      if (!rows.length) {
        return Promise.resolve(st.one === "maybe"
          ? { data: null, error: null }
          : { data: null, error: { message: "행이 없습니다" } });
      }
      return Promise.resolve({ data: rows[0], error: null });
    }
    return Promise.resolve({ data: r.data, error: null });
  }

  return {
    from: table,
    // 가짜 오브젝트 스토리지 — 무엇을 어느 경로에 올렸는지만 기억한다.
    // Blob 내용은 검사 대상이 아니다(브라우저가 하는 일).
    storage: {
      from(bucket) {
        return {
          upload(p, blob, opts) {
            if (!opts || opts.upsert !== true) {
              // 같은 첨부를 두 번 올릴 때 upsert 가 아니면 실제 Supabase 는 409 를 준다
              if (UPLOADS[bucket + "/" + p]) return Promise.resolve({ error: { message: "이미 있습니다" } });
            }
            UPLOADS[bucket + "/" + p] = { size: (blob && blob.size) || 0, type: (opts && opts.contentType) || null };
            return Promise.resolve({ data: { path: p }, error: null });
          },
          createSignedUrl(p, sec) {
            if (!UPLOADS[bucket + "/" + p]) return Promise.resolve({ error: { message: "없는 파일" } });
            return Promise.resolve({ data: { signedUrl: "https://local/" + bucket + "/" + p + "?exp=" + sec }, error: null });
          }
        };
      }
    },
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: "00000000-0000-0000-0000-000000000001", email: "t@x" } } }),
      getSession: () => Promise.resolve({ data: { session: { user: { id: "00000000-0000-0000-0000-000000000001" } } } }),
      signInWithPassword: () => Promise.resolve({ data: {}, error: null }),
      signOut: () => Promise.resolve({})
    }
  };
}


module.exports = { makeClient, query, row: (t, cond) =>
  query("select * from public.\"" + t + "\" where " + cond).data || [], UPLOADS, MEDIA };
