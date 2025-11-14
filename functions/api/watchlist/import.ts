/**
 * API: 批量导入观察列表
 * POST /api/watchlist/import
 */

interface Env {
  DB: D1Database;
}

interface WatchlistItem {
  symbol: string;
  time: string;
  interval: string;
  price: number;
  zoneType?: string;
  zone_type?: string;
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// 处理 OPTIONS 预检请求
export async function onRequestOptions() {
  return new Response(null, {
    headers: corsHeaders
  });
}

// POST - 批量导入
export async function onRequestPost(context: { request: Request; env: Env }) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const items: WatchlistItem[] = body.items || [];

    if (!Array.isArray(items) || items.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: '无效的数据格式'
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }

    const now = Date.now();
    let imported = 0;
    let updated = 0;
    let failed = 0;

    // 批量处理每条记录
    for (const item of items) {
      try {
        // 兼容旧格式的zoneType字段
        const zoneType = item.zone_type || item.zoneType || 'bottom';

        // 检查是否存在
        const { results: existing } = await env.DB.prepare(
          `SELECT id FROM search_history WHERE symbol = ? AND time = ?`
        )
        .bind(item.symbol, item.time)
        .all();

        if (existing && existing.length > 0) {
          // 更新
          await env.DB.prepare(
            `UPDATE search_history
             SET interval = ?, price = ?, zone_type = ?, updated_at = ?
             WHERE id = ?`
          )
          .bind(item.interval, item.price, zoneType, now, (existing[0] as any).id)
          .run();
          updated++;
        } else {
          // 插入
          await env.DB.prepare(
            `INSERT INTO search_history (symbol, time, interval, price, zone_type, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(item.symbol, item.time, item.interval, item.price, zoneType, now, now)
          .run();
          imported++;
        }
      } catch (error) {
        console.error('Import item failed:', error);
        failed++;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      imported,
      updated,
      failed,
      total: items.length
    }), {
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  } catch (error: any) {
    console.error('Import watchlist error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Unknown error'
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
}
