/**
 * API: 观察列表管理
 * GET /api/watchlist - 获取所有观察列表
 * POST /api/watchlist - 保存/更新观察记录
 * DELETE /api/watchlist/:id - 删除观察记录
 * POST /api/watchlist/import - 批量导入
 */

interface Env {
  DB: D1Database;
}

interface WatchlistItem {
  id?: number;
  symbol: string;
  time: string;
  interval: string;
  price: number;
  zone_type: string;
  created_at?: number;
  updated_at?: number;
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// 处理 OPTIONS 预检请求
export async function onRequestOptions() {
  return new Response(null, {
    headers: corsHeaders
  });
}

// GET - 获取所有观察列表
export async function onRequestGet(context: { request: Request; env: Env }) {
  const { env } = context;

  try {
    const { results } = await env.DB.prepare(
      `SELECT * FROM search_history ORDER BY created_at DESC`
    ).all();

    return new Response(JSON.stringify({
      success: true,
      data: results
    }), {
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  } catch (error: any) {
    console.error('Get watchlist error:', error);
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

// POST - 保存/更新观察记录
export async function onRequestPost(context: { request: Request; env: Env }) {
  const { request, env } = context;
  const url = new URL(request.url);

  try {
    const body: WatchlistItem = await request.json();

    // 验证必要字段
    if (!body.symbol || !body.time || !body.interval || body.price === undefined) {
      return new Response(JSON.stringify({
        success: false,
        error: '缺少必要参数'
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }

    const zoneType = body.zone_type || 'bottom';
    const now = Date.now();

    // 检查是否存在相同的symbol+time
    const { results: existing } = await env.DB.prepare(
      `SELECT id FROM search_history WHERE symbol = ? AND time = ?`
    )
    .bind(body.symbol, body.time)
    .all();

    let result;
    if (existing && existing.length > 0) {
      // 更新现有记录
      const existingId = (existing[0] as any).id;
      result = await env.DB.prepare(
        `UPDATE search_history
         SET interval = ?, price = ?, zone_type = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(body.interval, body.price, zoneType, now, existingId)
      .run();

      return new Response(JSON.stringify({
        success: true,
        action: 'updated',
        id: existingId
      }), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    } else {
      // 插入新记录
      result = await env.DB.prepare(
        `INSERT INTO search_history (symbol, time, interval, price, zone_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(body.symbol, body.time, body.interval, body.price, zoneType, now, now)
      .run();

      return new Response(JSON.stringify({
        success: true,
        action: 'created',
        id: result.meta.last_row_id
      }), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
  } catch (error: any) {
    console.error('Save watchlist error:', error);
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

// DELETE - 删除观察记录
export async function onRequestDelete(context: { request: Request; env: Env }) {
  const { request, env } = context;
  const url = new URL(request.url);

  try {
    const body = await request.json();
    const id = body.id;

    if (!id) {
      return new Response(JSON.stringify({
        success: false,
        error: '缺少id参数'
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }

    await env.DB.prepare(
      `DELETE FROM search_history WHERE id = ?`
    )
    .bind(id)
    .run();

    return new Response(JSON.stringify({
      success: true,
      action: 'deleted',
      id: id
    }), {
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  } catch (error: any) {
    console.error('Delete watchlist error:', error);
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
