/**
 * Cloudflare Workers API服务 (Cloudflare版本使用)
 */

const API_BASE = '/api';

/**
 * 从服务器查询K线数据
 */
export async function getKlinesFromDB(symbol, interval, startTime, endTime) {
  try {
    const url = `${API_BASE}/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&startTime=${startTime}&endTime=${endTime}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`服务器请求失败: ${response.status}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('查询K线数据失败:', error);
    return [];
  }
}

/**
 * 保存K线数据到服务器
 */
export async function saveKlinesToDB(symbol, interval, klines) {
  if (!klines || klines.length === 0) return;

  try {
    const response = await fetch(`${API_BASE}/save-klines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, interval, klines })
    });

    if (!response.ok) {
      throw new Error(`保存失败: ${response.status}`);
    }

    const result = await response.json();
    console.log(`已保存 ${result.count} 条数据到服务器`);
    return result;
  } catch (error) {
    console.error('保存K线数据失败:', error);
    throw error;
  }
}

/**
 * 直接请求币安API（币安支持CORS，无需代理）
 */
export async function fetchBinanceKlines(symbol, interval, startTime, endTime, limit = 1000) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${limit}`;

  const response = await fetch(url);

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Binance API错误:', response.status, errorText);
    throw new Error(`币安API请求失败: ${response.status}`);
  }

  const data = await response.json();
  return data;
}

/**
 * 清空K线缓存（服务器版本暂不支持）
 */
export async function clearKlineCache() {
  alert('服务器版本暂不支持清空缓存功能');
  return Promise.resolve();
}
