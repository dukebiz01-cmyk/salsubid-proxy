'use strict';

/**
 * 투찰가 3구간 산출
 * 낮은 가격 = 공격형(낙찰 가능성↑ 수익성↓)
 * 높은 가격 = 수익방어형(낙찰 가능성↓ 수익성↑)
 */
function buildPriceRanges(baseAmount, avgRate) {
  const base = Number(baseAmount) || 0;
  const avg  = Number(avgRate)    || 0;
  if (!base || !avg) return null;

  const aggressiveRate    = Math.round((avg - 0.7) * 100) / 100;
  const targetRate        = Math.round(avg          * 100) / 100;
  const marginProtectRate = Math.round((avg + 0.7)  * 100) / 100;

  return {
    aggressive: {
      rate:    aggressiveRate,
      amount:  Math.round(base * aggressiveRate / 100),
      label:   '공격형',
      note:    '낙찰 가능성 높이나 수익성 위험',
    },
    target: {
      rate:    targetRate,
      amount:  Math.round(base * targetRate / 100),
      label:   '기준형 ★',
      note:    '유사 낙찰이력 평균 기준',
    },
    margin_protect: {
      rate:    marginProtectRate,
      amount:  Math.round(base * marginProtectRate / 100),
      label:   '수익방어형',
      note:    '수익성 높이나 낙찰 가능성 저하',
    },
    disclaimer: '투찰가 참고구간은 낙찰 보장이 아닌 유사 이력 기반 참고값입니다. 최종 투찰가는 공고문·복수예비가격·사정률·적격심사 기준 확인 후 결정하세요.',
  };
}

/**
 * 이력 없을 때 하한율 기반 기본값 (적격심사 87.745% 기준)
 */
function defaultPriceRanges(baseAmount) {
  const base = Number(baseAmount) || 0;
  if (!base) return null;
  return buildPriceRanges(base, 87.745);
}

/**
 * 이력 배열에서 통계 계산
 */
function calcRateStats(awards) {
  const rates = awards.filter(a => a.award_rate != null).map(a => parseFloat(a.award_rate));
  if (!rates.length) return null;
  rates.sort((a, b) => a - b);
  const avg = rates.reduce((s, v) => s + v, 0) / rates.length;
  return {
    count:   rates.length,
    avg:     Math.round(avg * 100) / 100,
    median:  rates[Math.floor(rates.length / 2)],
    min:     rates[0],
    max:     rates[rates.length - 1],
    p25:     rates[Math.floor(rates.length * 0.25)],
    p75:     rates[Math.floor(rates.length * 0.75)],
  };
}

module.exports = { buildPriceRanges, defaultPriceRanges, calcRateStats };
