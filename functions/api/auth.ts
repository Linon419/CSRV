/**
 * API: 身份认证
 * POST /api/auth - 管理员登录
 */

interface Env {
  ADMIN_PASSWORD?: string;
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

// POST - 管理员登录
export async function onRequestPost(context: { request: Request; env: Env }) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { password } = body;

    if (!password) {
      return new Response(JSON.stringify({
        success: false,
        error: '请输入密码'
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }

    // 从环境变量获取管理员密码，默认为 'admin123'
    const adminPassword = env.ADMIN_PASSWORD || 'admin123';

    if (password === adminPassword) {
      // 生成简单的token（时间戳+随机数）
      const token = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      return new Response(JSON.stringify({
        success: true,
        token: token,
        message: '登录成功'
      }), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    } else {
      return new Response(JSON.stringify({
        success: false,
        error: '密码错误'
      }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
  } catch (error: any) {
    console.error('Auth error:', error);
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
