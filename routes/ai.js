'use strict';

const express = require('express');
const { analyzeBid } = require('../engine/aiEngine');

module.exports = function createAiRoutes({ supabase }) {
  const router = express.Router();

  // POST /api/ai/analyze
  // 공고 AI 분석 (요약 + 서류 + 위험조항 + 다음행동)
  router.post('/analyze', async (req, res) => {
    const { bid_id, title, agency, amount, category, license_type, profile } = req.body;
    if (!title) return res.status(400).json({ ok: false, message: 'title 필요' });

    try {
      // 캐시 확인 (bid_documents 테이블)
      if (bid_id && supabase) {
        const { data: cached } = await supabase
          .from('bid_documents')
          .select('ai_json, parsed_at')
          .eq('bid_id', bid_id)
          .maybeSingle();

        if (cached?.ai_json) {
          return res.json({ ok: true, source: 'cache', result: cached.ai_json });
        }
      }

      // Claude API 호출
      const result = await analyzeBid({
        title,
        agency:      agency || '',
        amount:      amount || '',
        category:    category || '기타',
        licenseText: license_type || '',
        profile:     profile || {},
      });

      // 결과 저장
      if (bid_id && supabase) {
        await supabase.from('bid_documents').upsert({
          bid_id,
          ai_json:   result,
          parsed_at: new Date().toISOString(),
        }, { onConflict: 'bid_id' }).then(() => {}).catch(() => {});
      }

      res.json({ ok: true, source: 'claude', result });

    } catch (e) {
      console.error('[AI] analyze 오류:', e.message);
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // GET /api/ai/analyze/:bidId — 캐시 조회
  router.get('/analyze/:bidId', async (req, res) => {
    const { bidId } = req.params;
    try {
      const { data } = await supabase
        .from('bid_documents')
        .select('ai_json, parsed_at')
        .eq('bid_id', bidId)
        .maybeSingle();

      if (!data?.ai_json) return res.json({ ok: false, message: '분석 결과 없음' });
      res.json({ ok: true, source: 'cache', result: data.ai_json, parsed_at: data.parsed_at });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  return router;
};
