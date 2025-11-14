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
 * 直接请求币安合约API（币安支持CORS，无需代理）
 * @param {string} symbol - 交易对
 * @param {string} interval - 时间间隔
 * @param {number} startTime - 开始时间
 * @param {number} endTime - 结束时间
 * @param {number} limit - 限制数量
 * @param {string} marketType - 市场类型（固定为 'futures' 合约）
 */
export async function fetchBinanceKlines(symbol, interval, startTime, endTime, limit = 1000, marketType = 'futures') {
  // 固定使用合约API
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${limit}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Binance API错误:', response.status, errorText);
      throw new Error(`币安合约API请求失败: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    // CORS错误通常意味着交易对不存在或参数错误
    if (error.message.includes('Failed to fetch') || error.message.includes('CORS')) {
      throw new Error(`请求失败，请检查：\n1. 交易对是否在合约市场存在（如: BTCUSDT, ETHUSDT, PUFFERUSDT）\n2. 网络连接是否正常\n\n交易对: ${symbol}`);
    }
    throw error;
  }
}

/**
 * 清空K线缓存（服务器版本暂不支持）
 */
export async function clearKlineCache() {
  alert('服务器版本暂不支持清空缓存功能');
  return Promise.resolve();
}
