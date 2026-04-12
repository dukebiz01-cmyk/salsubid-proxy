export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const KEY = '898fe6b79f36285b4c381f124f45d22b1c341fd795c690e6b74cbf974c8a5d8d';
  const { keyword, region } = req.query;

  const today = new Date();
  const from = new Date(today - 30*86400000);
  const fmt = d => d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0')+'0000';

  try {
    const params = new URLSearchParams({
      serviceKey: KEY, numOfRows: '50', pageNo: '1',
      bidNtceNm: keyword || '살수차',
      inqryBgnDt: fmt(from), inqryEndDt: fmt(today), type: 'json'
    });
    const url = 'https://apis.data.go.kr/1230000/BidPublicInfoService04/getBidPblancListInfoServc?' + params;
    const r = await fetch(url);
    const data = await r.json();
    const items = data?.response?.body?.items || [];
    const arr = Array.isArray(items) ? items : [items];
    const results = arr.filter(x=>x&&x.bidNtceNo).map(item => {
      const raw = item.bidClseDateTime || '';
      const deadlineMs = raw ? new Date(raw.slice(0,4)+'-'+raw.slice(4,6)+'-'+raw.slice(6,8)+'T'+raw.slice(8,10)+':'+raw.slice(10,12)+':00').getTime() : Date.now()+86400000*3;
      const amount = parseInt(item.presmptPrce || item.bssamt || 0);
      return {
        id: item.bidNtceNo, source: '나라장터',
        title: item.bidNtceNm || '', agency: item.ntceInsttNm || '',
        amount, amountStr: amount > 0 ? Math.round(amount/10000)+'만원' : '금액미정',
        deadline: raw, deadlineMs, bidMethod: item.bidMthdNm || '입찰',
        qualify: true, urgent: (deadlineMs-Date.now())/3600000 < 48,
        type: '용역', region: region || '전국', keyword: keyword || '',
        url: 'https://www.g2b.go.kr'
      };
    });
    return res.status(200).json({ success: true, count: results.length, items: results });
  } catch(err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
