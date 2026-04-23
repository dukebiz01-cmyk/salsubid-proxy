'use strict';

const { CATEGORY_RULES } = require('./categoryRules');

/**
 * 공고를 다중 카테고리로 분류 (confidence 포함)
 * 단일 분류의 위험성 제거 — 복합 공고 정확히 처리
 */
function detectCategories(bid) {
  const text = [
    bid.title        || '',
    bid.agency       || '',
    bid.bid_type     || '',
    bid.license_type || '',
    bid.eligible_region || '',
  ].join(' ');

  const matches = [];

  for (const [key, rule] of Object.entries(CATEGORY_RULES)) {
    let hitCount = 0;
    for (const kw of rule.keywords) {
      if (text.includes(kw)) hitCount++;
    }
    if (hitCount > 0) {
      matches.push({
        key,
        label: rule.label,
        score: parseFloat(Math.min(1, hitCount / 3).toFixed(2)),
        hits: hitCount,
      });
    }
  }

  // confidence 기준 정렬
  matches.sort((a, b) => b.score - a.score || (CATEGORY_RULES[a.key]?.priority || 99) - (CATEGORY_RULES[b.key]?.priority || 99));

  const primary = matches[0]?.key || 'etc';

  return {
    primary_category: primary,
    categories: matches.length
      ? matches
      : [{ key: 'etc', label: '기타', score: 0.1, hits: 0 }],
  };
}

module.exports = { detectCategories };
