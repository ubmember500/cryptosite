# Chart Deployment Troubleshooting

Use this checklist when charts load locally but fail after deploy.

## 1) Quick smoke checks (production)

Run from project root:

```powershell
node -e "(async()=>{const base='https://YOUR-RENDER-DOMAIN/api';const q=(p)=>fetch(base+p).then(r=>r.json());const initial=await q('/market/binance/klines?symbol=XRPUSDT&exchangeType=futures&interval=15m&limit=500');const c1=Array.isArray(initial.klines)?initial.klines.length:0;const first=c1?Number(initial.klines[0].time):null;const tf=await q('/market/binance/klines?symbol=XRPUSDT&exchangeType=futures&interval=1h&limit=500');const c2=Array.isArray(tf.klines)?tf.klines.length:0;const before=Math.floor((first||0)*1000);const pg=await q('/market/binance/klines?symbol=XRPUSDT&exchangeType=futures&interval=15m&limit=500&before='+before);const arr=Array.isArray(pg.klines)?pg.klines:[];const older=arr.filter(k=>Number(k.time)<(first||0)).length;console.log(JSON.stringify({initialCount:c1,timeframeCount:c2,paginationCount:arr.length,olderCount:older,upstreamUnavailable:!!initial.upstreamUnavailable,warning:initial.warning||null},null,2));})().catch(e=>{console.error(e);process.exit(1);});"
```

Expected for healthy chart flow:
- initialCount > 0
- timeframeCount > 0
- paginationCount > 0 and olderCount > 0

## 2) Confirm fallback source

```powershell
node -e "(async()=>{const u='https://YOUR-RENDER-DOMAIN/api/binance-klines?symbol=XRPUSDT&interval=15m&limit=500';const r=await fetch(u);const j=await r.json();console.log(JSON.stringify({status:r.status,count:Array.isArray(j.klines)?j.klines.length:0,error:j.error||null,warning:j.warning||null},null,2));})();"
```

If you see HTTP 451 or location-restriction message, your hosting region cannot access Binance directly.

## 3) Environment checks

Frontend (Vercel):
- VITE_API_BASE_URL must point to Render API with /api suffix.
- VITE_SOCKET_URL must point to Render origin (without /api).

Backend (Render):
- FRONTEND_URL: single URL used for reset links.
- FRONTEND_URLS: comma-separated list of all frontend origins for API + Socket.IO CORS.

## 4) Common causes

- CORS mismatch: deployed frontend domain missing from FRONTEND_URLS.
- Wrong frontend API base: requests go to Vercel /api instead of Render /api.
- Upstream blocked by provider region (e.g., Binance 451).
- Upstream temporary deny/rate-limit causing backend to return upstreamUnavailable.

## 5) Mitigations

- Keep direct fallback logic enabled in marketStore for initial and history loads.
- Use exchange/API source reachable from deployment region.
- Add provider-level proxy in allowed region if exchange is geo-restricted.
- Monitor telemetry events:
  - fetchChartData.backendResponse
  - loadOlderChartData.requestStart
  - loadOlderChartData.failed
  - loadOlderChartData.directRecoveryResponse
