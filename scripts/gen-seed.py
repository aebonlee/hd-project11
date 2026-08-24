#!/usr/bin/env python3
"""
js/seed-data.js 를 다시 굽는 생성기.

    python3 scripts/gen-seed.py

seed-data.js 를 손으로 고치면 다음에 이 스크립트를 돌릴 때 통째로 날아간다.
더미를 바꿀 일이 생기면 **여기를 고치고 다시 굽는다.**

들어가는 것 : scripts/kpi-catalog.json (모듈·지표명·판정방향·환산배율·값형식)
나오는 것   : js/seed-data.js  (사업장 6곳 x KPI 120개 x 12개월)

주의 — 목표·실적 수치는 전부 이 스크립트가 만들어 낸 가짜다.
사내 실적 파일을 이 저장소에 넣지 말 것.
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# 원본 매핑표의 영문 모듈 표기가 파일마다 갈린다
# ("Materials supply" / "Material Supply", "Zero defects" / "Zero Defect" …).
# 코드와 국문명으로 눌러서 하나로 모은다.
CANON = {
    'goal-oriented team operation': ('GOT', '목표지향적 팀운영'),
    'issue escalation':             ('ISS', '생산이슈관리'),
    'cross functional work':        ('CFW', '다기능'),
    'quality planning':             ('QP',  '품질계획'),
    'quality assurance':            ('QA',  '품질보증'),
    'zero defects':                 ('ZD',  '무결점'),
    'zero defect':                  ('ZD',  '무결점'),
    'problem solving methodology':  ('PSM', '문제해결 방법론'),
    'improvement approach':         ('IMP', '개선활동'),
    'vsm':                          ('VSM', 'VSM(가치흐름)'),
    '5s':                           ('5S',  '5S'),
    'tpm':                          ('TPM', 'TPM'),
    'standard work':                ('STD', '표준작업'),
    'standardized work':            ('STD', '표준작업'),
    'levelled production':          ('LVL', '평준화생산'),
    'materials supply':             ('MAT', '자재공급'),
    'material supply':              ('MAT', '자재공급'),
    'continuous flow production':   ('CFP', '연속흐름생산'),
    'lob':                          ('LOB', 'LOB(라인밸런싱)'),
    'pull system':                  ('PUL', '풀시스템'),
    'leadership':                   ('LDR', '리더십'),
    'ehs':                          ('EHS', '안전과환경'),
}

# 총괄파일 R&R 칸에 실제로 들어가는 팀 이름들.
# 담당이 둘이면 줄바꿈으로 붙는다 — Logic.splitOwners 가 이걸 나눈다.
OWNER_BY_MOD = {
    'EHS': 'EHS팀',       'GOT': '생산팀\n혁신팀', 'ISS': 'ALC',
    'CFW': '생산팀',       'QP': '품질팀',          'QA': '품질팀',
    'ZD': '품질팀',        'PSM': '혁신팀',         'IMP': '혁신팀',
    'VSM': '생기팀',       '5S': '생산팀',          'TPM': '보전팀',
    'STD': '생기팀',       'LVL': 'PPIC팀',         'MAT': 'PPIC팀',
    'CFP': '생산운영팀',   'LOB': '생산운영팀',     'PUL': 'PPIC팀',
    'LDR': '전체 팀',
}

OWNERS = ['ALC', 'EHS팀', 'PPIC팀', '보전팀', '생기팀',
          '생산운영팀', '생산팀', '품질팀', '혁신팀', '전체 팀']

# 사업장 이름은 더미다. 실제 목록으로 바꾸려면 여기만 고치면 된다.
SITES = [
    ('ULS', '울산캠퍼스', '국내'),
    ('ICN', '인천공장',   '국내'),
    ('GSN', '군산공장',   '국내'),
    ('IND', '인도법인',   '해외'),
    ('BRA', '브라질법인', '해외'),
    ('EUR', '유럽법인',   '해외'),
]

MONTHS = ['%d월' % i for i in range(1, 13)]


def unit_of(ko, scale, fmt):
    """지표명에서 단위를 유추한다. 원본에 단위 칸이 따로 없어 이름으로 가른다."""
    if fmt == '시간serial':
        return '시간'
    if '리드타임' in ko:
        return '일'
    if 'MH' in ko:
        return 'MH/대'
    if '건수' in ko or ko.endswith('건'):
        return '건/년'
    if str(scale) == '100' or '율' in ko or '률' in ko or '비율' in ko or '(%)' in ko:
        return '%'
    if 'IQ' in ko or 'WQ' in ko:
        return 'ppm'
    return '건'


def prng(seed):
    """결정적 의사난수 — 다시 구워도 같은 더미가 나와야 diff 가 조용하다."""
    s = [seed & 0xffffffff]

    def nxt():
        s[0] = (1103515245 * s[0] + 12345) & 0x7fffffff
        return s[0] / 0x7fffffff
    return nxt


def target_for(unit, r):
    if unit == '%':      return round(60 + r() * 35, 1)
    if unit == 'MH/대':  return round(2 + r() * 4, 2)
    if unit == '일':     return round(0.1 + r() * 0.4, 3)
    if unit == '건/년':  return int(20 + r() * 400)
    if unit == 'ppm':    return int(100 + r() * 400)
    if unit == '시간':   return round(0.5 + r() * 3, 2)
    return int(1 + r() * 40)


def build():
    with open(os.path.join(HERE, 'kpi-catalog.json'), encoding='utf-8') as f:
        catalog = json.load(f)

    sites = []
    for si, (sid, sname, region) in enumerate(SITES):
        r = prng(7919 * (si + 1))
        kpis = []
        for i, c in enumerate(catalog):
            key = c['module'].lower()
            if key not in CANON:
                continue
            code, ko_mod = CANON[key]
            ko = c['ko']
            unit = unit_of(ko, c['scale'], c['fmt'])
            up = c['dir'].startswith('상향')
            target = target_for(unit, r)

            actuals = {}
            bias = r() - 0.42          # 지표마다 잘하는/못하는 성향을 준다
            for mi, mo in enumerate(MONTHS):
                # 최근 달은 자료가 아직 안 온 상황도 섞는다 — '판정불가' 화면 확인용
                if mi >= 9 and r() < 0.35:
                    continue
                noise = (r() - 0.5) * 0.18 + bias * 0.12 + (mi - 5) * 0.004
                v = target * (1 + (noise if up else -noise))
                if unit in ('건/년', 'ppm', '건'):
                    v = max(0, round(v))
                elif unit == '%':
                    v = max(0, round(min(v, 100), 2))
                else:
                    v = max(0, round(v, 3))
                actuals[mo] = v

            kpis.append({
                'id': '%s-%s-%03d' % (sid, code, i),
                'module': ko_mod,
                'moduleCode': code,
                'nameKo': ko,
                'nameEn': c['en'],
                'unit': unit,
                'direction': c['dir'],
                'target': target,
                'owner': OWNER_BY_MOD.get(code, '전체 팀'),
                'scale': c['scale'],
                'format': c['fmt'],
                'actuals': actuals,
            })
        sites.append({'id': sid, 'name': sname, 'region': region, 'kpis': kpis})

    contacts = [{'siteId': sid, 'owner': o, 'name': '', 'email': ''}
                for sid, _, _ in SITES for o in OWNERS]

    return {'sites': sites, 'contacts': contacts, 'months': MONTHS}


def main():
    data = build()
    body = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    js = (
        "/* 자동 생성 파일 — 직접 고치지 말고 scripts/gen-seed.py 를 고쳐 다시 구울 것. */\n"
        "/* 목표·실적 수치는 전부 임의로 만든 더미다. 실데이터 아님. */\n"
        "(function(root,f){if(typeof module==='object'&&module.exports)module.exports=f();"
        "else root.SeedData=f();})(typeof self!=='undefined'?self:this,function(){'use strict';return "
        + body + ";});\n"
    )
    out = os.path.join(ROOT, 'js', 'seed-data.js')
    with open(out, 'w', encoding='utf-8') as f:
        f.write(js)

    total = sum(len(s['kpis']) for s in data['sites'])
    print('사업장 %d곳 / KPI %d개 / %s' % (len(data['sites']), total, out))
    for s in data['sites']:
        print('  %-8s KPI %d개' % (s['name'], len(s['kpis'])))


if __name__ == '__main__':
    main()
