import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createChart } from 'lightweight-charts';
import {
  movingAverage,
  exponentialMovingAverage,
  bollingerBands,
  intervalToMs
} from '../services/indicators';
import {
  createBacktestState,
  calculateBacktestStats,
  openPosition,
  closePosition,
  clearAllTrades,
  updateBacktestParams,
  exportTrades,
  createTradeMarker
} from '../services/backtest';
import '../styles/global.css';

/**
 * 主应用组件（通用版本，通过props注入数据服务）
 */
export default function App({ dataService, version = 'local' }) {
  // ========== 状态管理 ==========
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [time, setTime] = useState('');
  const [interval, setInterval] = useState('1m');
  const [price, setPrice] = useState('');
  const [zoneType, setZoneType] = useState('bottom');
  const [loading, setLoading] = useState(false);

  // 技术指标设置
  const [indicators, setIndicators] = useState({
    ma5: { show: true, period: 5 },
    ma10: { show: true, period: 10 },
    ma20: { show: true, period: 20 },
    ma60: { show: true, period: 60 },
    ema21: { show: false, period: 21 },
    ema55: { show: false, period: 55 },
    ema100: { show: false, period: 100 },
    ema200: { show: false, period: 200 },
    bb: { show: false, period: 20, stdDev: 2 }
  });

  // 面板显示状态
  const [showIndicators, setShowIndicators] = useState(false);
  const [showBacktest, setShowBacktest] = useState(false);

  // 回测状态
  const [backtestState, setBacktestState] = useState(() => createBacktestState(10000));
  const [selectedPoint, setSelectedPoint] = useState(null);

  // 历史记录
  const [history, setHistory] = useState([]);
  const [historyFilter, setHistoryFilter] = useState({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // 图表引用
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef({});
  const currentPriceLineRef = useRef(null);

  // ========== 初始化 ==========
  useEffect(() => {
    // 初始化数据库（仅本地版）
    if (version === 'local' && dataService.initDB) {
      dataService.initDB().then(() => {
        console.log('IndexedDB initialized');
      }).catch(err => {
        console.error('IndexedDB init failed:', err);
      });
    }

    // 初始化时间
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const timeStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    setTime(timeStr);

    // 加载历史记录
    loadHistory();

    // 初始化图表
    initChart();

    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
      }
    };
  }, []);

  // ========== 图表初始化 ==========
  const initChart = () => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: 'solid', color: '#ffffff' },
        textColor: '#000'
      },
      rightPriceScale: {
        scaleMargins: { top: 0.1, bottom: 0.25 }
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false
      },
      width: chartContainerRef.current.clientWidth,
      height: 600
    });

    // 创建K线系列
    const candleSeries = chart.addCandlestickSeries();

    // 创建成交量系列
    const volumeSeries = chart.addHistogramSeries({
      priceScaleId: '',
      scaleMargins: { top: 0.75, bottom: 0 },
      color: 'rgba(76,175,80,0.5)'
    });

    // 创建MA系列
    const ma5 = chart.addLineSeries({ color: 'orange', lineWidth: 1 });
    const ma10 = chart.addLineSeries({ color: 'gold', lineWidth: 1 });
    const ma20 = chart.addLineSeries({ color: 'blue', lineWidth: 1 });
    const ma60 = chart.addLineSeries({ color: 'purple', lineWidth: 1 });

    // 创建EMA系列
    const ema21 = chart.addLineSeries({ color: '#00bcd4', lineWidth: 1, visible: false });
    const ema55 = chart.addLineSeries({ color: '#ff9800', lineWidth: 1, visible: false });
    const ema100 = chart.addLineSeries({ color: '#e91e63', lineWidth: 1, visible: false });
    const ema200 = chart.addLineSeries({ color: '#9c27b0', lineWidth: 1, visible: false });

    // 创建布林带系列
    const bbUpper = chart.addLineSeries({ color: '#2196f3', lineWidth: 1, lineStyle: 2, visible: false });
    const bbMiddle = chart.addLineSeries({ color: '#2196f3', lineWidth: 1, visible: false });
    const bbLower = chart.addLineSeries({ color: '#2196f3', lineWidth: 1, lineStyle: 2, visible: false });

    // 图表点击事件
    chart.subscribeClick((param) => {
      if (!param.point || !param.time) return;
      const priceData = param.seriesPrices.get(candleSeries);
      if (!priceData) return;

      setSelectedPoint({
        time: param.time * 1000,
        price: typeof priceData === 'object' ? priceData.close : priceData
      });

      console.log(`Selected: ${new Date(param.time * 1000).toLocaleString()}, Price: ${priceData}`);
    });

    // 保存引用
    chartRef.current = chart;
    seriesRef.current = {
      candle: candleSeries,
      volume: volumeSeries,
      ma5, ma10, ma20, ma60,
      ema21, ema55, ema100, ema200,
      bbUpper, bbMiddle, bbLower
    };

    // 响应式调整
    const handleResize = () => {
      chart.applyOptions({
        width: chartContainerRef.current.clientWidth
      });
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  };

  // ========== 加载K线数据 ==========
  const loadKlineData = async () => {
    if (!symbol || !time || !price) {
      alert('请输入完整参数');
      return;
    }

    setLoading(true);

    try {
      const targetDate = new Date(time);
      const dayStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate()).getTime();
      const nextDayEnd = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() + 2).getTime() - 1;

      const ms = intervalToMs[interval] || 3600000;
      const totalCandles = Math.ceil((nextDayEnd - dayStart) / ms);

      // 从数据库获取缓存
      let cachedData = await dataService.getKlinesFromDB(symbol, interval, dayStart, nextDayEnd);
      console.log(`Cached: ${cachedData.length} records`);

      let data;
      if (cachedData.length < totalCandles * 0.9) {
        console.log('Fetching from API...');
        const batchSize = 1000;
        const batches = Math.ceil(totalCandles / batchSize);
        const promises = [];

        for (let i = 0; i < batches; i++) {
          const batchStart = dayStart + i * batchSize * ms;
          const batchEnd = Math.min(dayStart + (i + 1) * batchSize * ms, nextDayEnd);
          promises.push(dataService.fetchBinanceKlines(symbol, interval, batchStart, batchEnd, batchSize));
        }

        const results = await Promise.all(promises);
        const apiData = results.flat();

        if (!Array.isArray(apiData) || apiData.length === 0) {
          throw new Error('无数据');
        }

        // 保存到数据库
        await dataService.saveKlinesToDB(symbol, interval, apiData);

        data = apiData.map(d => ({
          time: d[0],
          open: +d[1],
          high: +d[2],
          low: +d[3],
          close: +d[4],
          volume: +d[5]
        }));
      } else {
        data = cachedData.map(d => ({
          time: d[0] || d.time,
          open: +d[1] || +d.open,
          high: +d[2] || +d.high,
          low: +d[3] || +d.low,
          close: +d[4] || +d.close,
          volume: +d[5] || +d.volume
        }));
      }

      data.sort((a, b) => a.time - b.time);
      renderChart(data);

    } catch (error) {
      console.error('Load failed:', error);
      alert('加载失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // ========== 渲染图表 ==========
  const renderChart = (data) => {
    const candles = data.map(d => ({
      time: Math.floor(d.time / 1000),
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close
    }));

    const volumes = candles.map(c => ({
      time: c.time,
      value: data.find(d => Math.floor(d.time / 1000) === c.time)?.volume || 0,
      color: c.close >= c.open ? 'rgba(76,175,80,0.5)' : 'rgba(255,82,82,0.5)'
    }));

    // 设置K线和成交量
    seriesRef.current.candle.setData(candles);
    seriesRef.current.volume.setData(volumes);

    // 设置技术指标
    updateIndicators(candles);

    // 添加价格线
    addPriceLine(parseFloat(price));

    // 定位到目标时间
    const targetTime = Math.floor(new Date(time).getTime() / 1000);
    let nearest = null;
    let minDiff = Infinity;
    for (const c of candles) {
      const diff = Math.abs(c.time - targetTime);
      if (diff < minDiff) {
        minDiff = diff;
        nearest = c;
      }
    }

    if (nearest) {
      seriesRef.current.candle.setMarkers([{
        time: nearest.time,
        position: 'belowBar',
        color: 'blue',
        shape: 'arrowUp',
        text: '发布时间',
        size: 3
      }]);

      const idx = candles.findIndex(c => c.time === nearest.time);
      const from = candles[Math.max(0, idx - 80)].time;
      const to = candles[Math.min(candles.length - 1, idx + 80)].time;
      chartRef.current.timeScale().setVisibleRange({ from, to });
    }
  };

  // ========== 更新技术指标 ==========
  const updateIndicators = (candles) => {
    const { ma5, ma10, ma20, ma60, ema21, ema55, ema100, ema200, bb } = indicators;

    // MA
    if (ma5.show) {
      seriesRef.current.ma5.setData(movingAverage(candles, ma5.period));
      seriesRef.current.ma5.applyOptions({ visible: true });
    } else {
      seriesRef.current.ma5.applyOptions({ visible: false });
    }

    if (ma10.show) {
      seriesRef.current.ma10.setData(movingAverage(candles, ma10.period));
      seriesRef.current.ma10.applyOptions({ visible: true });
    } else {
      seriesRef.current.ma10.applyOptions({ visible: false });
    }

    if (ma20.show) {
      seriesRef.current.ma20.setData(movingAverage(candles, ma20.period));
      seriesRef.current.ma20.applyOptions({ visible: true });
    } else {
      seriesRef.current.ma20.applyOptions({ visible: false });
    }

    if (ma60.show) {
      seriesRef.current.ma60.setData(movingAverage(candles, ma60.period));
      seriesRef.current.ma60.applyOptions({ visible: true });
    } else {
      seriesRef.current.ma60.applyOptions({ visible: false });
    }

    // EMA (类似处理)
    // BB (类似处理)
  };

  // ========== 添加价格线 ==========
  const addPriceLine = (priceValue) => {
    // 移除旧价格线
    if (currentPriceLineRef.current) {
      try {
        seriesRef.current.candle.removePriceLine(currentPriceLineRef.current);
      } catch (e) {
        console.log('Remove price line failed:', e);
      }
    }

    // 添加新价格线
    const isBottom = zoneType === 'bottom';
    currentPriceLineRef.current = seriesRef.current.candle.createPriceLine({
      price: priceValue,
      color: isBottom ? '#26a69a' : '#ef5350',
      lineWidth: 2,
      axisLabelVisible: true,
      title: isBottom ? '兜底价' : '探顶价',
      lineStyle: 0
    });
  };

  // ========== 历史记录管理 ==========
  const loadHistory = () => {
    const saved = localStorage.getItem('searchHistory');
    if (saved) {
      setHistory(JSON.parse(saved));
    }
  };

  const saveToHistory = () => {
    if (!symbol || !time || !price) {
      alert('请输入完整参数');
      return;
    }

    const record = { symbol, time, interval, price, zoneType };
    const newHistory = [record, ...history];
    localStorage.setItem('searchHistory', JSON.stringify(newHistory));
    setHistory(newHistory);
    alert('已保存到观察列表');
  };

  // ========== 回测操作 ==========
  const handleOpenLong = () => {
    if (!selectedPoint) {
      alert('请先点击图表选择价格位置');
      return;
    }
    try {
      const newState = openPosition(backtestState, 'long', selectedPoint.price, selectedPoint.time);
      setBacktestState(newState);

      // 添加图表标记
      const marker = createTradeMarker(selectedPoint.time, selectedPoint.price, 'long', 'open');
      const markers = seriesRef.current.candle.markers() || [];
      seriesRef.current.candle.setMarkers([...markers, marker]);
    } catch (error) {
      alert(error.message);
    }
  };

  const handleOpenShort = () => {
    if (!selectedPoint) {
      alert('请先点击图表选择价格位置');
      return;
    }
    try {
      const newState = openPosition(backtestState, 'short', selectedPoint.price, selectedPoint.time);
      setBacktestState(newState);

      const marker = createTradeMarker(selectedPoint.time, selectedPoint.price, 'short', 'open');
      const markers = seriesRef.current.candle.markers() || [];
      seriesRef.current.candle.setMarkers([...markers, marker]);
    } catch (error) {
      alert(error.message);
    }
  };

  const handleClose = () => {
    if (!selectedPoint) {
      alert('请先点击图表选择平仓位置');
      return;
    }
    try {
      const posType = backtestState.currentPosition.type;
      const newState = closePosition(backtestState, selectedPoint.price, selectedPoint.time);
      setBacktestState(newState);

      const marker = createTradeMarker(selectedPoint.time, selectedPoint.price, posType, 'close');
      const markers = seriesRef.current.candle.markers() || [];
      seriesRef.current.candle.setMarkers([...markers, marker]);
    } catch (error) {
      alert(error.message);
    }
  };

  const stats = calculateBacktestStats(backtestState);

  // ========== 渲染 ==========
  return (
    <div className="app">
      <h2>潜力区币回测工具 {version === 'local' ? '- 本地版' : ''}</h2>

      {/* 搜索控件 */}
      <div className="controls">
        <label>
          交易对: <input value={symbol} onChange={e => setSymbol(e.target.value)} />
        </label>
        <label>
          时间: <input type="datetime-local" value={time} onChange={e => setTime(e.target.value)} />
        </label>
        <label>
          周期:
          <select value={interval} onChange={e => setInterval(e.target.value)}>
            <option value="1m">1m</option>
            <option value="3m">3m</option>
            <option value="5m">5m</option>
            <option value="15m">15m</option>
            <option value="30m">30m</option>
            <option value="1h">1h</option>
            <option value="4h">4h</option>
            <option value="1d">1d</option>
          </select>
        </label>
        <label>
          区域类型:
          <select value={zoneType} onChange={e => setZoneType(e.target.value)}>
            <option value="bottom">兜底区</option>
            <option value="top">探顶区</option>
          </select>
        </label>
        <label>
          价格: <input type="number" step="any" value={price} onChange={e => setPrice(e.target.value)} />
        </label>
        <button onClick={loadKlineData} disabled={loading}>
          {loading ? '加载中...' : '搜索'}
        </button>
        <button onClick={saveToHistory}>保存查询</button>
        <button onClick={() => setShowIndicators(!showIndicators)}>
          技术指标 {showIndicators ? '▲' : '▼'}
        </button>
      </div>

      {/* 图表和侧边栏 */}
      <div className="main-container">
        <div className="chart-area">
          <div ref={chartContainerRef} className="chart" />
          <div className="legend">
            <strong>MA:</strong>
            <span><i style={{ background: 'orange' }}></i>MA5</span>
            <span><i style={{ background: 'gold' }}></i>MA10</span>
            <span><i style={{ background: 'blue' }}></i>MA20</span>
            <span><i style={{ background: 'purple' }}></i>MA60</span>
          </div>
        </div>

        {/* 侧边栏 - 简化版 */}
        <div className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="sidebar-header">
            <h3>潜力观察列表</h3>
            <button className="toggle-btn" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
              {sidebarCollapsed ? '▶' : '◀'}
            </button>
          </div>
          <div className="sidebar-content">
            {history.slice(0, 20).map((item, idx) => (
              <div key={idx} className={`history-item ${item.zoneType}-zone`}>
                <div style={{ fontWeight: 'bold' }}>{item.symbol} - {item.zoneType === 'bottom' ? '兜底区' : '探顶区'}</div>
                <div style={{ fontSize: '11px', color: '#666' }}>{item.interval} | {item.time}</div>
                <div style={{ fontSize: '11px', color: '#666' }}>价格: {item.price}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 回测工具 */}
      <div style={{ marginTop: '20px' }}>
        <button onClick={() => setShowBacktest(!showBacktest)}>
          回测工具 {showBacktest ? '▲' : '▼'}
        </button>
      </div>

      {showBacktest && (
        <div className="backtest-panel">
          <div className="backtest-controls">
            <div className="backtest-actions">
              <h4>交易操作</h4>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                <button className="trade-btn long-btn" onClick={handleOpenLong} disabled={stats.hasPosition}>
                  开多 Long
                </button>
                <button className="trade-btn short-btn" onClick={handleOpenShort} disabled={stats.hasPosition}>
                  开空 Short
                </button>
                <button className="trade-btn close-btn" onClick={handleClose} disabled={!stats.hasPosition}>
                  平仓 Close
                </button>
              </div>
            </div>

            <div className="backtest-stats">
              <h4>回测统计</h4>
              <div className="stat-item">
                <span>当前资金:</span>
                <strong>{stats.currentCapital} USDT</strong>
              </div>
              <div className="stat-item">
                <span>总收益:</span>
                <strong className={stats.profitClass}>{stats.profit} USDT</strong>
              </div>
              <div className="stat-item">
                <span>收益率:</span>
                <strong className={stats.profitClass}>{stats.returnPct}%</strong>
              </div>
              <div className="stat-item">
                <span>交易次数:</span>
                <strong>{stats.totalTrades}</strong>
              </div>
              <div className="stat-item">
                <span>胜率:</span>
                <strong>{stats.winRate}%</strong>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 提示 */}
      <div className="hint">
        说明：时间自动使用浏览器本地时区。
        {version === 'local' ? 'K线数据会自动缓存到浏览器IndexedDB。' : 'K线数据会自动缓存到Cloudflare D1数据库。'}
      </div>
      <div className="hint">
        数据来源：币安（Binance）公共API
        {version === 'local' ? '，本地版本无需服务器。' : '（通过Cloudflare Workers代理）。'}
      </div>
    </div>
  );
}
