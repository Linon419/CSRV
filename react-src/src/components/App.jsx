import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createChart } from 'lightweight-charts';
import {
  movingAverage,
  exponentialMovingAverage,
  bollingerBands,
  intervalToMs
} from '../services/indicators';
import {
  createPositionState,
  openPosition,
  reducePosition,
  closePosition,
  setStopLoss,
  setTakeProfit,
  calculateUnrealizedPnL,
  calculateTotalStats,
  createPositionLineConfig,
  createStopLossLineConfig,
  createTakeProfitLineConfig,
  exportTradingHistory
} from '../services/position';
import '../styles/global.css';

/**
 * 主应用组件（通用版本，通过props注入数据服务）
 */
export default function App({ dataService, version = 'local' }) {
  // ========== 状态管理 ==========
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [time, setTime] = useState('');
  const [interval, setInterval] = useState('3m');
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

  // 持仓状态
  const [positionState, setPositionState] = useState(() => createPositionState());
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [currentPrice, setCurrentPrice] = useState(0);
  const [stopLossInput, setStopLossInput] = useState('');
  const [takeProfitInput, setTakeProfitInput] = useState('');
  const [quantityInput, setQuantityInput] = useState(1);

  // 历史记录
  const [history, setHistory] = useState([]);
  const [filteredHistory, setFilteredHistory] = useState([]);
  const [filterSymbol, setFilterSymbol] = useState('');
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editForm, setEditForm] = useState({ time: '', price: '', zoneType: 'bottom' });

  // 图表引用
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef({});
  const currentPriceLineRef = useRef(null);
  const positionLinesRef = useRef({ position: null, stopLoss: null, takeProfit: null });

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

      const price = typeof priceData === 'object' ? priceData.close : priceData;
      setSelectedPoint({
        time: param.time * 1000,
        price: price
      });
      setCurrentPrice(price);

      console.log(`Selected: ${new Date(param.time * 1000).toLocaleString()}, Price: ${price}`);
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

  // ========== 周期切换处理 ==========
  const handleIntervalChange = async (newInterval) => {
    setInterval(newInterval);

    // 如果已有完整参数，自动重新加载数据
    if (symbol && time && price) {
      setLoading(true);

      try {
        const targetDate = new Date(time);
        const dayStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate()).getTime();
        const nextDayEnd = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() + 2).getTime() - 1;

        const ms = intervalToMs[newInterval] || 3600000;
        const totalCandles = Math.ceil((nextDayEnd - dayStart) / ms);

        // 从数据库获取缓存
        let cachedData = await dataService.getKlinesFromDB(symbol, newInterval, dayStart, nextDayEnd);
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
            promises.push(dataService.fetchBinanceKlines(symbol, newInterval, batchStart, batchEnd, batchSize));
          }

          const results = await Promise.all(promises);
          const apiData = results.flat();

          if (!Array.isArray(apiData) || apiData.length === 0) {
            throw new Error('无数据');
          }

          // 保存到数据库
          await dataService.saveKlinesToDB(symbol, newInterval, apiData);

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

    // EMA
    if (ema21.show) {
      seriesRef.current.ema21.setData(exponentialMovingAverage(candles, ema21.period));
      seriesRef.current.ema21.applyOptions({ visible: true });
    } else {
      seriesRef.current.ema21.applyOptions({ visible: false });
    }

    if (ema55.show) {
      seriesRef.current.ema55.setData(exponentialMovingAverage(candles, ema55.period));
      seriesRef.current.ema55.applyOptions({ visible: true });
    } else {
      seriesRef.current.ema55.applyOptions({ visible: false });
    }

    if (ema100.show) {
      seriesRef.current.ema100.setData(exponentialMovingAverage(candles, ema100.period));
      seriesRef.current.ema100.applyOptions({ visible: true });
    } else {
      seriesRef.current.ema100.applyOptions({ visible: false });
    }

    if (ema200.show) {
      seriesRef.current.ema200.setData(exponentialMovingAverage(candles, ema200.period));
      seriesRef.current.ema200.applyOptions({ visible: true });
    } else {
      seriesRef.current.ema200.applyOptions({ visible: false });
    }

    // 布林带
    if (bb.show) {
      const bbData = bollingerBands(candles, bb.period, bb.stdDev);
      seriesRef.current.bbUpper.setData(bbData.upper);
      seriesRef.current.bbMiddle.setData(bbData.middle);
      seriesRef.current.bbLower.setData(bbData.lower);
      seriesRef.current.bbUpper.applyOptions({ visible: true });
      seriesRef.current.bbMiddle.applyOptions({ visible: true });
      seriesRef.current.bbLower.applyOptions({ visible: true });
    } else {
      seriesRef.current.bbUpper.applyOptions({ visible: false });
      seriesRef.current.bbMiddle.applyOptions({ visible: false });
      seriesRef.current.bbLower.applyOptions({ visible: false });
    }
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
      const historyData = JSON.parse(saved);
      setHistory(historyData);
      setFilteredHistory(historyData);
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
    setFilteredHistory(newHistory);
    alert('已保存到观察列表');
  };

  const applyFilter = () => {
    let filtered = [...history];

    if (filterSymbol) {
      const s = filterSymbol.trim().toUpperCase();
      filtered = filtered.filter(item => item.symbol.toUpperCase().includes(s));
    }

    if (filterStart) {
      const startTs = new Date(filterStart).getTime();
      filtered = filtered.filter(item => new Date(item.time).getTime() >= startTs);
    }

    if (filterEnd) {
      const endTs = new Date(filterEnd).getTime();
      filtered = filtered.filter(item => new Date(item.time).getTime() <= endTs);
    }

    filtered.sort((a, b) => new Date(b.time) - new Date(a.time));
    setFilteredHistory(filtered);
  };

  const resetFilter = () => {
    setFilterSymbol('');
    setFilterStart('');
    setFilterEnd('');
    setFilteredHistory(history);
  };

  const clearHistory = () => {
    if (!confirm('确定要清空所有历史记录吗？')) return;
    localStorage.removeItem('searchHistory');
    setHistory([]);
    setFilteredHistory([]);
  };

  const exportHistory = () => {
    if (history.length === 0) {
      alert('暂无历史记录');
      return;
    }

    const data = JSON.stringify(history, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `search_history_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importHistory = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!Array.isArray(data)) throw new Error('文件格式错误');

        const mergedHistory = [...history, ...data];
        mergedHistory.sort((a, b) => new Date(b.time) - new Date(a.time));

        localStorage.setItem('searchHistory', JSON.stringify(mergedHistory));
        setHistory(mergedHistory);
        setFilteredHistory(mergedHistory);
        alert('导入成功');
      } catch (err) {
        alert('导入失败: ' + err.message);
      }
    };
    reader.readAsText(file);
    event.target.value = ''; // 重置文件输入
  };

  const handleHistoryClick = async (item) => {
    // 先设置状态
    setSymbol(item.symbol);
    setInterval(item.interval);
    setTime(item.time);
    setPrice(item.price);
    setZoneType(item.zoneType);

    // 直接使用item的值加载数据
    if (!item.symbol || !item.time || !item.price) return;

    setLoading(true);
    try {
      const targetDate = new Date(item.time);
      const dayStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate()).getTime();
      const nextDayEnd = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() + 2).getTime() - 1;

      const ms = intervalToMs[item.interval] || 3600000;
      const totalCandles = Math.ceil((nextDayEnd - dayStart) / ms);

      let cachedData = await dataService.getKlinesFromDB(item.symbol, item.interval, dayStart, nextDayEnd);
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
          promises.push(dataService.fetchBinanceKlines(item.symbol, item.interval, batchStart, batchEnd, batchSize));
        }

        const results = await Promise.all(promises);
        const apiData = results.flat();

        if (!Array.isArray(apiData) || apiData.length === 0) {
          throw new Error('无数据');
        }

        await dataService.saveKlinesToDB(item.symbol, item.interval, apiData);

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

  const handleClearCache = async () => {
    if (!confirm('确定要清空所有K线缓存吗？')) return;
    try {
      await dataService.clearKlineCache();
      alert('K线缓存已清空');
    } catch (err) {
      alert('清空失败: ' + err.message);
    }
  };

  const handleEditHistory = (idx, item) => {
    setEditingIndex(idx);
    setEditForm({
      time: item.time,
      price: item.price,
      zoneType: item.zoneType
    });
  };

  const handleSaveEdit = (idx) => {
    const originalItem = filteredHistory[idx];
    const historyIdx = history.findIndex(h =>
      h.symbol === originalItem.symbol &&
      h.time === originalItem.time &&
      h.interval === originalItem.interval &&
      h.price === originalItem.price
    );

    if (historyIdx === -1) return;

    const updatedHistory = [...history];
    updatedHistory[historyIdx] = {
      ...updatedHistory[historyIdx],
      time: editForm.time,
      price: editForm.price,
      zoneType: editForm.zoneType
    };

    localStorage.setItem('searchHistory', JSON.stringify(updatedHistory));
    setHistory(updatedHistory);

    // 更新filteredHistory
    let filtered = [...updatedHistory];
    if (filterSymbol) {
      const s = filterSymbol.trim().toUpperCase();
      filtered = filtered.filter(item => item.symbol.toUpperCase().includes(s));
    }
    if (filterStart) {
      const startTs = new Date(filterStart).getTime();
      filtered = filtered.filter(item => new Date(item.time).getTime() >= startTs);
    }
    if (filterEnd) {
      const endTs = new Date(filterEnd).getTime();
      filtered = filtered.filter(item => new Date(item.time).getTime() <= endTs);
    }
    filtered.sort((a, b) => new Date(b.time) - new Date(a.time));
    setFilteredHistory(filtered);

    setEditingIndex(null);
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setEditForm({ time: '', price: '', zoneType: 'bottom' });
  };

  const handleDeleteHistory = (idx) => {
    if (!confirm('确定要删除这条记录吗？')) return;

    const originalItem = filteredHistory[idx];
    const historyIdx = history.findIndex(h =>
      h.symbol === originalItem.symbol &&
      h.time === originalItem.time &&
      h.interval === originalItem.interval &&
      h.price === originalItem.price
    );

    if (historyIdx === -1) return;

    const updatedHistory = history.filter((_, i) => i !== historyIdx);
    localStorage.setItem('searchHistory', JSON.stringify(updatedHistory));
    setHistory(updatedHistory);

    // 更新filteredHistory
    let filtered = [...updatedHistory];
    if (filterSymbol) {
      const s = filterSymbol.trim().toUpperCase();
      filtered = filtered.filter(item => item.symbol.toUpperCase().includes(s));
    }
    if (filterStart) {
      const startTs = new Date(filterStart).getTime();
      filtered = filtered.filter(item => new Date(item.time).getTime() >= startTs);
    }
    if (filterEnd) {
      const endTs = new Date(filterEnd).getTime();
      filtered = filtered.filter(item => new Date(item.time).getTime() <= endTs);
    }
    filtered.sort((a, b) => new Date(b.time) - new Date(a.time));
    setFilteredHistory(filtered);
  };

  // ========== 价格格式化 ==========
  const formatPrice = (price) => {
    if (!price && price !== 0) return '0';

    // 将数字转换为字符串，保留完整精度
    const priceStr = typeof price === 'number' ? price.toString() : price;
    const priceNum = parseFloat(priceStr);

    // 如果价格很大 (>= 1000)，保留2位小数
    if (priceNum >= 1000) {
      return priceNum.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    }

    // 如果价格 >= 1，保留2-8位小数（移除尾部0）
    if (priceNum >= 1) {
      return priceNum.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 8
      });
    }

    // 如果价格 < 1，保留有效数字（最多8位）
    if (priceNum > 0) {
      // 计算需要的小数位数以显示至少2位有效数字
      const decimalPlaces = Math.max(2, Math.ceil(-Math.log10(priceNum)) + 1);
      return priceNum.toFixed(Math.min(decimalPlaces, 8));
    }

    return '0';
  };

  // ========== 持仓操作 ==========
  const handleOpenLong = () => {
    if (!selectedPoint) {
      alert('请先点击图表选择价格位置');
      return;
    }
    try {
      const newState = openPosition(positionState, 'long', selectedPoint.price, selectedPoint.time, quantityInput);
      setPositionState(newState);
      updatePositionLines(newState);

      // 添加图表标记
      const markers = seriesRef.current.candle.markers() || [];
      seriesRef.current.candle.setMarkers([...markers, {
        time: Math.floor(selectedPoint.time / 1000),
        position: 'belowBar',
        color: '#26a69a',
        shape: 'arrowUp',
        text: 'Long',
        size: 2
      }]);
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
      const newState = openPosition(positionState, 'short', selectedPoint.price, selectedPoint.time, quantityInput);
      setPositionState(newState);
      updatePositionLines(newState);

      // 添加图表标记
      const markers = seriesRef.current.candle.markers() || [];
      seriesRef.current.candle.setMarkers([...markers, {
        time: Math.floor(selectedPoint.time / 1000),
        position: 'aboveBar',
        color: '#ef5350',
        shape: 'arrowDown',
        text: 'Short',
        size: 2
      }]);
    } catch (error) {
      alert(error.message);
    }
  };

  const handleAddPosition = () => {
    if (!selectedPoint) {
      alert('请先点击图表选择价格位置');
      return;
    }
    if (!positionState.currentPosition) {
      alert('当前无持仓，请先开仓');
      return;
    }
    try {
      const newState = openPosition(positionState, positionState.currentPosition.type, selectedPoint.price, selectedPoint.time, quantityInput);
      setPositionState(newState);
      updatePositionLines(newState);

      // 添加图表标记
      const markers = seriesRef.current.candle.markers() || [];
      seriesRef.current.candle.setMarkers([...markers, {
        time: Math.floor(selectedPoint.time / 1000),
        position: positionState.currentPosition.type === 'long' ? 'belowBar' : 'aboveBar',
        color: positionState.currentPosition.type === 'long' ? '#26a69a' : '#ef5350',
        shape: 'circle',
        text: 'Add',
        size: 1
      }]);
    } catch (error) {
      alert(error.message);
    }
  };

  const handleReducePosition = () => {
    if (!selectedPoint) {
      alert('请先点击图表选择价格位置');
      return;
    }
    try {
      const newState = reducePosition(positionState, selectedPoint.price, selectedPoint.time, quantityInput);
      setPositionState(newState);
      updatePositionLines(newState);

      // 添加图表标记
      const markers = seriesRef.current.candle.markers() || [];
      seriesRef.current.candle.setMarkers([...markers, {
        time: Math.floor(selectedPoint.time / 1000),
        position: positionState.currentPosition.type === 'long' ? 'aboveBar' : 'belowBar',
        color: '#ff9800',
        shape: 'circle',
        text: 'Reduce',
        size: 1
      }]);
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
      const posType = positionState.currentPosition.type;
      const newState = closePosition(positionState, selectedPoint.price, selectedPoint.time);
      setPositionState(newState);
      clearPositionLines();

      // 添加图表标记
      const markers = seriesRef.current.candle.markers() || [];
      seriesRef.current.candle.setMarkers([...markers, {
        time: Math.floor(selectedPoint.time / 1000),
        position: posType === 'long' ? 'aboveBar' : 'belowBar',
        color: '#9e9e9e',
        shape: 'square',
        text: 'Close',
        size: 2
      }]);
    } catch (error) {
      alert(error.message);
    }
  };

  const handleSetStopLoss = () => {
    if (!stopLossInput) {
      alert('请输入止损价格');
      return;
    }
    try {
      const newState = setStopLoss(positionState, parseFloat(stopLossInput));
      setPositionState(newState);
      updatePositionLines(newState);
    } catch (error) {
      alert(error.message);
    }
  };

  const handleSetTakeProfit = () => {
    if (!takeProfitInput) {
      alert('请输入止盈价格');
      return;
    }
    try {
      const newState = setTakeProfit(positionState, parseFloat(takeProfitInput));
      setPositionState(newState);
      updatePositionLines(newState);
    } catch (error) {
      alert(error.message);
    }
  };

  // 更新持仓价格线
  const updatePositionLines = (state) => {
    if (!seriesRef.current.candle) return;

    // 清除旧的价格线
    clearPositionLines();

    if (state.currentPosition) {
      // 持仓价格线
      const posConfig = createPositionLineConfig(state.currentPosition);
      positionLinesRef.current.position = seriesRef.current.candle.createPriceLine({
        price: posConfig.price,
        color: posConfig.color,
        lineWidth: posConfig.lineWidth,
        lineStyle: posConfig.lineStyle,
        axisLabelVisible: posConfig.axisLabelVisible,
        title: posConfig.title
      });

      // 止损线
      if (state.currentPosition.stopLoss) {
        const slConfig = createStopLossLineConfig(state.currentPosition.stopLoss);
        positionLinesRef.current.stopLoss = seriesRef.current.candle.createPriceLine({
          price: slConfig.price,
          color: slConfig.color,
          lineWidth: slConfig.lineWidth,
          lineStyle: slConfig.lineStyle,
          axisLabelVisible: slConfig.axisLabelVisible,
          title: slConfig.title
        });
      }

      // 止盈线
      if (state.currentPosition.takeProfit) {
        const tpConfig = createTakeProfitLineConfig(state.currentPosition.takeProfit);
        positionLinesRef.current.takeProfit = seriesRef.current.candle.createPriceLine({
          price: tpConfig.price,
          color: tpConfig.color,
          lineWidth: tpConfig.lineWidth,
          lineStyle: tpConfig.lineStyle,
          axisLabelVisible: tpConfig.axisLabelVisible,
          title: tpConfig.title
        });
      }
    }
  };

  // 清除持仓价格线
  const clearPositionLines = () => {
    if (!seriesRef.current.candle) return;

    try {
      if (positionLinesRef.current.position) {
        seriesRef.current.candle.removePriceLine(positionLinesRef.current.position);
        positionLinesRef.current.position = null;
      }
      if (positionLinesRef.current.stopLoss) {
        seriesRef.current.candle.removePriceLine(positionLinesRef.current.stopLoss);
        positionLinesRef.current.stopLoss = null;
      }
      if (positionLinesRef.current.takeProfit) {
        seriesRef.current.candle.removePriceLine(positionLinesRef.current.takeProfit);
        positionLinesRef.current.takeProfit = null;
      }
    } catch (e) {
      console.log('Clear position lines failed:', e);
    }
  };

  // 计算统计信息
  const stats = calculateTotalStats(positionState.closedTrades);
  const unrealizedPnL = positionState.currentPosition && currentPrice
    ? calculateUnrealizedPnL(positionState.currentPosition, currentPrice)
    : { pnl: 0, pnlPercent: 0 };

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
          <select value={interval} onChange={e => handleIntervalChange(e.target.value)}>
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

      {/* 技术指标设置面板 */}
      {showIndicators && (
        <div className="indicators-panel">
          {/* MA - 简单移动平均线 */}
          <div className="indicator-group">
            <h4>MA - 简单移动平均线</h4>
            <div className="indicator-row">
              <label>
                <input
                  type="checkbox"
                  checked={indicators.ma5.show}
                  onChange={(e) => setIndicators({ ...indicators, ma5: { ...indicators.ma5, show: e.target.checked } })}
                />
                MA5
                <input
                  type="number"
                  min="1"
                  style={{ width: '50px' }}
                  value={indicators.ma5.period}
                  onChange={(e) => setIndicators({ ...indicators, ma5: { ...indicators.ma5, period: parseInt(e.target.value) || 5 } })}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={indicators.ma10.show}
                  onChange={(e) => setIndicators({ ...indicators, ma10: { ...indicators.ma10, show: e.target.checked } })}
                />
                MA10
                <input
                  type="number"
                  min="1"
                  style={{ width: '50px' }}
                  value={indicators.ma10.period}
                  onChange={(e) => setIndicators({ ...indicators, ma10: { ...indicators.ma10, period: parseInt(e.target.value) || 10 } })}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={indicators.ma20.show}
                  onChange={(e) => setIndicators({ ...indicators, ma20: { ...indicators.ma20, show: e.target.checked } })}
                />
                MA20
                <input
                  type="number"
                  min="1"
                  style={{ width: '50px' }}
                  value={indicators.ma20.period}
                  onChange={(e) => setIndicators({ ...indicators, ma20: { ...indicators.ma20, period: parseInt(e.target.value) || 20 } })}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={indicators.ma60.show}
                  onChange={(e) => setIndicators({ ...indicators, ma60: { ...indicators.ma60, show: e.target.checked } })}
                />
                MA60
                <input
                  type="number"
                  min="1"
                  style={{ width: '50px' }}
                  value={indicators.ma60.period}
                  onChange={(e) => setIndicators({ ...indicators, ma60: { ...indicators.ma60, period: parseInt(e.target.value) || 60 } })}
                />
              </label>
            </div>
          </div>

          {/* EMA - 指数移动平均线 */}
          <div className="indicator-group">
            <h4>EMA - 指数移动平均线</h4>
            <div className="indicator-row">
              <label>
                <input
                  type="checkbox"
                  checked={indicators.ema21.show}
                  onChange={(e) => setIndicators({ ...indicators, ema21: { ...indicators.ema21, show: e.target.checked } })}
                />
                EMA21
                <input
                  type="number"
                  min="1"
                  style={{ width: '50px' }}
                  value={indicators.ema21.period}
                  onChange={(e) => setIndicators({ ...indicators, ema21: { ...indicators.ema21, period: parseInt(e.target.value) || 21 } })}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={indicators.ema55.show}
                  onChange={(e) => setIndicators({ ...indicators, ema55: { ...indicators.ema55, show: e.target.checked } })}
                />
                EMA55
                <input
                  type="number"
                  min="1"
                  style={{ width: '50px' }}
                  value={indicators.ema55.period}
                  onChange={(e) => setIndicators({ ...indicators, ema55: { ...indicators.ema55, period: parseInt(e.target.value) || 55 } })}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={indicators.ema100.show}
                  onChange={(e) => setIndicators({ ...indicators, ema100: { ...indicators.ema100, show: e.target.checked } })}
                />
                EMA100
                <input
                  type="number"
                  min="1"
                  style={{ width: '50px' }}
                  value={indicators.ema100.period}
                  onChange={(e) => setIndicators({ ...indicators, ema100: { ...indicators.ema100, period: parseInt(e.target.value) || 100 } })}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={indicators.ema200.show}
                  onChange={(e) => setIndicators({ ...indicators, ema200: { ...indicators.ema200, show: e.target.checked } })}
                />
                EMA200
                <input
                  type="number"
                  min="1"
                  style={{ width: '50px' }}
                  value={indicators.ema200.period}
                  onChange={(e) => setIndicators({ ...indicators, ema200: { ...indicators.ema200, period: parseInt(e.target.value) || 200 } })}
                />
              </label>
            </div>
          </div>

          {/* 布林带 */}
          <div className="indicator-group">
            <h4>布林带 (Bollinger Bands)</h4>
            <div className="indicator-row">
              <label>
                <input
                  type="checkbox"
                  checked={indicators.bb.show}
                  onChange={(e) => setIndicators({ ...indicators, bb: { ...indicators.bb, show: e.target.checked } })}
                />
                显示布林带
              </label>
              <label>
                周期:
                <input
                  type="number"
                  min="1"
                  style={{ width: '50px' }}
                  value={indicators.bb.period}
                  onChange={(e) => setIndicators({ ...indicators, bb: { ...indicators.bb, period: parseInt(e.target.value) || 20 } })}
                />
              </label>
              <label>
                标准差倍数:
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  style={{ width: '50px' }}
                  value={indicators.bb.stdDev}
                  onChange={(e) => setIndicators({ ...indicators, bb: { ...indicators.bb, stdDev: parseFloat(e.target.value) || 2 } })}
                />
              </label>
            </div>
          </div>

          {/* 应用按钮 */}
          <div style={{ marginTop: '10px' }}>
            <button onClick={loadKlineData}>应用设置</button>
          </div>
        </div>
      )}

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
            <strong style={{ marginLeft: '15px' }}>EMA:</strong>
            <span><i style={{ background: '#00bcd4' }}></i>EMA21</span>
            <span><i style={{ background: '#ff9800' }}></i>EMA55</span>
            <span><i style={{ background: '#e91e63' }}></i>EMA100</span>
            <span><i style={{ background: '#9c27b0' }}></i>EMA200</span>
            <strong style={{ marginLeft: '15px' }}>BB:</strong>
            <span><i style={{ background: '#2196f3' }}></i>布林带</span>
          </div>
        </div>

        {/* 侧边栏 */}
        <div className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="sidebar-header">
            <h3>潜力观察列表</h3>
            <button className="toggle-btn" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
              {sidebarCollapsed ? '▶' : '◀'}
            </button>
          </div>
          <div className="sidebar-content">
            {/* 筛选器 */}
            <div className="history-filters">
              <label>
                币种筛选
                <input
                  placeholder="如 BTCUSDT"
                  value={filterSymbol}
                  onChange={(e) => setFilterSymbol(e.target.value)}
                />
              </label>
              <label>
                起始时间
                <input
                  type="datetime-local"
                  value={filterStart}
                  onChange={(e) => setFilterStart(e.target.value)}
                />
              </label>
              <label>
                结束时间
                <input
                  type="datetime-local"
                  value={filterEnd}
                  onChange={(e) => setFilterEnd(e.target.value)}
                />
              </label>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button onClick={applyFilter}>筛选</button>
                <button onClick={resetFilter}>重置</button>
              </div>
            </div>

            {/* 历史记录列表 */}
            <div>
              {filteredHistory.map((item, idx) => (
                <div
                  key={idx}
                  className={`history-item ${item.zoneType}-zone`}
                  style={{ cursor: editingIndex === idx ? 'default' : 'pointer' }}
                >
                  {editingIndex === idx ? (
                    // 编辑模式
                    <div onClick={(e) => e.stopPropagation()}>
                      <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>
                        {item.symbol} - {item.interval}
                      </div>
                      <div style={{ marginBottom: '5px' }}>
                        <label style={{ fontSize: '11px', display: 'block', marginBottom: '2px' }}>
                          时间:
                        </label>
                        <input
                          type="datetime-local"
                          value={editForm.time}
                          onChange={(e) => setEditForm({ ...editForm, time: e.target.value })}
                          style={{ width: '100%', fontSize: '11px', padding: '3px' }}
                        />
                      </div>
                      <div style={{ marginBottom: '5px' }}>
                        <label style={{ fontSize: '11px', display: 'block', marginBottom: '2px' }}>
                          价格:
                        </label>
                        <input
                          type="number"
                          step="any"
                          value={editForm.price}
                          onChange={(e) => setEditForm({ ...editForm, price: e.target.value })}
                          style={{ width: '100%', fontSize: '11px', padding: '3px' }}
                        />
                      </div>
                      <div style={{ marginBottom: '5px' }}>
                        <label style={{ fontSize: '11px', display: 'block', marginBottom: '2px' }}>
                          区域类型:
                        </label>
                        <select
                          value={editForm.zoneType}
                          onChange={(e) => setEditForm({ ...editForm, zoneType: e.target.value })}
                          style={{ width: '100%', fontSize: '11px', padding: '3px' }}
                        >
                          <option value="bottom">兜底区</option>
                          <option value="top">探顶区</option>
                        </select>
                      </div>
                      <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
                        <button
                          onClick={() => handleSaveEdit(idx)}
                          style={{ flex: 1, fontSize: '11px', padding: '4px', background: '#4caf50', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer' }}
                        >
                          保存
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          style={{ flex: 1, fontSize: '11px', padding: '4px', background: '#9e9e9e', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer' }}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    // 显示模式
                    <div onClick={() => handleHistoryClick(item)}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                        <div style={{ fontWeight: 'bold' }}>
                          {item.symbol} - {item.zoneType === 'bottom' ? '兜底区' : '探顶区'}
                        </div>
                        <div style={{ display: 'flex', gap: '2px' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditHistory(idx, item);
                            }}
                            style={{ fontSize: '10px', padding: '2px 6px', background: '#2196f3', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer' }}
                          >
                            编辑
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteHistory(idx);
                            }}
                            style={{ fontSize: '10px', padding: '2px 6px', background: '#f44336', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer' }}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                      <div style={{ fontSize: '11px', color: '#666' }}>
                        {item.interval} | {new Date(item.time).toLocaleString('zh-CN', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false
                        })}
                      </div>
                      <div style={{ fontSize: '11px', color: '#666' }}>价格: {item.price}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* 控制按钮 */}
            <div className="history-controls">
              <button onClick={clearHistory}>清空</button>
              <button onClick={exportHistory}>导出</button>
              <input
                type="file"
                accept=".json"
                onChange={importHistory}
                style={{ display: 'none' }}
                id="import-file"
              />
              <button onClick={() => document.getElementById('import-file').click()}>
                导入
              </button>
              <button onClick={handleClearCache}>清缓存</button>
            </div>
          </div>
        </div>
      </div>

      {/* 持仓工具 */}
      <div style={{ marginTop: '20px' }}>
        <button onClick={() => setShowBacktest(!showBacktest)}>
          Position 持仓工具 {showBacktest ? '▲' : '▼'}
        </button>
      </div>

      {showBacktest && (
        <div className="backtest-panel">
          <div className="backtest-controls">
            {/* 开仓操作 */}
            <div className="backtest-actions">
              <h4>开仓操作</h4>
              <div style={{ marginBottom: '10px' }}>
                <label style={{ marginRight: '10px' }}>
                  数量: <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={quantityInput}
                    onChange={(e) => setQuantityInput(parseFloat(e.target.value) || 1)}
                    style={{ width: '80px' }}
                  />
                </label>
              </div>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                <button
                  className="trade-btn long-btn"
                  onClick={handleOpenLong}
                  disabled={!!positionState.currentPosition}
                >
                  Long Position
                </button>
                <button
                  className="trade-btn short-btn"
                  onClick={handleOpenShort}
                  disabled={!!positionState.currentPosition}
                >
                  Short Position
                </button>
              </div>
            </div>

            {/* 当前持仓 */}
            {positionState.currentPosition && (
              <div className="position-info">
                <h4>当前持仓</h4>
                <div className="stat-item">
                  <span>类型:</span>
                  <strong style={{ color: positionState.currentPosition.type === 'long' ? '#26a69a' : '#ef5350' }}>
                    {positionState.currentPosition.type === 'long' ? 'Long (多仓)' : 'Short (空仓)'}
                  </strong>
                </div>
                <div className="stat-item">
                  <span>持仓均价:</span>
                  <strong>{formatPrice(positionState.currentPosition.avgPrice)}</strong>
                </div>
                <div className="stat-item">
                  <span>持仓数量:</span>
                  <strong>{positionState.currentPosition.quantity}</strong>
                </div>
                <div className="stat-item">
                  <span>未实现盈亏:</span>
                  <strong className={unrealizedPnL.pnl >= 0 ? 'profit' : 'loss'}>
                    {unrealizedPnL.pnl.toFixed(2)} USDT ({unrealizedPnL.pnlPercent.toFixed(2)}%)
                  </strong>
                </div>

                {/* 加仓/减仓 */}
                <div style={{ marginTop: '10px', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      className="trade-btn"
                      onClick={handleAddPosition}
                      style={{ background: '#4caf50' }}
                    >
                      加仓 Add
                    </button>
                    <button
                      className="trade-btn"
                      onClick={handleReducePosition}
                      style={{ background: '#ff9800' }}
                    >
                      减仓 Reduce
                    </button>
                    <button
                      className="trade-btn close-btn"
                      onClick={handleClose}
                    >
                      平仓 Close
                    </button>
                  </div>
                </div>

                {/* 止损止盈设置 */}
                <div style={{ marginTop: '10px' }}>
                  <h4 style={{ fontSize: '14px' }}>止损/止盈</h4>
                  <div style={{ display: 'flex', gap: '10px', marginBottom: '5px' }}>
                    <input
                      type="number"
                      placeholder="止损价格"
                      step="any"
                      value={stopLossInput}
                      onChange={(e) => setStopLossInput(e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <button onClick={handleSetStopLoss} style={{ padding: '5px 10px' }}>
                      设置止损
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <input
                      type="number"
                      placeholder="止盈价格"
                      step="any"
                      value={takeProfitInput}
                      onChange={(e) => setTakeProfitInput(e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <button onClick={handleSetTakeProfit} style={{ padding: '5px 10px' }}>
                      设置止盈
                    </button>
                  </div>
                  {positionState.currentPosition.stopLoss && (
                    <div style={{ fontSize: '12px', marginTop: '5px', color: '#f23645' }}>
                      当前止损: {formatPrice(positionState.currentPosition.stopLoss)}
                    </div>
                  )}
                  {positionState.currentPosition.takeProfit && (
                    <div style={{ fontSize: '12px', marginTop: '2px', color: '#089981' }}>
                      当前止盈: {formatPrice(positionState.currentPosition.takeProfit)}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 交易统计 */}
            <div className="backtest-stats">
              <h4>交易统计</h4>
              <div className="stat-item">
                <span>总盈亏:</span>
                <strong className={stats.totalPnL >= 0 ? 'profit' : 'loss'}>
                  {stats.totalPnL.toFixed(2)} USDT
                </strong>
              </div>
              <div className="stat-item">
                <span>交易次数:</span>
                <strong>{stats.winTrades + stats.lossTrades}</strong>
              </div>
              <div className="stat-item">
                <span>胜率:</span>
                <strong>{stats.winRate}%</strong>
              </div>
              <div className="stat-item">
                <span>盈利次数:</span>
                <strong className="profit">{stats.winTrades}</strong>
              </div>
              <div className="stat-item">
                <span>亏损次数:</span>
                <strong className="loss">{stats.lossTrades}</strong>
              </div>
              <div className="stat-item">
                <span>平均盈利:</span>
                <strong className="profit">{stats.avgWin} USDT</strong>
              </div>
              <div className="stat-item">
                <span>平均亏损:</span>
                <strong className="loss">{stats.avgLoss} USDT</strong>
              </div>
              <div className="stat-item">
                <span>盈亏比:</span>
                <strong>{stats.profitFactor}</strong>
              </div>
            </div>

            {/* 交易历史 */}
            {positionState.closedTrades.length > 0 && (
              <div className="trade-history">
                <h4>交易历史</h4>
                <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                  {positionState.closedTrades.slice().reverse().map((trade, idx) => (
                    <div
                      key={idx}
                      className="history-item"
                      style={{
                        borderLeft: `3px solid ${trade.pnl >= 0 ? '#26a69a' : '#ef5350'}`,
                        padding: '8px',
                        marginBottom: '5px',
                        fontSize: '12px'
                      }}
                    >
                      <div style={{ fontWeight: 'bold' }}>
                        {trade.type === 'long' ? 'Long' : 'Short'} |
                        {trade.partial ? ' 部分平仓' : ' 完全平仓'}
                      </div>
                      <div>开仓: {formatPrice(trade.entryPrice)} | 平仓: {formatPrice(trade.closePrice)}</div>
                      <div>数量: {trade.quantity} |
                        <span className={trade.pnl >= 0 ? 'profit' : 'loss'} style={{ fontWeight: 'bold' }}>
                          盈亏: {trade.pnl.toFixed(2)} USDT
                        </span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#666' }}>
                        {new Date(trade.closeTime).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
