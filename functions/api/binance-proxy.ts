/**
 * API: 币安API代理
 * GET /api/binance-proxy?symbol=BTCUSDT&interval=1h&startTime=xxx&endTime=xxx&limit=1000
 * 用于代理请求币安API，避免CORS问题
 */

export async function onRequestGet(context: { request: Request }) {
  const { request } = context;
  const url = new URL(request.url);

  const symbol = url.searchParams.get('symbol');
  const interval = url.searchParams.get('interval');
  const startTime = url.searchParams.get('startTime');
  const endTime = url.searchParams.get('endTime');
  const limit = url.searchParams.get('limit') || '1000';

  if (!symbol || !interval || !startTime || !endTime) {
    return new Response(JSON.stringify({ error: '缺少必要参数' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // 请求币安API
    const binanceUrl = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${limit}`;

    const response = await fetch(binanceUrl);
    const data = await response.json();

    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60'  // 缓存1分钟
      }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
