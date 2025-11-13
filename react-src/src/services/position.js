/**
 * TradingView风格的Position管理模块
 */

/**
 * 创建Position状态
 */
export function createPositionState() {
  return {
    currentPosition: null, // { type: 'long'|'short', entries: [], avgPrice, quantity, stopLoss, takeProfit }
    closedTrades: [], // 已平仓的交易记录
    positionLine: null, // 持仓价格线引用
    stopLossLine: null, // 止损线引用
    takeProfitLine: null, // 止盈线引用
  };
}

/**
 * 开仓或加仓
 */
export function openPosition(state, type, price, time, quantity = 1) {
  const newState = { ...state };

  if (!newState.currentPosition) {
    // 新开仓
    newState.currentPosition = {
      type,
      entries: [{ price, time, quantity }],
      avgPrice: price,
      quantity,
      stopLoss: null,
      takeProfit: null,
      openTime: time
    };
  } else if (newState.currentPosition.type === type) {
    // 加仓（同方向）
    const pos = newState.currentPosition;
    const totalValue = pos.avgPrice * pos.quantity + price * quantity;
    const totalQuantity = pos.quantity + quantity;

    pos.entries.push({ price, time, quantity });
    pos.avgPrice = totalValue / totalQuantity;
    pos.quantity = totalQuantity;
  } else {
    // 反向开仓，先平掉原有仓位
    throw new Error('请先平掉当前仓位再开反向仓位');
  }

  return newState;
}

/**
 * 减仓
 */
export function reducePosition(state, price, time, quantity) {
  if (!state.currentPosition) {
    throw new Error('当前无持仓');
  }

  const newState = { ...state };
  const pos = newState.currentPosition;

  if (quantity >= pos.quantity) {
    // 全部平仓
    return closePosition(state, price, time);
  }

  // 部分平仓
  const closeValue = quantity * price;
  const costValue = quantity * pos.avgPrice;
  const pnl = pos.type === 'long'
    ? closeValue - costValue
    : costValue - closeValue;

  // 记录部分平仓
  newState.closedTrades.push({
    type: pos.type,
    entryPrice: pos.avgPrice,
    closePrice: price,
    quantity,
    pnl,
    openTime: pos.openTime,
    closeTime: time,
    partial: true
  });

  // 更新持仓
  pos.quantity -= quantity;

  return newState;
}

/**
 * 平仓
 */
export function closePosition(state, price, time) {
  if (!state.currentPosition) {
    throw new Error('当前无持仓');
  }

  const newState = { ...state };
  const pos = newState.currentPosition;

  const closeValue = pos.quantity * price;
  const costValue = pos.quantity * pos.avgPrice;
  const pnl = pos.type === 'long'
    ? closeValue - costValue
    : costValue - closeValue;

  // 记录平仓交易
  newState.closedTrades.push({
    type: pos.type,
    entryPrice: pos.avgPrice,
    closePrice: price,
    quantity: pos.quantity,
    pnl,
    openTime: pos.openTime,
    closeTime: time,
    partial: false,
    entries: pos.entries
  });

  // 清空当前持仓
  newState.currentPosition = null;

  return newState;
}

/**
 * 设置止损
 */
export function setStopLoss(state, stopLossPrice) {
  if (!state.currentPosition) {
    throw new Error('当前无持仓');
  }

  const newState = { ...state };
  newState.currentPosition.stopLoss = stopLossPrice;
  return newState;
}

/**
 * 设置止盈
 */
export function setTakeProfit(state, takeProfitPrice) {
  if (!state.currentPosition) {
    throw new Error('当前无持仓');
  }

  const newState = { ...state };
  newState.currentPosition.takeProfit = takeProfitPrice;
  return newState;
}

/**
 * 计算未实现盈亏
 */
export function calculateUnrealizedPnL(position, currentPrice) {
  if (!position) return { pnl: 0, pnlPercent: 0 };

  const currentValue = position.quantity * currentPrice;
  const costValue = position.quantity * position.avgPrice;
  const pnl = position.type === 'long'
    ? currentValue - costValue
    : costValue - currentValue;
  const pnlPercent = (pnl / costValue) * 100;

  return { pnl, pnlPercent };
}

/**
 * 计算总盈亏统计
 */
export function calculateTotalStats(closedTrades) {
  const totalTrades = closedTrades.length;
  if (totalTrades === 0) {
    return {
      totalPnL: 0,
      winRate: 0,
      winTrades: 0,
      lossTrades: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0
    };
  }

  const totalPnL = closedTrades.reduce((sum, trade) => sum + trade.pnl, 0);
  const winTrades = closedTrades.filter(t => t.pnl > 0);
  const lossTrades = closedTrades.filter(t => t.pnl < 0);

  const totalWin = winTrades.reduce((sum, t) => sum + t.pnl, 0);
  const totalLoss = Math.abs(lossTrades.reduce((sum, t) => sum + t.pnl, 0));

  return {
    totalPnL,
    winRate: (winTrades.length / totalTrades * 100).toFixed(2),
    winTrades: winTrades.length,
    lossTrades: lossTrades.length,
    avgWin: winTrades.length > 0 ? (totalWin / winTrades.length).toFixed(2) : 0,
    avgLoss: lossTrades.length > 0 ? (totalLoss / lossTrades.length).toFixed(2) : 0,
    profitFactor: totalLoss > 0 ? (totalWin / totalLoss).toFixed(2) : 0
  };
}

/**
 * 创建持仓价格线配置
 */
export function createPositionLineConfig(position) {
  return {
    price: position.avgPrice,
    color: position.type === 'long' ? '#26a69a' : '#ef5350',
    lineWidth: 2,
    lineStyle: 0, // Solid
    axisLabelVisible: true,
    title: position.type === 'long' ? 'Long Position' : 'Short Position'
  };
}

/**
 * 创建止损线配置
 */
export function createStopLossLineConfig(stopLoss) {
  return {
    price: stopLoss,
    color: '#f23645',
    lineWidth: 1,
    lineStyle: 2, // Dashed
    axisLabelVisible: true,
    title: 'Stop Loss'
  };
}

/**
 * 创建止盈线配置
 */
export function createTakeProfitLineConfig(takeProfit) {
  return {
    price: takeProfit,
    color: '#089981',
    lineWidth: 1,
    lineStyle: 2, // Dashed
    axisLabelVisible: true,
    title: 'Take Profit'
  };
}

/**
 * 导出交易历史
 */
export function exportTradingHistory(closedTrades) {
  return {
    trades: closedTrades,
    stats: calculateTotalStats(closedTrades),
    exportTime: new Date().toISOString()
  };
}
