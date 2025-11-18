/**
 * Cloudflare Workers API服务 (Cloudflare版本使用)
 */

import { fetchKlinesWithFallback } from '../local/multiExchangeAPI.js';

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
 * 智能获取K线数据（自动切换币安/OKX）
 * @param {string} symbol - 交易对
 * @param {string} interval - 时间间隔
 * @param {number} startTime - 开始时间
 * @param {number} endTime - 结束时间
 * @param {number} limit - 限制数量
 * @param {string} marketType - 市场类型（固定为 'futures' 合约）
 */
export async function fetchBinanceKlines(symbol, interval, startTime, endTime, limit = 1000, marketType = 'futures') {
  try {
    // 使用智能切换逻辑：币安失败时自动切换到OKX
    const result = await fetchKlinesWithFallback(symbol, interval, startTime, endTime, limit, marketType);

    // 在控制台显示数据源
    if (result.source === 'okx') {
      console.log(`✓ 已从OKX获取 ${symbol} 数据`);
    } else {
      console.log(`✓ 已从币安获取 ${symbol} 数据`);
    }

    return result.data;
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

/**
 * 获取观察列表
 */
export async function getWatchlist() {
  try {
    const response = await fetch(`${API_BASE}/watchlist`);

    if (!response.ok) {
      throw new Error(`获取观察列表失败: ${response.status}`);
    }

    const result = await response.json();
    if (result.success) {
      // 转换字段名：zone_type -> zoneType 以兼容前端
      return result.data.map(item => ({
        ...item,
        zoneType: item.zone_type || 'bottom'
      }));
    }
    return [];
  } catch (error) {
    console.error('获取观察列表失败:', error);
    return [];
  }
}

/**
 * 保存观察记录（自动判断新增或更新，需要管理员权限）
 * @param {object} item - 观察记录
 * @param {string} adminPassword - 管理员密码
 */
export async function saveWatchlistItem(item, adminPassword) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (adminPassword) {
      headers['Authorization'] = `Bearer ${adminPassword}`;
    }

    const response = await fetch(`${API_BASE}/watchlist`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        symbol: item.symbol,
        time: item.time,
        interval: item.interval,
        price: item.price,
        zone_type: item.zoneType || 'bottom'
      })
    });

    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || `保存失败: ${response.status}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('保存观察记录失败:', error);
    throw error;
  }
}

/**
 * 删除观察记录（需要管理员权限）
 * @param {number} id - 记录ID
 * @param {string} adminPassword - 管理员密码
 */
export async function deleteWatchlistItem(id, adminPassword) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (adminPassword) {
      headers['Authorization'] = `Bearer ${adminPassword}`;
    }

    const response = await fetch(`${API_BASE}/watchlist`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ id })
    });

    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || `删除失败: ${response.status}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('删除观察记录失败:', error);
    throw error;
  }
}

/**
 * 批量导入观察列表
 */
export async function importWatchlist(items) {
  try {
    const response = await fetch(`${API_BASE}/watchlist/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items })
    });

    if (!response.ok) {
      throw new Error(`导入失败: ${response.status}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('批量导入失败:', error);
    throw error;
  }
}
