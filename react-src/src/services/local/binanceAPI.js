/**
 * 币安API服务 (本地版本直接调用)
 */

const BINANCE_SPOT_API = 'https://api.binance.com/api/v3';
const BINANCE_FUTURES_API = 'https://fapi.binance.com/fapi/v1';

/**
 * 从币安API获取K线数据
 * @param {string} marketType - 市场类型 'spot'(现货) 或 'futures'(合约)
 */
export async function fetchBinanceKlines(symbol, interval, startTime, endTime, limit = 1000, marketType = 'spot') {
  const baseUrl = marketType === 'futures' ? BINANCE_FUTURES_API : BINANCE_SPOT_API;
  const url = `${baseUrl}/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${limit}`;

  const response = await fetch(url);

  if (!response.ok) {
    const marketName = marketType === 'futures' ? '合约' : '现货';
    throw new Error(`币安${marketName}API请求失败: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data;
}

/**
 * 批量分批获取K线数据
 */
export async function fetchBinanceKlinesBatch(symbol, interval, startTime, endTime, batchSize = 1000) {
  const promises = [];
  let currentStart = startTime;

  while (currentStart < endTime) {
    promises.push(
      fetchBinanceKlines(symbol, interval, currentStart, endTime, batchSize)
    );
    currentStart += batchSize * getIntervalMs(interval);
  }

  const results = await Promise.all(promises);
  return results.flat();
}

/**
 * 获取时间周期对应的毫秒数
 */
function getIntervalMs(interval) {
  const map = {
    '1m': 60000,
    '3m': 180000,
    '5m': 300000,
    '15m': 900000,
    '30m': 1800000,
    '1h': 3600000,
    '4h': 14400000,
    '1d': 86400000
  };
  return map[interval] || 3600000;
}
