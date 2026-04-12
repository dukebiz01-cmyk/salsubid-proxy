const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

console.log('G2B KEY:', process.env.G2B_SERVICE_KEY ? '있음' : '없음');

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  next();
});

app.get('/api/test', (req, res) => {
  res.json({ ok: true, message: '살수비드 서버 작동중' });
});

app.get('/api/g2b', async (req, res) => {
  const SERVICE_KEY = process.env.G2B_SERVICE_KEY;
  const { keyword = '살수차', page = 1, size = 20 } = req.query;

  if (!SERVICE_KEY) {
    return res.json({
      success: true,
      mock: true,
      total: 2,
      items: [
        {
          id: 'MOCK-001',
          title: '청주시 도로살수 용역',
          agency: '청주시 도로관리과',
          amount: '48000000',
          deadline: new Date(Date.now() + 86400000 * 2).toISOString(),
          status: '마감임박',
        },
        {
          id: 'MOCK-002',
          title: '충북도청 살수차 용역',
          agency: '충청북도',
          amount: '120000000',
          deadline: new Date(Date.now() + 86400000 * 5).toISOString(),
          status: '진행중',
        },
      ],
    });
  }

  try {
    const url = `https://apis.data.go.kr/1230000/BidPublicInfoService/getBidPblancListInfoServc?serviceKey=${encodeURIComponent(SERVICE_KEY)}}&numOfRows=${size}&pageNo=${page}&type=json&bidNtceNm=${encodeURIComponent(keyword)}`;
    const response = await fetch(url);
    const text = await response.text();
    console.log('G2B 응답:', text.substring(0, 300));
    const data = JSON.parse(text);
    const items = data?.response?.body?.items?.item || [];
    const total = data?.response?.body?.totalCount || 0;
    const list = Array.isArray(items) ? items : [items];

    return res.json({
      success: true,
      total,
      items: list.map(item => ({
        id: item.bidNtceNo,
        title: item.bidNtceNm,
        agency: item.dminsttNm,
        amount: item.asignBdgtAmt,
        deadline: item.bidClseDt,
        status: getStatus(item.bidClseDt),
      })),
    });
  } catch (err) {
    console.log('에러:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

function getStatus(dt) {
  if (!dt) return '확인필요';
  const diff = (new Date(dt) - Date.now()) / 36e5;
  if (diff < 0) return '마감';
  if (diff < 24) return '마감임박';
  if (diff < 72) return 'D-3';
  return '진행중';
}

app.listen(PORT, () => console.log(`서버 실행중 :${PORT}`));
