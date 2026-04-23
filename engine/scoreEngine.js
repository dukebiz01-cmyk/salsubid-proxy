'use strict';

const { detectCategories } = require('./categoryEngine');

const ENGINE_VERSION = 'v1.0';

function toNumber(v) {
  const n = Number(String(v || 0).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function isClosed(deadline) {
  if (!deadline) return false;
  return new Date(deadline).getTime() < Date.now();
}

function includesAny(text, arr = []) {
  return arr.some(v => String(v) && text.includes(v));
}

function reason(type, text, weight = 0) {
  return { type, text, weight };
}

/**
 * 핵심 판정 엔진
 * @param {object} bid        - bids 테이블 row
 * @param {object} profile    - company_profiles 테이블 row
 * @param {object|null} stats - bid_stats row (발주처/지역 경쟁통계)
 * @param {object|null} detail - bid_details row (AI 문서 분석 결과)
 */
function scoreBid({ bid, profile, stats = null, detail = null }) {
  const { primary_category, categories } = detectCategories(bid);

  const reasons   = [];
  const warnings  = [];
  const blockers  = [];
  const nextActions = [];

  let eligibilityScore = 0;
  let profitScore      = 0;
  let riskScore        = 50; // 기본 50점에서 가감
  let winScore         = 0;
  let proposalScore    = 0;

  const title      = bid.title || '';
  const regionText = `${bid.region || ''} ${bid.eligible_region || ''}`;
  const amount     = toNumber(bid.amount);
  const regions    = (profile.regions?.length ? profile.regions : [profile.region]).filter(Boolean);
  const licenses   = profile.licenses   || [];
  const equipments = profile.equipments || [];
  const minAmount  = toNumber(profile.min_amount);

  // ── 1. 마감
  if (isClosed(bid.deadline)) {
    blockers.push('입찰 마감됨');
  }

  // ── 2. 지역
  const regionOk = regions.some(r => regionText.includes(r));
  if (regionOk) {
    eligibilityScore += 20;
    reasons.push(reason('ok', '참가 지역 적합', 20));
  } else {
    warnings.push(reason('warn', '참가가능지역 확인 필요', -10));
    riskScore -= 10;
  }

  // ── 3. 최소금액
  if (amount > 0) {
    if (minAmount && amount < minAmount) {
      profitScore -= 15;
      warnings.push(reason('warn', `기초금액 미달 (${_fmtAmt(amount)} < ${_fmtAmt(minAmount)})`, -15));
    } else {
      profitScore += 15;
      reasons.push(reason('ok', `기초금액 ${_fmtAmt(amount)}`, 15));
    }
  } else {
    warnings.push(reason('warn', '기초금액 미확인', -5));
  }

  // ── 4. 마감 리스크
  if (!isClosed(bid.deadline) && bid.deadline) {
    const h = (new Date(bid.deadline) - Date.now()) / 3600000;
    if (h < 24)  { riskScore -= 15; warnings.push(reason('warn', '마감 24시간 이내 — 서류 리스크', -15)); }
    else if (h < 72) { riskScore -= 5; warnings.push(reason('warn', 'D-3 — 일정 확인 필요', -5)); }
  }

  // ── 5. 업종별 판정
  switch (primary_category) {

    case 'equipment': {
      const match = equipments.some(e => title.includes(e));
      if (match) {
        eligibilityScore += 30;
        reasons.push(reason('ok', '보유 장비와 공고명 일치', 30));
      } else {
        warnings.push(reason('warn', '장비 사양·규격 확인 필요', -5));
      }
      eligibilityScore += 10;
      reasons.push(reason('ok', '장비임차 — 면허 진입장벽 낮음', 10));
      nextActions.push('장비 톤수·연식·보험 조건 확인');
      nextActions.push('운전자 포함 여부 확인');
      break;
    }

    case 'civil': {
      const licOk = licenses.some(l => l.includes('토목') || l.includes('전문건설'));
      if (licOk) {
        eligibilityScore += 30;
        reasons.push(reason('ok', '토목/전문건설 면허 보유', 30));
      } else if (licenses.length === 0) {
        warnings.push(reason('warn', '토목공사업 면허 프로필 미등록', -20));
      } else {
        blockers.push('토목공사업 면허 없음 — 참여 불가');
      }
      nextActions.push('시공능력평가액 기준 확인');
      nextActions.push('최근 3년 실적 제한 확인');
      nextActions.push('현장설명 여부 확인');
      break;
    }

    case 'architecture': {
      const licOk = licenses.some(l => l.includes('건축') || l.includes('실내건축') || l.includes('전문건설'));
      if (licOk) {
        eligibilityScore += 30;
        reasons.push(reason('ok', '건축/전문건설 면허 보유', 30));
      } else if (licenses.length === 0) {
        warnings.push(reason('warn', '건축공사업 면허 프로필 미등록', -20));
      } else {
        blockers.push('건축공사업 면허 없음 — 참여 불가');
      }
      if (title.match(/리모델링|개보수|내진/)) {
        eligibilityScore += 10;
        reasons.push(reason('ok', '소규모 개보수 — 진입 가능성', 10));
      }
      nextActions.push('기술자 배치 기준 확인');
      nextActions.push('현장설명 여부 확인');
      break;
    }

    case 'specialty': {
      const licOk = licenses.some(l => l.includes('전문건설') || l.includes('조경'));
      if (licOk) {
        eligibilityScore += 25;
        reasons.push(reason('ok', '전문건설업 면허 보유', 25));
      } else if (licenses.length === 0) {
        warnings.push(reason('warn', '전문공사 면허 프로필 미등록', -10));
      } else {
        warnings.push(reason('warn', '해당 전문공사 면허 확인 필요', -15));
      }
      nextActions.push('해당 업종 세부 면허 확인');
      break;
    }

    case 'electric': {
      const licOk = licenses.some(l => l.includes('전기공사'));
      if (licOk) {
        eligibilityScore += 35;
        reasons.push(reason('ok', '전기공사업 면허 보유', 35));
      } else if (licenses.length === 0) {
        warnings.push(reason('warn', '전기공사업 면허 프로필 미등록', -25));
      } else {
        blockers.push('전기공사업 면허 없음 — 참여 불가');
      }
      nextActions.push('전기공사 기술자 보유 확인');
      nextActions.push('관급자재/사급자재 구분 확인');
      nextActions.push('안전관리비 계상 여부 확인');
      break;
    }

    case 'fire': {
      const licOk = licenses.some(l => l.includes('소방'));
      if (licOk) {
        eligibilityScore += 35;
        reasons.push(reason('ok', '소방시설공사업 면허 보유', 35));
      } else if (licenses.length === 0) {
        warnings.push(reason('warn', '소방 면허 프로필 미등록', -25));
      } else {
        blockers.push('소방시설공사업 면허 없음 — 참여 불가');
      }
      if (title.match(/기계|스프링클러|소화/)) nextActions.push('기계소방 전문 여부 확인');
      if (title.match(/전기소방|감지|유도등/))   nextActions.push('전기소방 전문 여부 확인');
      nextActions.push('소방감리 포함 여부 확인');
      break;
    }

    case 'telecom': {
      const licOk = licenses.some(l => l.includes('정보통신'));
      if (licOk) {
        eligibilityScore += 30;
        reasons.push(reason('ok', '정보통신공사업 등록 보유', 30));
      } else if (licenses.length === 0) {
        warnings.push(reason('warn', '정보통신공사업 등록 미확인', -15));
      } else {
        warnings.push(reason('warn', '정보통신공사업 등록 여부 확인', -15));
      }
      nextActions.push('직접생산증명/제조사 인증 필요 여부 확인');
      nextActions.push('유지보수 기간 및 부담 확인');
      break;
    }

    case 'sales': {
      profitScore += profile.proposal_capacity ? 20 : 0;
      if (!profile.proposal_capacity) {
        warnings.push(reason('warn', '제안서 작성 역량 확인 필요', -15));
      }
      nextActions.push('RFP 평가항목 및 배점 확인');
      nextActions.push('분양대행 실적 증빙 준비');
      nextActions.push('상담인력 투입계획 수립');
      break;
    }

    case 'ads': {
      profitScore += profile.proposal_capacity ? 20 : 0;
      if (!profile.proposal_capacity) {
        warnings.push(reason('warn', '제안서/PT 역량 확인 필요', -10));
      }
      nextActions.push('정성평가 비중 확인');
      nextActions.push('유사 실적 포트폴리오 준비');
      nextActions.push('제안서 작성 일정 확인');
      break;
    }

    default:
      warnings.push(reason('warn', '업종 미분류 — 상세 확인 필요', -5));
  }

  // ── 6. 낙찰/경쟁 통계 반영
  if (stats) {
    const comp = stats.competition || '';
    if      (comp === '낮음')   { winScore += 20; reasons.push(reason('ok', '유사 공고 경쟁강도 낮음', 20)); }
    else if (comp === '보통')   { winScore += 12; reasons.push(reason('ok', '유사 공고 경쟁강도 보통', 12)); }
    else if (comp === '높음')   { winScore += 4;  warnings.push(reason('warn', '경쟁강도 높음', -8)); }
    else if (comp === '매우높음') { winScore += 1; warnings.push(reason('warn', '경쟁강도 매우높음 — 신중히', -15)); }

    if (stats.avg_award_rate) {
      reasons.push(reason('ok', `유사 낙찰율 평균 ${stats.avg_award_rate}%`, 5));
    }
  }

  // ── 7. 문서 AI 분석 결과 반영
  if (detail?.ai_risks?.length) {
    riskScore -= Math.min(25, detail.ai_risks.length * 5);
    warnings.push(reason('warn', 'AI 추출 위험조항 존재 — 검토 필요', -10));
    nextActions.push('공고문 AI 추출 위험조항 검토');
  }
  if (detail?.ai_docs?.length) {
    nextActions.push(`제출서류 ${detail.ai_docs.length}개 확인`);
  }

  // ── 8. 최종 점수 계산
  const rawTotal = eligibilityScore + profitScore + (riskScore - 50) + winScore + proposalScore;
  const totalScore = Math.max(0, Math.min(100, rawTotal));

  // ── 9. 판정
  let decision;
  if (blockers.length)      decision = 'SKIP';
  else if (totalScore >= 65) decision = 'GO';
  else if (totalScore >= 35) decision = 'REVIEW';
  else                       decision = 'SKIP';

  return {
    primary_category,
    categories,
    decision,
    total_score:       Math.round(totalScore),
    eligibility_score: Math.round(eligibilityScore),
    profit_score:      Math.round(profitScore),
    risk_score:        Math.round(riskScore),
    win_score:         Math.round(winScore),
    proposal_score:    Math.round(proposalScore),
    blockers,
    reasons,
    warnings,
    next_actions: [...new Set(nextActions)],
    engine_version: ENGINE_VERSION,
  };
}

function _fmtAmt(n) {
  if (!n) return '—';
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '억';
  if (n >= 10000)     return Math.round(n / 10000).toLocaleString() + '만';
  return n.toLocaleString() + '원';
}

module.exports = { scoreBid, ENGINE_VERSION };
