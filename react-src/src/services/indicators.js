/**
 * 技术指标计算模块
 */

/**
 * 简单移动平均线 (SMA - Simple Moving Average)
 * @param {Array} data - K线数据 [{time, open, high, low, close, volume}]
 * @param {Number} period - 周期
 * @returns {Array} [{time, value}]
 */
export function movingAverage(data, period) {
  const result = [];
  let sum = 0;

  for (let i = 0; i < data.length; i++) {
    sum += data[i].close;
    if (i >= period) {
      sum -= data[i - period].close;
    }
    if (i >= period - 1) {
      result.push({
        time: data[i].time,
        value: sum / period
      });
    }
  }

  return result;
}

/**
 * 指数移动平均线 (EMA - Exponential Moving Average)
 * @param {Array} data - K线数据
 * @param {Number} period - 周期
 * @returns {Array} [{time, value}]
 */
export function exponentialMovingAverage(data, period) {
  if (data.length < period) return [];

  const result = [];
  const k = 2 / (period + 1);

  // 初始EMA = 前n个价格的平均值
  let ema = data.slice(0, period).reduce((sum, d) => sum + d.close, 0) / period;
  result.push({ time: data[period - 1].time, value: ema });

  // 计算后续EMA
  for (let i = period; i < data.length; i++) {
    ema = data[i].close * k + ema * (1 - k);
    result.push({ time: data[i].time, value: ema });
  }

  return result;
}

/**
 * 布林带 (Bollinger Bands)
 * @param {Array} data - K线数据
 * @param {Number} period - 周期
 * @param {Number} stdDevMultiplier - 标准差倍数
 * @returns {Object} {upper: [], middle: [], lower: []}
 */
export function bollingerBands(data, period, stdDevMultiplier = 2) {
  if (data.length < period) {
    return { upper: [], middle: [], lower: [] };
  }

  const upper = [];
  const middle = [];
  const lower = [];

  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1);

    // 计算平均值 (中轨)
    const avg = slice.reduce((sum, d) => sum + d.close, 0) / period;

    // 计算标准差
    const variance = slice.reduce((sum, d) => sum + Math.pow(d.close - avg, 2), 0) / period;
    const std = Math.sqrt(variance);

    const time = data[i].time;

    middle.push({ time, value: avg });
    upper.push({ time, value: avg + stdDevMultiplier * std });
    lower.push({ time, value: avg - stdDevMultiplier * std });
  }

  return { upper, middle, lower };
}

/**
 * 时间周期转换为毫秒
 */
export const intervalToMs = {
  '1m': 60000,
  '3m': 180000,
  '5m': 300000,
  '15m': 900000,
  '30m': 1800000,
  '1h': 3600000,
  '4h': 14400000,
  '1d': 86400000
};
