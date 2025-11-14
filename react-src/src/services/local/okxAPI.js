/**
 * OKX API服务 (本地版本 - 合约市场)
 */

const OKX_API = 'https://www.okx.com/api/v5';

/**
 * 从OKX合约API获取K线数据
 * @param {string} symbol - 币安格式的交易对 (如 BTCUSDT)
 * @param {string} interval - 时间周期
 * @param {number} startTime - 开始时间戳（毫秒）
 * @param {number} endTime - 结束时间戳（毫秒）
 * @param {number} limit - 限制数量
 */
export async function fetchOKXKlines(symbol, interval, startTime, endTime, limit = 300) {
  // 转换币安格式到OKX格式: BTCUSDT -> BTC-USDT-SWAP
  const okxSymbol = convertToOKXSymbol(symbol);

  // 转换时间周期格式
  const okxInterval = convertToOKXInterval(interval);

  // OKX API 使用秒级时间戳，并且使用 after/before 参数
  const after = Math.floor(startTime / 1000).toString();
  const before = Math.floor(endTime / 1000).toString();

  const url = `${OKX_API}/market/candles?instId=${okxSymbol}&bar=${okxInterval}&after=${after}&before=${before}&limit=${limit}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`OKX API请求失败: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();

    if (result.code !== '0') {
      throw new Error(`OKX API错误: ${result.msg}`);
    }

    // 转换OKX数据格式到币安格式
    return convertOKXToBinanceFormat(result.data);
  } catch (error) {
    console.error('OKX API调用失败:', error);
    throw error;
  }
}

/**
 * 将币安格式的交易对转换为OKX格式
 * BTCUSDT -> BTC-USDT-SWAP (永续合约)
 */
function convertToOKXSymbol(binanceSymbol) {
  // 移除USDT后缀，添加连字符格式
  if (binanceSymbol.endsWith('USDT')) {
    const base = binanceSymbol.slice(0, -4); // 去掉USDT
    return `${base}-USDT-SWAP`; // 永续合约
  }
  return binanceSymbol;
}

/**
 * 将币安时间周期转换为OKX格式
 */
function convertToOKXInterval(binanceInterval) {
  const intervalMap = {
    '1m': '1m',
    '3m': '3m',
    '5m': '5m',
    '15m': '15m',
    '30m': '30m',
    '1h': '1H',   // 注意大小写
    '2h': '2H',
    '4h': '4H',
    '6h': '6H',
    '12h': '12H',
    '1d': '1D',
    '1w': '1W'
  };

  return intervalMap[binanceInterval] || binanceInterval;
}

/**
 * 将OKX返回的数据格式转换为币安格式
 * OKX格式: [timestamp, open, high, low, close, volume, volumeCcy, volumeCcyQuote, confirm]
 * 币安格式: [openTime, open, high, low, close, volume, closeTime, quoteVolume, trades, takerBuyBase, takerBuyQuote, ignore]
 */
function convertOKXToBinanceFormat(okxData) {
  if (!Array.isArray(okxData)) {
    return [];
  }

  return okxData.map(candle => {
    const [timestamp, open, high, low, close, volume, volumeCcy] = candle;
    const openTime = parseInt(timestamp);

    // 币安格式需要12个字段
    return [
      openTime,           // 0: 开盘时间
      open,               // 1: 开盘价
      high,               // 2: 最高价
      low,                // 3: 最低价
      close,              // 4: 收盘价
      volume,             // 5: 成交量
      openTime + getIntervalMs(convertToOKXInterval), // 6: 收盘时间（估算）
      volumeCcy || '0',   // 7: 成交额
      0,                  // 8: 成交笔数（OKX不提供）
      '0',                // 9: 主动买入成交量
      '0',                // 10: 主动买入成交额
      '0'                 // 11: 忽略
    ];
  }).reverse(); // OKX返回的数据是从新到旧，需要反转
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
    '1H': 3600000,
    '2h': 7200000,
    '2H': 7200000,
    '4h': 14400000,
    '4H': 14400000,
    '6h': 21600000,
    '6H': 21600000,
    '12h': 43200000,
    '12H': 43200000,
    '1d': 86400000,
    '1D': 86400000,
    '1w': 604800000,
    '1W': 604800000
  };
  return map[interval] || 3600000;
}

/**
 * 批量分批获取K线数据
 */
export async function fetchOKXKlinesBatch(symbol, interval, startTime, endTime, batchSize = 300) {
  const intervalMs = getIntervalMs(interval);
  const totalCandles = Math.ceil((endTime - startTime) / intervalMs);

  // OKX限制每次最多300根K线
  const batches = Math.ceil(totalCandles / batchSize);
  const promises = [];

  for (let i = 0; i < batches; i++) {
    const batchStart = startTime + (i * batchSize * intervalMs);
    const batchEnd = Math.min(startTime + ((i + 1) * batchSize * intervalMs), endTime);

    promises.push(
      fetchOKXKlines(symbol, interval, batchStart, batchEnd, batchSize)
    );
  }

  const results = await Promise.all(promises);
  return results.flat();
}
