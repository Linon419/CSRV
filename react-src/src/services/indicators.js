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
 * MACD (Moving Average Convergence Divergence)
 * @param {Array} data - K线数据
 * @param {Number} fastPeriod - 快线周期，默认12
 * @param {Number} slowPeriod - 慢线周期，默认26
 * @param {Number} signalPeriod - 信号线周期，默认9
 * @returns {Object} {macd: [], signal: [], histogram: []}
 */
export function calculateMACD(data, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (data.length < slowPeriod) {
    return { macd: [], signal: [], histogram: [] };
  }

  // 计算快线EMA和慢线EMA
  const fastEMA = exponentialMovingAverage(data, fastPeriod);
  const slowEMA = exponentialMovingAverage(data, slowPeriod);

  // 计算MACD线 (快线 - 慢线)
  const macdLine = [];
  const startIndex = slowPeriod - 1;

  for (let i = 0; i < slowEMA.length; i++) {
    const fastValue = fastEMA.find(e => e.time === slowEMA[i].time);
    if (fastValue) {
      macdLine.push({
        time: slowEMA[i].time,
        value: fastValue.value - slowEMA[i].value
      });
    }
  }

  // 计算Signal线 (MACD的EMA)
  if (macdLine.length < signalPeriod) {
    return { macd: macdLine, signal: [], histogram: [] };
  }

  const k = 2 / (signalPeriod + 1);
  let signalEMA = macdLine.slice(0, signalPeriod).reduce((sum, d) => sum + d.value, 0) / signalPeriod;

  const signalLine = [{ time: macdLine[signalPeriod - 1].time, value: signalEMA }];
  const histogram = [{ time: macdLine[signalPeriod - 1].time, value: macdLine[signalPeriod - 1].value - signalEMA }];

  for (let i = signalPeriod; i < macdLine.length; i++) {
    signalEMA = macdLine[i].value * k + signalEMA * (1 - k);
    signalLine.push({ time: macdLine[i].time, value: signalEMA });
    histogram.push({
      time: macdLine[i].time,
      value: macdLine[i].value - signalEMA,
      color: (macdLine[i].value - signalEMA) >= 0 ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)'
    });
  }

  return {
    macd: macdLine,
    signal: signalLine,
    histogram: histogram
  };
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
