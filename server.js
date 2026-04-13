const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());

const SERVICE_KEY = process.env.G2B_API_KEY;

console.log('G2B KEY:', SERVICE_KEY ? '있음' : '없음');

const G2B_URL = 'http://apis.data.go.kr/1230000/BidPublicInfoService04/getBidPblancListInfoServc';

app.get('/api/bids', async (req, res) => {
  const keyword  = req.query.keyword  || '살수차';
  const pageNo   = req.query.pageNo   || 1;
  const numOfRows = req.query.numOfRows || 20;

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}0000`;
  const start = fmt(new Date(now.getTime() - 7  * 24*3600*1000));
  const end   = fmt(new Date(now.getTime() + 30 * 24*3600*1000));

  try {
    const response = await axios.get(G2B_URL, {
      params: {
        serviceKey:  SERVICE_KEY,
        numOfRows:   numOfRows,
        pageNo:      pageNo,
        type:        'json',
        inqryBgnDt:  start,
        inqryEndDt:  end,
        bidNtceNm:   keyword,
      },
      timeout: 15000
    });

    const body = response.data?.response?.body;
    const raw  = body?.items || [];
    const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);

    const items = list.map(i => ({
      id:       i.bidNtceNo   || '',
      title:    i.bidNtceNm   || '',
      agency:   i.ntceInsttNm || '',
      amount:   Number(i.asignBdgtAmt || i.presmptPrce || 0),
      deadline: i.bidClseDt   || '',
      bidType:  i.ntceKindNm  || '',
      region:   i.rgnNm       || '',
    }));

    res.json({ ok: true, total: body?.totalCount || 0, items });

  } catch (err) {
    const detail = err.response ? JSON.stringify(err.response.data) : err.message;
    console.error('에러 상세:', detail);
    res.status(500).json({ ok: false, message: detail });
  }
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'BidGear proxy running', key: SERVICE_KEY ? 'loaded' : 'missing' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`서버 실행중 :${PORT}`));
