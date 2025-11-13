/**
 * API: 获取K线数据
 * GET /api/klines?symbol=BTCUSDT&interval=1h&startTime=xxx&endTime=xxx
 */

interface Env {
  DB: D1Database;
}

export async function onRequestGet(context: { request: Request; env: Env }) {
  const { request, env } = context;
  const url = new URL(request.url);

  const symbol = url.searchParams.get('symbol');
  const interval = url.searchParams.get('interval');
  const startTime = url.searchParams.get('startTime');
  const endTime = url.searchParams.get('endTime');

  if (!symbol || !interval || !startTime || !endTime) {
    return new Response(JSON.stringify({ error: '缺少必要参数' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // 从数据库查询K线数据
    const { results } = await env.DB.prepare(
      `SELECT * FROM klines
       WHERE symbol = ? AND interval = ?
       AND open_time >= ? AND open_time <= ?
       ORDER BY open_time ASC`
    )
    .bind(symbol, interval, parseInt(startTime), parseInt(endTime))
    .all();

    // 转换为币安API格式
    const data = results.map((row: any) => [
      row.open_time,
      row.open.toString(),
      row.high.toString(),
      row.low.toString(),
      row.close.toString(),
      row.volume.toString()
    ]);

    return new Response(JSON.stringify(data), {
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
