/**
 * 多交易所数据服务 - 智能切换币安和OKX
 * 优先使用币安，币安失败时自动切换到OKX
 */

import { fetchBinanceKlines, fetchBinanceKlinesBatch } from './binanceAPI.js';
import { fetchOKXKlines, fetchOKXKlinesBatch } from './okxAPI.js';

/**
 * 智能获取K线数据 - 自动切换交易所
 * @param {string} symbol - 交易对符号
 * @param {string} interval - 时间周期
 * @param {number} startTime - 开始时间
 * @param {number} endTime - 结束时间
 * @param {number} limit - 限制数量
 * @param {string} marketType - 市场类型 (默认futures)
 * @returns {Promise<{data: Array, source: string}>} 返回数据和数据源
 */
export async function fetchKlinesWithFallback(symbol, interval, startTime, endTime, limit = 1000, marketType = 'futures') {
  console.log(`尝试获取 ${symbol} 的K线数据...`);

  // 第一步：尝试币安
  try {
    console.log(`[币安] 请求 ${symbol} 数据...`);
    const binanceData = await fetchBinanceKlines(symbol, interval, startTime, endTime, limit, marketType);

    if (binanceData && binanceData.length > 0) {
      console.log(`[币安] 成功获取 ${binanceData.length} 根K线`);
      return {
        data: binanceData,
        source: 'binance'
      };
    }
  } catch (error) {
    console.warn(`[币安] 获取失败:`, error.message);

    // 检查是否是404错误（币种不存在）
    if (error.message.includes('400') || error.message.includes('404')) {
      console.log(`[币安] 币种 ${symbol} 不存在，切换到OKX...`);
    }
  }

  // 第二步：切换到OKX
  try {
    console.log(`[OKX] 请求 ${symbol} 数据...`);
    const okxData = await fetchOKXKlines(symbol, interval, startTime, endTime, Math.min(limit, 300));

    if (okxData && okxData.length > 0) {
      console.log(`[OKX] 成功获取 ${okxData.length} 根K线`);
      return {
        data: okxData,
        source: 'okx'
      };
    }
  } catch (error) {
    console.error(`[OKX] 获取失败:`, error.message);
  }

  // 两个交易所都失败
  throw new Error(`无法从币安或OKX获取 ${symbol} 的数据`);
}

/**
 * 批量获取K线数据（带自动切换）
 */
export async function fetchKlinesBatchWithFallback(symbol, interval, startTime, endTime, batchSize = 1000) {
  console.log(`批量获取 ${symbol} 的K线数据...`);

  // 第一步：尝试币安
  try {
    console.log(`[币安] 批量请求 ${symbol} 数据...`);
    const binanceData = await fetchBinanceKlinesBatch(symbol, interval, startTime, endTime, batchSize);

    if (binanceData && binanceData.length > 0) {
      console.log(`[币安] 成功获取 ${binanceData.length} 根K线`);
      return {
        data: binanceData,
        source: 'binance'
      };
    }
  } catch (error) {
    console.warn(`[币安] 批量获取失败:`, error.message);

    // 检查是否是币种不存在
    if (error.message.includes('400') || error.message.includes('404')) {
      console.log(`[币安] 币种 ${symbol} 不存在，切换到OKX...`);
    }
  }

  // 第二步：切换到OKX
  try {
    console.log(`[OKX] 批量请求 ${symbol} 数据...`);
    const okxData = await fetchOKXKlinesBatch(symbol, interval, startTime, endTime, 300);

    if (okxData && okxData.length > 0) {
      console.log(`[OKX] 成功获取 ${okxData.length} 根K线`);
      return {
        data: okxData,
        source: 'okx'
      };
    }
  } catch (error) {
    console.error(`[OKX] 批量获取失败:`, error.message);
  }

  // 两个交易所都失败
  throw new Error(`无法从币安或OKX批量获取 ${symbol} 的数据`);
}

/**
 * 仅从币安获取数据（保持向后兼容）
 */
export async function fetchBinanceOnly(symbol, interval, startTime, endTime, limit = 1000, marketType = 'futures') {
  const binanceData = await fetchBinanceKlines(symbol, interval, startTime, endTime, limit, marketType);
  return {
    data: binanceData,
    source: 'binance'
  };
}

/**
 * 仅从OKX获取数据
 */
export async function fetchOKXOnly(symbol, interval, startTime, endTime, limit = 300) {
  const okxData = await fetchOKXKlines(symbol, interval, startTime, endTime, limit);
  return {
    data: okxData,
    source: 'okx'
  };
}
