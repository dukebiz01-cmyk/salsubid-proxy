'use strict';

const express  = require('express');
const cors     = require('cors');
const cron     = require('node-cron');
const fetch    = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

const { scoreBid, ENGINE_VERSION } = require('./engine/scoreEngine');
const { detectCategories }         = require('./engine/categoryEngine');
const { buildPriceRanges, defaultPriceRanges, calcRateStats } = require('./engine/priceEngine');
const createEngineRoutes   = require('./routes/engine');
const createFeedbackRoutes = require('./routes/feedback');
const createAiRoutes       = require('./routes/ai');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── 환경변수
const G2B_KEY  = process.env.G2B_SERVICE_KEY    || '';
const SB_URL   = process.env.SUPABASE_URL        || '';
const SB_KEY   = process.env.SUPABASE_SERVICE_KEY|| '';
const ADMIN_SK = process.env.ADMIN_SECRET        || 'admin1234';
// ANTHROPIC_API_KEY는 aiEngine.js에서 직접 process.env로 읽음

const supabase = createClient(SB_URL, SB_KEY);

app.use(cors());
app.use(express.json());

// ── 라우터 마운트
app.use('/api/engine',   createEngineRoutes({ supabase }));
app.use('/api/feedback', createFeedbackRoutes({ supabase }));
app.use('/api/ai',       createAiRoutes({ supabase }));

// ──────────────────────────────────────────
// 유틸
// ──────────────────────────────────────────
function encKey(k){ return k.includes('%') ? k : encodeURIComponent(k); }

function parseDeadline(s){
  if(!s) return null;
  const t=String(s).trim();
  let d;
  if(/^\d{14}$/.test(t))
    d=new Date(`${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}T${t.slice(8,10)}:${t.slice(10,12)}:00+09:00`);
  else
    d=new Date(t);
  return isNaN(d.getTime())?null:d;
}

// ── S7 수정: compound PK + category 포함
function normalizeItem(item){
  const title   = item.bidNtceNm || '';
  const agency  = item.dminsttNm || item.ntceInsttNm || '';
  const bidType = item.bidMthdNm || '';
  const bidNo   = item.bidNtceNo || '';
  const bidOrd  = item.bidNtceOrd || '00';

  const { primary_category } = detectCategories({ title, agency, bid_type: bidType, license_type: item.indstrytyCd||'' });

  return {
    id:              `${bidNo}-${bidOrd}`,  // compound PK
    bid_no:          bidNo,
    bid_ord:         bidOrd,
    title,
    agency,
    agency_code:     item.dminsttCd       || '',
    region:          item.ntceRegionNm    || item.bidNtceRegionNm || '',
    amount:          Number(item.asignBdgtAmt || item.presmptPrce || 0) || null,
    deadline:        parseDeadline(item.bidClseDt || item.opengDt),
    bid_type:        bidType,
    license_type:    item.indstrytyCd     || item.prdctClsfcNoNm || '',
    eligible_region: item.ntceRegionNm    || '',
    category:        primary_category,
    raw_json:        item,
  };
}

function normalizeAward(item){
  const base  = Number(item.presmptPrce  || 0);
  const award = Number(item.sucsfbidAmt  || 0);
  return {
    bid_id:       null,
    title:        item.bidNtceNm    || '',
    agency:       item.dminsttNm    || '',
    agency_code:  item.dminsttCd    || '',
    region:       item.ntceRegionNm || '',
    base_amount:  base  || null,
    award_amount: award || null,
    award_rate:   (base && award) ? Math.round(award/base*10000)/100 : null,
    bidder_count: Number(item.bidPrtcpntCnt || 0) || null,
    winner:       item.sucsfbidCorpNm || '',
    award_date:   item.opengDt ? item.opengDt.slice(0,10) : null,
    bid_type:     item.bidMthdNm  || '',
    license_type: item.indstrytyCd || '',
  };
}

// ──────────────────────────────────────────
// G2B API 호출
// ──────────────────────────────────────────
async function fetchG2BBids({ keyword='', numOfRows=100, pageNo=1 }={}){
  const url = `https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoServc`
    +`?serviceKey=${encKey(G2B_KEY)}&numOfRows=${numOfRows}&pageNo=${pageNo}&_type=json`
    +(keyword?`&bidNtceNm=${encodeURIComponent(keyword)}`:'');
  const res  = await fetch(url, { timeout: 15000 });
  const text = await res.text();
  let body;
  try {
    const data = JSON.parse(text);
    body = data?.response?.body;
  } catch {
    // XML fallback 파싱
    const itemMatches = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)];
    const totalMatch  = text.match(/<totalCount>(\d+)<\/totalCount>/);
    const items = itemMatches.map(m => {
      const xml = m[1];
      const getVal = tag => { const r = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)); return r ? r[1].trim() : ''; };
      return {
        bidNtceNo:    getVal('bidNtceNo'),
        bidNtceOrd:   getVal('bidNtceOrd'),
        bidNtceNm:    getVal('bidNtceNm'),
        dminsttNm:    getVal('dminsttNm'),
        dminsttCd:    getVal('dminsttCd'),
        ntceRegionNm: getVal('ntceRegionNm'),
        asignBdgtAmt: getVal('asignBdgtAmt'),
        presmptPrce:  getVal('presmptPrce'),
        bidClseDt:    getVal('bidClseDt'),
        bidMthdNm:    getVal('bidMthdNm'),
        indstrytyCd:  getVal('indstrytyCd'),
      };
    });
    console.log(`[G2B XML] totalCount=${totalMatch?.[1]||0} items=${items.length} keyword=${keyword}`);
    return { total: Number(totalMatch?.[1]||0), items: items.map(normalizeItem) };
  }
  if(!body) throw new Error('G2B 응답 형식 오류');
  const raw  = body?.items?.item || [];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return { total: Number(body.totalCount||0), items: list.map(normalizeItem) };
}

async function fetchG2BAwards({ keyword='', numOfRows=100, pageNo=1 }={}){
  // 낙찰정보서비스 — 실제 서비스명 확인 필요
  const url = `https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoThng`
    +`?serviceKey=${encKey(G2B_KEY)}&numOfRows=${numOfRows}&pageNo=${pageNo}&_type=json`
    +(keyword?`&bidNtceNm=${encodeURIComponent(keyword)}`:'');
  const res  = await fetch(url, { timeout: 15000 });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { return { total:0, items:[] }; }
  const body = data?.response?.body;
  if(!body) return { total:0, items:[] };
  const raw  = body?.items?.item || [];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return { total: Number(body.totalCount||0), items: list.map(normalizeAward) };
}

// ──────────────────────────────────────────
// DB 저장 — 버그 수정 포함
// ──────────────────────────────────────────
async function saveBids(items){
  if(!items.length) return { saved:0, updated:0 };
  let saved=0, updated=0;
  for(const item of items){
    if(!item.id) continue;
    // ✅ change_count 포함 select (버그 수정)
    const { data: existing } = await supabase
      .from('bids').select('id,amount,deadline,title,change_count').eq('id', item.id).single();
    if(!existing){
      await supabase.from('bids').insert({
        ...item,
        status: item.deadline && item.deadline < new Date() ? '마감' : '진행중',
      });
      saved++;
    } else {
      // ✅ 날짜 비교 수정
      const oldDL = existing.deadline ? new Date(existing.deadline).getTime() : null;
      const newDL = item.deadline     ? new Date(item.deadline).getTime()     : null;
      const changed = Number(existing.amount||0) !== Number(item.amount||0)
        || oldDL !== newDL
        || existing.title !== item.title;
      if(changed){
        await supabase.from('bids').update({
          ...item,
          status:       item.deadline && item.deadline < new Date() ? '마감' : '진행중',
          updated_at:   new Date().toISOString(),
          change_count: (existing.change_count||0)+1,
        }).eq('id', item.id);
        updated++;
      }
    }
  }
  return { saved, updated };
}

async function saveAwards(items){
  if(!items.length) return 0;
  let count=0;
  for(const item of items){
    let q = supabase.from('bid_awards').select('id').eq('title', item.title).eq('agency_code', item.agency_code);
    if(item.award_date) q = q.eq('award_date', item.award_date);
    const { data } = await q.single();
    if(!data){ await supabase.from('bid_awards').insert(item); count++; }
  }
  return count;
}

// ──────────────────────────────────────────
// 통계 집계
// ──────────────────────────────────────────
async function recalcStats(){
  console.log('[STATS] 통계 집계 시작');
  const { data: awards } = await supabase.from('bid_awards').select('agency_code,agency,region,bidder_count,award_rate');
  if(!awards?.length){ console.log('[STATS] 이력 없음'); return; }

  const agencyMap={}, regionMap={};
  for(const a of awards){
    const push = (map, key) => {
      if(!key) return;
      if(!map[key]) map[key]={ count:0, bidders:[], rates:[] };
      map[key].count++;
      if(a.bidder_count) map[key].bidders.push(a.bidder_count);
      if(a.award_rate)   map[key].rates.push(parseFloat(a.award_rate));
    };
    push(agencyMap, a.agency_code);
    const r=(a.region||'').replace(/특별시|광역시|특별자치도|특별자치시/g,'').slice(0,2);
    if(r) push(regionMap, r);
  }

  const avg = arr => arr.length ? arr.reduce((s,v)=>s+v,0)/arr.length : null;
  const compLabel = b => !b?'알수없음':b<=3?'낮음':b<=7?'보통':b<=15?'높음':'매우높음';

  const rows=[];
  const buildRows=(map, type) => {
    for(const[k,v]of Object.entries(map)){
      const avgB=avg(v.bidders), avgR=avg(v.rates);
      rows.push({ stat_type:type, stat_key:k, total_bids:v.count,
        avg_bidders:  avgB?Math.round(avgB*10)/10:null,
        avg_award_rate: avgR?Math.round(avgR*1000)/1000:null,
        min_award_rate: v.rates.length?Math.min(...v.rates):null,
        max_award_rate: v.rates.length?Math.max(...v.rates):null,
        competition:  compLabel(avgB), updated_at: new Date().toISOString(),
      });
    }
  };
  buildRows(agencyMap,'agency');
  buildRows(regionMap,'region');

  for(const row of rows){
    await supabase.from('bid_stats').upsert(row, { onConflict:'stat_type,stat_key' });
  }
  console.log(`[STATS] 완료 — ${rows.length}건`);
}

// ──────────────────────────────────────────
// 수집 후 자동 스코어링
// ──────────────────────────────────────────
async function rescoreActiveBids(){
  const { data: profiles } = await supabase.from('company_profiles').select('*');
  if(!profiles?.length) return;
  const { data: bids } = await supabase.from('bids').select('*')
    .gte('deadline', new Date().toISOString()).limit(500);
  if(!bids?.length) return;
  let count=0;
  for(const profile of profiles){
    for(const bid of bids){
      const score = scoreBid({ bid, profile });
      await supabase.from('bid_scores').upsert({
        bid_id: bid.id, company_id: profile.id, ...score,
        scored_at: new Date().toISOString(),
      },{ onConflict:'bid_id,company_id,engine_version' }).then(()=>{}).catch(()=>{});
      count++;
    }
  }
  console.log(`[SCORE] 자동 스코어링 완료 — ${count}건`);
}

// ──────────────────────────────────────────
// 수집 그룹 (업종별 확장)
// ──────────────────────────────────────────
const COLLECT_GROUPS = {
  equipment: ['살수차','굴착기','덤프트럭','크레인','로더','노면청소','제설','장비임차'],
  civil:     ['토목공사','도로공사','포장공사','상수도','하수도','교량','하천'],
  architecture: ['건축공사','리모델링','개보수','내진','철거','해체'],
  electric:  ['전기공사','태양광','LED조명','수배전','가로등'],
  fire:      ['소방','소방시설','소방점검','스프링클러'],
  telecom:   ['정보통신공사','CCTV','네트워크','출입통제','주차관제'],
  sales:     ['분양','분양대행','홍보관'],
  ads:       ['광고','홍보','마케팅','행사','이벤트'],
};

async function runCollection(){
  console.log(`[CRON] 수집 시작 ${new Date().toISOString()}`);
  let total={ saved:0, updated:0 };
  for(const[group, keywords]of Object.entries(COLLECT_GROUPS)){
    for(const kw of keywords){
      try{
        const { items } = await fetchG2BBids({ keyword:kw, numOfRows:100 });
        const items2 = items.map(i=>({ ...i, collect_group:group }));
        const r = await saveBids(items2);
        total.saved+=r.saved; total.updated+=r.updated;
      }catch(e){ console.error(`  [${kw}] 오류: ${e.message}`); }
      await new Promise(r=>setTimeout(r,800));
    }
  }
  console.log(`[CRON] 수집완료 신규:${total.saved} 변경:${total.updated}`);
  await rescoreActiveBids();
}

async function runAwardCollection(){
  console.log('[CRON] 낙찰이력 수집 시작');
  let total=0;
  for(const[group, keywords]of Object.entries(COLLECT_GROUPS)){
    for(const kw of keywords.slice(0,3)){
      try{
        const { items } = await fetchG2BAwards({ keyword:kw, numOfRows:100 });
        total += await saveAwards(items);
      }catch(e){ console.error(`  [낙찰/${kw}] 오류: ${e.message}`); }
      await new Promise(r=>setTimeout(r,800));
    }
  }
  console.log(`[CRON] 낙찰수집완료 신규:${total}`);
  if(total>0) await recalcStats();
}

// ── CRON 스케줄
cron.schedule('*/10 * * * *', runCollection);
cron.schedule('0 2 * * *',   runAwardCollection);
cron.schedule('0 3 * * *',   recalcStats);

// ──────────────────────────────────────────
// 기존 API 엔드포인트 (프론트 fallback용 유지)
// ──────────────────────────────────────────
app.get('/api/test', (req,res)=>res.json({
  ok:true, time:new Date().toISOString(),
  g2bKey: G2B_KEY?'설정됨':'없음', db: SB_URL?'연결됨':'없음',
  engineVersion: ENGINE_VERSION,
}));

// 공고 목록 (DB 우선, fallback: G2B 직접)
app.get('/api/bids', async(req,res)=>{
  const { keyword='', numOfRows=100, status='', category='' } = req.query;
  try{
    let q = supabase.from('bids').select('*').order('deadline',{ascending:true});
    if(keyword)  q = q.ilike('title',`%${keyword}%`);
    if(status)   q = q.eq('status', status);
    if(category) q = q.eq('category', category);
    q = q.limit(Number(numOfRows));
    const { data, error } = await q;
    if(error || !data?.length){
      const result = await fetchG2BBids({ keyword, numOfRows:Number(numOfRows) });
      return res.json({ ok:true, source:'api', ...result });
    }
    res.json({ ok:true, source:'db', total:data.length, items:data });
  }catch(e){ res.status(500).json({ ok:false, message:e.message }); }
});

// 낙찰이력
app.get('/api/awards', async(req,res)=>{
  const { keyword='', agency_code='', region='', limit=20 } = req.query;
  try{
    let q = supabase.from('bid_awards').select('*').order('award_date',{ascending:false}).limit(Number(limit));
    if(keyword)     q = q.ilike('title',`%${keyword}%`);
    if(agency_code) q = q.eq('agency_code', agency_code);
    if(region)      q = q.ilike('region',`%${region}%`);
    const { data, error } = await q;
    if(error) throw error;
    const awards = data||[];
    const stats = awards.length ? calcRateStats(awards) : null;
    const priceRange = awards.length ? {
      min: Math.min(...awards.filter(a=>a.award_amount).map(a=>a.award_amount)),
      max: Math.max(...awards.filter(a=>a.award_amount).map(a=>a.award_amount)),
      avg: Math.round(awards.filter(a=>a.award_amount).reduce((s,a)=>s+a.award_amount,0)/(awards.filter(a=>a.award_amount).length||1)),
    } : null;
    res.json({ ok:true, stats:stats?{...stats, price_range:priceRange}:null, awards });
  }catch(e){ res.status(500).json({ ok:false, message:e.message }); }
});

// 통계
app.get('/api/stats', async(req,res)=>{
  const { type='agency', key='' } = req.query;
  try{
    let q = supabase.from('bid_stats').select('*').eq('stat_type', type);
    if(key) q = q.eq('stat_key', key);
    const { data, error } = await q;
    if(error) throw error;
    res.json({ ok:true, stats: data||[] });
  }catch(e){ res.status(500).json({ ok:false, message:e.message }); }
});

// 투찰가 구간
app.get('/api/bid-price', async(req,res)=>{
  const { keyword='', agency_code='', base_amount=0 } = req.query;
  try{
    let q = supabase.from('bid_awards').select('award_rate,bidder_count').order('award_date',{ascending:false}).limit(50);
    if(keyword)     q = q.ilike('title',`%${keyword}%`);
    if(agency_code) q = q.eq('agency_code', agency_code);
    const { data } = await q;
    const base = Number(base_amount);
    const stats = data?.length ? calcRateStats(data) : null;
    const ranges = stats?.avg ? buildPriceRanges(base, stats.avg) : defaultPriceRanges(base);
    res.json({ ok:true, source: stats?'history':'default', sample_count: stats?.count||0, avg_rate: stats?.avg||null, ranges });
  }catch(e){ res.status(500).json({ ok:false, message:e.message }); }
});

// 관리자 — 수동 수집
app.post('/api/admin/collect', async(req,res)=>{
  if(req.body?.secret !== ADMIN_SK) return res.status(403).json({ ok:false });
  const type = req.body?.type || 'bids';
  if(type==='awards') runAwardCollection().catch(console.error);
  else               runCollection().catch(console.error);
  res.json({ ok:true, message:'수집 시작됨' });
});

app.post('/api/admin/recalc', async(req,res)=>{
  if(req.body?.secret !== ADMIN_SK) return res.status(403).json({ ok:false });
  recalcStats().catch(console.error);
  res.json({ ok:true, message:'통계 집계 시작됨' });
});

// ──────────────────────────────────────────
app.listen(PORT, ()=>{
  console.log(`BIDGEAR 서버 실행: http://localhost:${PORT}`);
  console.log(`G2B: ${G2B_KEY?'✅':'❌'} | DB: ${SB_URL?'✅':'❌'} | Engine: ${ENGINE_VERSION}`);
  setTimeout(()=>runCollection().catch(console.error), 5000);
});
