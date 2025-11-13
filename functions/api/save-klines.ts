/**
 * API: 保存K线数据到数据库
 * POST /api/save-klines
 * Body: { symbol, interval, klines: [[timestamp, open, high, low, close, volume], ...] }
 */

interface Env {
  DB: D1Database;
}

export async function onRequestPost(context: { request: Request; env: Env }) {
  const { request, env } = context;

  try {
    const body = await request.json() as {
      symbol: string;
      interval: string;
      klines: any[];
    };

    const { symbol, interval, klines } = body;

    if (!symbol || !interval || !klines || !Array.isArray(klines)) {
      return new Response(JSON.stringify({ error: '参数格式错误' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 批量插入数据（使用事务）
    const statements = klines.map(k => {
      const id = `${symbol}_${interval}_${k[0]}`;
      return env.DB.prepare(
        `INSERT OR REPLACE INTO klines
         (id, symbol, interval, open_time, open, high, low, close, volume)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        symbol,
        interval,
        k[0],  // timestamp
        parseFloat(k[1]),  // open
        parseFloat(k[2]),  // high
        parseFloat(k[3]),  // low
        parseFloat(k[4]),  // close
        parseFloat(k[5])   // volume
      );
    });

    // 执行批量操作
    await env.DB.batch(statements);

    return new Response(JSON.stringify({
      success: true,
      count: klines.length
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 处理 CORS 预检请求
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
