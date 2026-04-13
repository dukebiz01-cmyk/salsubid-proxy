const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());

const SERVICE_KEY = process.env.G2B_API_KEY;
const G2B_URL = 'https://apis.data.go.kr/1230000/BidPublicInfoService04/getBidPblancListInfoServc01';

app.get('/api/bids', async (req, res) => {
  const { keyword = '살수차', pageNo = 1, numOfRows = 20 } = req.query;

  // 오늘 기준 30일 범위
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}0000`;
  const end = fmt(new Date(now.getTime() + 30*24*3600*1000));
  const start = fmt(new Date(now.getTime() - 7*24*3600*1000));

  try {
    const { data } = await axios.get(G2B_URL, {
      params: {
        serviceKey: SERVICE_KEY,
        numOfRows,
        pageNo,
        type: 'json',
        bidNtceNm: keyword,
        inqryBgnDt: start,
        inqryEndDt: end,
      },
      timeout: 10000
    });

    const items = data?.response?.body?.items || [];
    const list = Array.isArray(items) ? items : [items];

    const result = list.map(i => ({
      id:       i.bidNtceNo || '',
      title:    i.bidNtceNm || '',
      agency:   i.ntceInsttNm || '',
      amount:   Number(i.asignBdgtAmt || i.presmptPrce || 0),
      deadline: i.bidClseDt || '',
      bidType:  i.ntceKindNm || '',
      region:   i.rgnNm || '',
    }));

    res.json({ ok: true, total: data?.response?.body?.totalCount || 0, items: result });

  } catch (err) {
    console.error(err.message);
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'BidGear proxy running' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log
