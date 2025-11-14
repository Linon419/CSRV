/**
 * API: 币安API代理
 * GET /api/binance-proxy?symbol=BTCUSDT&interval=1h&startTime=xxx&endTime=xxx&limit=1000
 * 用于代理请求币安API，避免CORS问题
 */

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// 处理 OPTIONS 预检请求
export async function onRequestOptions() {
  return new Response(null, {
    headers: corsHeaders
  });
}

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
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }

  try {
    // 请求币安API
    const binanceUrl = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${limit}`;

    const response = await fetch(binanceUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Binance API error:', response.status, errorText);
      throw new Error(`Binance API error: ${response.status}`);
    }

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',  // 缓存1分钟
        ...corsHeaders
      }
    });
  } catch (error: any) {
    console.error('Binance proxy error:', error);
    return new Response(JSON.stringify({
      error: error.message || 'Unknown error',
      details: error.toString()
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
}
