/**
 * 접속 설정.
 *
 * 여기 값이 채워져 있고 supabase-js 가 로드되면 **Supabase 모드**로 돌고,
 * 아니면 브라우저 localStorage 만 쓰는 **데모 모드**로 돕니다.
 * 어느 쪽이든 화면과 계산은 같습니다 — 저장 위치만 다릅니다.
 *
 * ⚠ anon 키는 공개용입니다(브라우저 번들에 그대로 들어갑니다).
 *   실제 접근 제어는 키가 아니라 supabase/schema.sql 의 RLS 정책이 합니다.
 *   service_role 키는 절대 여기에 넣지 마세요.
 */
(function (root) {
  'use strict';

  root.APP_CONFIG = {
    // 공용 Supabase 프로젝트 (전 사이트 공통 — 테이블은  접두사로 구분)
    SUPABASE_URL: 'https://hcmgdztsgjvzcyxyayaj.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhjbWdkenRzZ2p2emN5eHlheWFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0MzU4ODcsImV4cCI6MjA4NzAxMTg4N30.gznaPzY1l8qDAPsEyYNR9KS7f7VqS3xaw-_2HTSwSZw',

    TABLE_PREFIX: '',

    /**
     * Supabase 를 실제로 쓸지.
     *
     * 기본은 false — supabase/schema.sql 을 SQL Editor 에서 실행하기 전에 true 로 두면
     * 화면이 "테이블 없음" 오류로 통째로 비어 보입니다. 스키마를 올린 뒤 켜세요.
     * 켜는 방법은 두 가지입니다.
     *   ① 이 값을 true 로 바꾸고 커밋
     *   ② 주소 뒤에 ?supabase=1 을 붙여 임시로 켜기 (커밋 없이 확인할 때)
     */
    USE_SUPABASE: false
  };

  // 주소로 임시 전환 — 스키마를 올린 직후 확인할 때 쓴다
  try {
    var q = String(root.location && root.location.search || '');
    if (/[?&]supabase=1\b/.test(q)) root.APP_CONFIG.USE_SUPABASE = true;
    if (/[?&]supabase=0\b/.test(q)) root.APP_CONFIG.USE_SUPABASE = false;
  } catch (e) { /* 파일로 직접 열었을 때 */ }
})(typeof self !== 'undefined' ? self : this);
