/**
 * 回测逻辑模块
 */

/**
 * 创建回测状态
 */
export function createBacktestState(initialCapital = 10000) {
  return {
    initialCapital,
    currentCapital: initialCapital,
    positionSize: 100, // 百分比
    feeRate: 0.1, // 百分比
    currentPosition: null, // {type: 'long'|'short', entryPrice, entryTime, quantity}
    trades: [], // 交易历史
    tradeMarkers: [] // 图表标记
  };
}

/**
 * 计算回测统计数据
 */
export function calculateBacktestStats(state) {
  const { initialCapital, currentCapital, trades } = state;
  const profit = currentCapital - initialCapital;
  const returnPct = (profit / initialCapital * 100).toFixed(2);

  // 只计算已完成的交易
  const completedTrades = trades.filter(t => t.closePrice);
  const totalTrades = completedTrades.length;

  // 计算胜率
  const winTrades = completedTrades.filter(t => t.pnl > 0).length;
  const winRate = totalTrades > 0 ? (winTrades / totalTrades * 100).toFixed(2) : '0.00';

  // 计算最大回撤
  let peak = initialCapital;
  let maxDrawdown = 0;
  let capital = initialCapital;

  completedTrades.forEach(t => {
    capital += t.pnl;
    if (capital > peak) peak = capital;
    const drawdown = (peak - capital) / peak * 100;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  });

  return {
    currentCapital: currentCapital.toFixed(2),
    profit: profit.toFixed(2),
    profitClass: profit > 0 ? 'profit' : (profit < 0 ? 'loss' : 'neutral'),
    returnPct,
    totalTrades,
    winRate,
    maxDrawdown: maxDrawdown.toFixed(2),
    hasPosition: !!state.currentPosition,
    positionType: state.currentPosition?.type
  };
}

/**
 * 开仓
 */
export function openPosition(state, type, price, time) {
  if (state.currentPosition) {
    throw new Error('已有持仓，请先平仓');
  }

  const positionValue = state.currentCapital * (state.positionSize / 100);
  const fee = positionValue * (state.feeRate / 100);
  const quantity = (positionValue - fee) / price;

  state.currentPosition = {
    type,
    entryPrice: price,
    entryTime: time,
    quantity
  };

  state.trades.push({
    type,
    entryPrice: price,
    entryTime: time,
    quantity,
    capitalAfter: state.currentCapital
  });

  return {
    ...state,
    message: `开${type === 'long' ? '多' : '空'}: 价格=${price.toFixed(4)}, 数量=${quantity.toFixed(6)}`
  };
}

/**
 * 平仓
 */
export function closePosition(state, price, time) {
  if (!state.currentPosition) {
    throw new Error('无持仓');
  }

  const pos = state.currentPosition;
  const exitValue = pos.quantity * price;
  const fee = exitValue * (state.feeRate / 100);
  const entryValue = pos.quantity * pos.entryPrice;
  const entryFee = entryValue * (state.feeRate / 100);

  let pnl;
  if (pos.type === 'long') {
    pnl = exitValue - entryValue - fee - entryFee;
  } else {
    pnl = entryValue - exitValue - fee - entryFee;
  }

  state.currentCapital += pnl;

  // 更新最后一笔交易记录
  const lastTrade = state.trades[state.trades.length - 1];
  lastTrade.closePrice = price;
  lastTrade.closeTime = time;
  lastTrade.pnl = pnl;
  lastTrade.capitalAfter = state.currentCapital;

  state.currentPosition = null;

  return {
    ...state,
    message: `平仓: 价格=${price.toFixed(4)}, 盈亏=${pnl.toFixed(2)} USDT`
  };
}

/**
 * 清除所有交易
 */
export function clearAllTrades(state) {
  return {
    ...state,
    currentCapital: state.initialCapital,
    currentPosition: null,
    trades: [],
    tradeMarkers: []
  };
}

/**
 * 更新回测参数
 */
export function updateBacktestParams(state, params) {
  const newState = { ...state, ...params };

  // 如果更新了初始资金，同时更新当前资金
  if (params.initialCapital !== undefined && !state.currentPosition && state.trades.length === 0) {
    newState.currentCapital = params.initialCapital;
  }

  return newState;
}

/**
 * 导出交易记录
 */
export function exportTrades(state) {
  return {
    initialCapital: state.initialCapital,
    finalCapital: state.currentCapital,
    profit: state.currentCapital - state.initialCapital,
    trades: state.trades,
    exportTime: new Date().toISOString()
  };
}

/**
 * 创建交易标记（用于图表）
 */
export function createTradeMarker(time, price, type, action = 'open') {
  if (action === 'open') {
    return {
      time: Math.floor(time / 1000),
      position: type === 'long' ? 'belowBar' : 'aboveBar',
      color: type === 'long' ? '#26a69a' : '#ef5350',
      shape: type === 'long' ? 'arrowUp' : 'arrowDown',
      text: type === 'long' ? 'L' : 'S',
      size: 2
    };
  } else {
    // close
    return {
      time: Math.floor(time / 1000),
      position: type === 'long' ? 'aboveBar' : 'belowBar',
      color: '#ff9800',
      shape: 'circle',
      text: 'C',
      size: 2
    };
  }
}
