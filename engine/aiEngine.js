'use strict';

const fetch = require('node-fetch');

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';
const MODEL      = 'claude-sonnet-4-20250514';

/**
 * 공고 AI 분석
 * - 3줄 요약
 * - 제출서류 체크리스트
 * - 위험조항
 * - 지금 할 것
 */
async function analyzeBid({ title, agency, amount, category, licenseText = '', profile = {} }) {
  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY 미설정');

  const prompt = `당신은 대한민국 공공입찰 전문가입니다.
아래 공고를 분석하고 JSON만 출력하세요. 다른 텍스트 없이 순수 JSON만.

공고명: ${title}
발주기관: ${agency}
기초금액: ${amount}
업종분류: ${category}
면허제한: ${licenseText || '미확인'}
회사주력: ${profile.mainCat || '장비/임차'}
보유면허: ${(profile.licenses || []).join(', ') || '미등록'}

JSON 형식:
{
  "summary": "공고 핵심 내용 3문장 (한글, 구체적으로)",
  "docs": ["필수제출서류1", "필수제출서류2", "필수제출서류3", "필수제출서류4", "필수제출서류5"],
  "risks": ["위험조항 또는 주의사항1", "위험조항2"],
  "nextActions": ["지금 당장 할 행동1", "할 행동2", "할 행동3"],
  "bidType": "최저가|적격심사|협상|수의계약|알수없음",
  "competitionLevel": "낮음|보통|높음|알수없음"
}`;

  const res = await fetch(CLAUDE_API, {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: 1000,
      messages:   [{ role: 'user', content: prompt }],
    }),
    timeout: 20000,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API 오류 ${res.status}: ${err.slice(0, 100)}`);
  }

  const data = await res.json();
  const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  const clean = text.replace(/```json|```/g, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    parsed = {
      summary:        text.slice(0, 300),
      docs:           ['입찰참가신청서', '사업자등록증', '법인인감증명서', '재무제표', '실적증명서'],
      risks:          ['공고문 직접 확인 필요'],
      nextActions:    ['공고문 원문 확인', '첨부파일 다운로드', '마감일 캘린더 등록'],
      bidType:        '알수없음',
      competitionLevel: '알수없음',
    };
  }
  return parsed;
}

/**
 * 판정 결론 자연어 생성
 * scoreEngine의 숫자 점수를 Claude가 자연스러운 한국어로 설명
 */
async function generateVerdict({ title, decision, score, blockers, reasons, warnings, profile }) {
  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) return null;

  const reasonTexts = reasons.map(r => r.text || r).join(', ');
  const warningTexts = warnings.map(w => w.text || w).join(', ');
  const blockerText = blockers.length ? blockers.join(', ') : '없음';

  const prompt = `공공입찰 AI 판정 시스템입니다.
아래 데이터를 바탕으로 30자 이내 한국어 결론 한 문장만 출력하세요.

공고명: ${title}
판정: ${decision}
점수: ${score}점
긍정요소: ${reasonTexts}
경고: ${warningTexts}
차단요소: ${blockerText}

조건: 
- 30자 이내 한 문장
- 구체적이고 실용적
- 예시: "면허 적합, 지역 유리 — 적극 참여 권장"
- 예시: "면허 확인 필요, 경쟁 보통 — 서류 준비 후 검토"
- 다른 텍스트 없이 결론 문장만`;

  try {
    const res = await fetch(CLAUDE_API, {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: 80,
        messages:   [{ role: 'user', content: prompt }],
      }),
      timeout: 8000,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
  } catch {
    return null;
  }
}

module.exports = { analyzeBid, generateVerdict };
