'use strict';

const express = require('express');

module.exports = function createFeedbackRoutes({ supabase }) {
  const router = express.Router();

  // ── POST /api/feedback
  router.post('/', async (req, res) => {
    const { company_id, bid_id, action, memo, won_amount, profit_amount, loss_reason } = req.body;
    if (!company_id || !bid_id || !action) {
      return res.status(400).json({ ok: false, message: 'company_id, bid_id, action 필요' });
    }
    const VALID_ACTIONS = ['viewed','saved','applied','won','lost','ignored','report_requested'];
    if (!VALID_ACTIONS.includes(action)) {
      return res.status(400).json({ ok: false, message: `action은 ${VALID_ACTIONS.join('/')} 중 하나` });
    }
    try {
      const { error } = await supabase.from('bid_feedback').insert({
        company_id, bid_id, action,
        memo:          memo          || null,
        won_amount:    won_amount    || null,
        profit_amount: profit_amount || null,
        loss_reason:   loss_reason   || null,
      });
      if (error) throw error;
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // ── GET /api/feedback/stats/:companyId
  // 낙찰률, 참여율 등 개인화 통계
  router.get('/stats/:companyId', async (req, res) => {
    const { companyId } = req.params;
    try {
      const { data } = await supabase.from('bid_feedback')
        .select('action').eq('company_id', companyId);
      if (!data?.length) return res.json({ ok: true, stats: null });

      const counts = data.reduce((acc, r) => { acc[r.action] = (acc[r.action] || 0) + 1; return acc; }, {});
      const participated = (counts.applied || 0) + (counts.won || 0) + (counts.lost || 0);
      res.json({
        ok: true,
        stats: {
          total_viewed:   counts.viewed      || 0,
          total_applied:  participated,
          total_won:      counts.won         || 0,
          total_lost:     counts.lost        || 0,
          win_rate:       participated ? Math.round((counts.won || 0) / participated * 100) : 0,
        },
      });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  return router;
};
