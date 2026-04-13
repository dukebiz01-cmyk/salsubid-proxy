const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());

const SERVICE_KEY = process.env.G2B_API_KEY;
console.log('G2B KEY:', SERVICE_KEY ? '있음' : '없음');

const G2B_URL = 'http://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoServc';

app.get('/api/bids', async function(req, res) {
  var pageNo    = req.query.pageNo    || 1;
  var numOfRows = req.query.numOfRows || 100;

  var now = new Date();
  var pad = function(n) { return String(n).padStart(2, '0'); };
  var fmt = function(d) {
    return d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()) + '0000';
  };
  var start = fmt(new Date(now.getTime() - 7 * 24*3600*1000));
  var end   = fmt(new Date(now.getTime() + 14 * 24*3600*1000));

  try {
    var response = await axios.get(G2B_URL, {
      params: {
        ServiceKey:  SERVICE_KEY,
        numOfRows:   numOfRows,
        pageNo:      pageNo,
        type:        'json',
        inqryDiv:    '1',
        inqryBgnDt:  start,
        inqryEndDt:  end,
      },
      timeout: 15000
    });

    var body = response.data && response.data.response && response.data.response.body;
    var raw  = (body && body.items) || [];
    var list = Array.isArray(raw) ? raw : (raw ? [raw] : []);

    var items = list.map(function(i) {
      return {
        id:       i.bidNtceNo   || '',
        title:    i.bidNtceNm   || '',
        agency:   i.ntceInsttNm || '',
        amount:   Number(i.asignBdgtAmt || i.presmptPrce || 0),
        deadline: i.bidClseDt   || '',
        bidType:  i.ntceKindNm  || '',
        region:   i.rgnNm       || '',
      };
    });

    res.json({ ok: true, total: body ? body.totalCount : 0, items: items });

  } catch (err) {
    var detail = err.response ? JSON.stringify(err.response.data) : err.message;
    console.error('에러:', detail);
    res.status(500).json({ ok: false, message: detail });
  }
});

app.get('/', function(req, res) {
  res.json({ status: 'BidGear proxy running', key: SERVICE_KEY ? 'loaded' : 'missing' });
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('서버 실행중 :' + PORT);
});
