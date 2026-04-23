'use strict';

const express  = require('express');
const { scoreBid, ENGINE_VERSION } = require('../engine/scoreEngine');
const { defaultPriceRanges, calcRateStats, buildPriceRanges } = require('../engine/priceEngine');

module.exports = function createEngineRoutes({ supabase }) {
  const router = express.Router();

  // ── GET /api/engine/bids
  // 회사 프로필 기반 AI 판정 결과 반환
  router.get('/bids', async (req, res) => {
    const { company_id, limit = 100, keyword = '', decision = '' } = req.query;

    try {
      if (!company_id) return res.status(400).json({ ok: false, message: 'company_id 필요' });

      // 프로필 조회
      const { data: profile, error: pErr } = await supabase
        .from('company_profiles').select('*').eq('id', company_id).single();
      if (pErr || !profile) return res.status(404).json({ ok: false, message: '회사 프로필 없음' });

      // 공고 조회
      let q = supabase.from('bids').select('*')
        .gte('deadline', new Date().toISOString())
        .order('deadline', { ascending: true })
        .limit(Number(limit));
      if (keyword) q = q.ilike('title', `%${keyword}%`);
      const { data: bids, error: bErr } = await q;
      if (bErr) throw bErr;

      const scored = [];
      for (const bid of bids || []) {
        // 상세 + 통계 병렬 조회
        const [{ data: detail }, { data: agencyStats }] = await Promise.all([
          supabase.from('bid_details').select('*').eq('bid_id', bid.id).maybeSingle(),
          supabase.from('bid_stats').select('*').eq('stat_type', 'agency').eq('stat_key', bid.agency_code).maybeSingle(),
        ]);

        const score = scoreBid({ bid, profile, stats: agencyStats || null, detail: detail || null });

        // 판정 결과 저장 (비동기, 실패해도 응답 블록 안 함)
        supabase.from('bid_scores').upsert({
          bid_id:            bid.id,
          company_id,
          primary_category:  score.primary_category,
          categories:        score.categories,
          decision:          score.decision,
          total_score:       score.total_score,
          eligibility_score: score.eligibility_score,
          profit_score:      score.profit_score,
          risk_score:        score.risk_score,
          win_score:         score.win_score,
          proposal_score:    score.proposal_score,
          blockers:          score.blockers,
          reasons:           score.reasons,
          warnings:          score.warnings,
          next_actions:      score.next_actions,
          engine_version:    ENGINE_VERSION,
          scored_at:         new Date().toISOString(),
        }, { onConflict: 'bid_id,company_id,engine_version' }).catch(() => {});

        scored.push({ ...bid, ai: score });
      }

      let items = scored;
      if (decision) items = items.filter(i => i.ai.decision === decision);

      res.json({ ok: true, total: items.length, items });

    } catch (e) {
      console.error('[ENGINE] /bids 오류:', e.message);
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // ── GET /api/engine/bids/:bidId/price
  // 특정 공고 투찰가 구간
  router.get('/bids/:bidId/price', async (req, res) => {
    const { bidId } = req.params;
    try {
      const { data: bid } = await supabase.from('bids').select('title,amount,agency_code').eq('id', bidId).maybeSingle();
      if (!bid) return res.status(404).json({ ok: false, message: '공고 없음' });

      // 유사 낙찰이력으로 평균 낙찰율 계산
      const { data: awards } = await supabase.from('bid_awards')
        .select('award_rate').ilike('title', `%${(bid.title || '').slice(0, 8)}%`).limit(50);

      const stats = awards?.length ? calcRateStats(awards) : null;
      const base  = Number(bid.amount) || 0;
      const ranges = stats?.avg
        ? buildPriceRanges(base, stats.avg)
        : defaultPriceRanges(base);

      res.json({
        ok: true,
        source:        stats ? 'history' : 'default',
        sample_count:  stats?.count || 0,
        avg_rate:      stats?.avg   || null,
        base_amount:   base,
        ranges,
      });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // ── POST /api/engine/score-one
  // 단일 공고 즉시 판정 (프로필 없어도 사용 가능)
  router.post('/score-one', async (req, res) => {
    const { bid_id, profile } = req.body;
    if (!bid_id || !profile) return res.status(400).json({ ok: false, message: 'bid_id, profile 필요' });
    try {
      const { data: bid } = await supabase.from('bids').select('*').eq('id', bid_id).maybeSingle();
      if (!bid) return res.status(404).json({ ok: false, message: '공고 없음' });
      const score = scoreBid({ bid, profile });
      res.json({ ok: true, score });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  return router;
};
