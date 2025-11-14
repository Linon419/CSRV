import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createChart } from 'lightweight-charts';
import {
  movingAverage,
  exponentialMovingAverage,
  bollingerBands,
  calculateMACD,
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
  const marketType = 'futures'; // 固定使用合约市场
  const [loading, setLoading] = useState(false);

  // 技术指标设置
  const [indicators, setIndicators] = useState({
    ma5: { show: false, period: 5 },
    ma10: { show: false, period: 10 },
    ma20: { show: false, period: 20 },
    ma60: { show: false, period: 60 },
    ema21: { show: true, period: 21 },
    ema55: { show: true, period: 55 },
    ema100: { show: true, period: 100 },
    ema200: { show: true, period: 200 },
    bb: { show: false, period: 20, stdDev: 2 },
    macd: { show: false, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }
  });

  // 面板显示状态
  const [showIndicators, setShowIndicators] = useState(false);
  const [showBacktest, setShowBacktest] = useState(false);

  // 时间回放状态
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const [fullData, setFullData] = useState([]);
  const [targetIndex, setTargetIndex] = useState(0); // 目标时间在数据中的索引
  const playbackIntervalRef = useRef(null);
  const lastPlaybackPosRef = useRef(0); // 记录上一次回放位置，用于检测是否连续播放

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
  const [sortType, setSortType] = useState('time-desc'); // 排序类型：time-desc, time-asc, name-asc, name-desc
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editForm, setEditForm] = useState({ time: '', price: '', zoneType: 'bottom' });

  // 图表引用
  const chartContainerRef = useRef(null);
  const macdContainerRef = useRef(null);
  const chartRef = useRef(null);
  const macdChartRef = useRef(null);
  const seriesRef = useRef({});
  const currentPriceLineRef = useRef(null);
  const positionLinesRef = useRef({ position: null, stopLoss: null, takeProfit: null });
  const markersRef = useRef([]);

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
      if (macdChartRef.current) {
        macdChartRef.current.remove();
      }
    };
  }, []);

  // 监听排序方式变化，自动重新排序
  useEffect(() => {
    if (history.length > 0) {
      // 重新应用筛选和排序
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

      // 应用排序
      switch (sortType) {
        case 'time-desc':
          filtered.sort((a, b) => new Date(b.time) - new Date(a.time));
          break;
        case 'time-asc':
          filtered.sort((a, b) => new Date(a.time) - new Date(b.time));
          break;
        case 'name-asc':
          filtered.sort((a, b) => a.symbol.localeCompare(b.symbol));
          break;
        case 'name-desc':
          filtered.sort((a, b) => b.symbol.localeCompare(a.symbol));
          break;
        default:
          filtered.sort((a, b) => new Date(b.time) - new Date(a.time));
      }

      setFilteredHistory(filtered);
    }
  }, [sortType, history, filterSymbol, filterStart, filterEnd]);

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
      localization: {
        timeFormatter: (timestamp) => {
          const date = new Date(timestamp * 1000);
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          const hours = String(date.getHours()).padStart(2, '0');
          const minutes = String(date.getMinutes()).padStart(2, '0');
          return `${month}-${day} ${hours}:${minutes}`;
        }
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
    const ma5 = chart.addLineSeries({ color: 'orange', lineWidth: 1, lastValueVisible: false });
    const ma10 = chart.addLineSeries({ color: 'gold', lineWidth: 1, lastValueVisible: false });
    const ma20 = chart.addLineSeries({ color: 'blue', lineWidth: 1, lastValueVisible: false });
    const ma60 = chart.addLineSeries({ color: 'purple', lineWidth: 1, lastValueVisible: false });

    // 创建EMA系列
    const ema21 = chart.addLineSeries({ color: '#00bcd4', lineWidth: 1, visible: false, lastValueVisible: false });
    const ema55 = chart.addLineSeries({ color: '#ff9800', lineWidth: 1, visible: false, lastValueVisible: false });
    const ema100 = chart.addLineSeries({ color: '#e91e63', lineWidth: 1, visible: false, lastValueVisible: false });
    const ema200 = chart.addLineSeries({ color: '#000000', lineWidth: 1, visible: false, lastValueVisible: false });

    // 创建布林带系列
    const bbUpper = chart.addLineSeries({ color: '#2196f3', lineWidth: 1, lineStyle: 2, visible: false, lastValueVisible: false });
    const bbMiddle = chart.addLineSeries({ color: '#2196f3', lineWidth: 1, visible: false, lastValueVisible: false });
    const bbLower = chart.addLineSeries({ color: '#2196f3', lineWidth: 1, lineStyle: 2, visible: false, lastValueVisible: false });

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

    // 创建MACD图表
    if (macdContainerRef.current) {
      const macdChart = createChart(macdContainerRef.current, {
        layout: {
          background: { type: 'solid', color: '#ffffff' },
          textColor: '#000'
        },
        width: macdContainerRef.current.clientWidth,
        height: 150,
        timeScale: {
          timeVisible: true,
          secondsVisible: false,
          visible: true
        },
        localization: {
          timeFormatter: (timestamp) => {
            const date = new Date(timestamp * 1000);
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            return `${month}-${day} ${hours}:${minutes}`;
          }
        },
        rightPriceScale: {
          scaleMargins: { top: 0.1, bottom: 0.1 }
        }
      });

      // 同步时间轴
      chart.timeScale().subscribeVisibleTimeRangeChange(() => {
        const timeRange = chart.timeScale().getVisibleRange();
        if (timeRange && macdChartRef.current && macdContainerRef.current) {
          try {
            macdChart.timeScale().setVisibleRange(timeRange);
          } catch (e) {
            // MACD 图表可能被隐藏，忽略错误
          }
        }
      });

      const macdLine = macdChart.addLineSeries({
        color: '#2962FF',
        lineWidth: 2,
        lastValueVisible: false
      });
      const macdSignal = macdChart.addLineSeries({
        color: '#FF6D00',
        lineWidth: 2,
        lastValueVisible: false
      });
      const macdHistogram = macdChart.addHistogramSeries({
        color: '#26a69a'
      });

      macdChartRef.current = macdChart;
      seriesRef.current.macdLine = macdLine;
      seriesRef.current.macdSignal = macdSignal;
      seriesRef.current.macdHistogram = macdHistogram;
    }

    // 响应式调整
    const handleResize = () => {
      chart.applyOptions({
        width: chartContainerRef.current.clientWidth
      });
      if (macdChartRef.current && macdContainerRef.current) {
        macdChartRef.current.applyOptions({
          width: macdContainerRef.current.clientWidth
        });
      }
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
          promises.push(dataService.fetchBinanceKlines(symbol, interval, batchStart, batchEnd, batchSize, marketType));
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
            promises.push(dataService.fetchBinanceKlines(symbol, newInterval, batchStart, batchEnd, batchSize, marketType));
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

  // ========== 时间回放控制 ==========
  const startPlayback = () => {
    if (fullData.length === 0) {
      alert('请先加载K线数据');
      return;
    }

    // 计算回放起始位置：目标时间前20根K线（至少显示20根）
    const startPos = Math.max(20, targetIndex - 20);

    // 如果还没开始回放，初始化到起始位置
    if (playbackPosition === 0 || playbackPosition < startPos) {
      setPlaybackPosition(startPos);
    }

    setIsPlaying(true);
  };

  const pausePlayback = () => {
    setIsPlaying(false);
  };

  const resetPlayback = () => {
    setIsPlaying(false);
    // 重置到目标时间前20根K线
    const startPos = Math.max(20, targetIndex - 20);
    setPlaybackPosition(startPos);
  };

  const handlePlaybackSpeedChange = (speed) => {
    setPlaybackSpeed(speed);
  };

  const handlePlaybackPositionChange = (position) => {
    const startPos = Math.max(20, targetIndex - 20);
    const newPosition = Math.max(startPos, Math.min(position, fullData.length));
    setPlaybackPosition(newPosition);
  };

  // 回放自动前进
  useEffect(() => {
    if (isPlaying && fullData.length > 0) {
      playbackIntervalRef.current = setInterval(() => {
        setPlaybackPosition(prev => {
          const next = prev + 1;
          if (next >= fullData.length) {
            setIsPlaying(false);
            return fullData.length;
          }
          return next;
        });
      }, 1000 / playbackSpeed); // 根据速度调整间隔
    } else {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current);
        playbackIntervalRef.current = null;
      }
    }

    return () => {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current);
      }
    };
  }, [isPlaying, playbackSpeed, fullData.length]);

  // 回放位置变化时更新图表
  useEffect(() => {
    const startPos = Math.max(20, targetIndex - 20);
    if (fullData.length > 0 && playbackPosition >= startPos && chartRef.current && seriesRef.current.candle) {

      const isFirstTime = playbackPosition === startPos;
      const isContinuous = playbackPosition === lastPlaybackPosRef.current + 1;
      const isJump = !isFirstTime && !isContinuous;

      // 第一次回放 或 跳跃（用户拖动进度条）：重新初始化所有数据
      if (isFirstTime || isJump) {
        const currentData = fullData.slice(0, playbackPosition);

        const candles = currentData.map(d => ({
          time: Math.floor(d.time / 1000),
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close
        }));

        const volumes = candles.map(c => ({
          time: c.time,
          value: currentData.find(d => Math.floor(d.time / 1000) === c.time)?.volume || 0,
          color: c.close >= c.open ? 'rgba(76,175,80,0.5)' : 'rgba(255,82,82,0.5)'
        }));

        seriesRef.current.candle.setData(candles);
        seriesRef.current.volume.setData(volumes);
        updateIndicators(candles);

        // 初始视口：显示最后20根K线
        const viewportSize = 20;
        if (candles.length >= viewportSize) {
          const from = candles[candles.length - viewportSize].time;
          const to = candles[candles.length - 1].time;
          chartRef.current.timeScale().setVisibleRange({ from, to });
        }
      }
      // 连续回放：重新设置所有数据，但使用滚动视口
      else if (isContinuous) {
        const currentData = fullData.slice(0, playbackPosition);

        const candles = currentData.map(d => ({
          time: Math.floor(d.time / 1000),
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close
        }));

        const volumes = candles.map(c => ({
          time: c.time,
          value: currentData.find(d => Math.floor(d.time / 1000) === c.time)?.volume || 0,
          color: c.close >= c.open ? 'rgba(76,175,80,0.5)' : 'rgba(255,82,82,0.5)'
        }));

        // 计算滚动视口：显示最后20根K线
        const viewportSize = 20;
        const viewStart = Math.max(0, candles.length - viewportSize);
        const from = candles[viewStart].time;
        const to = candles[candles.length - 1].time;

        // 先设置视口
        chartRef.current.timeScale().setVisibleRange({ from, to });

        // 再设置数据
        seriesRef.current.candle.setData(candles);
        seriesRef.current.volume.setData(volumes);

        // 暂时不更新技术指标，减少重绘
        // updateIndicators(candles);

        // 确保视口不变
        requestAnimationFrame(() => {
          if (chartRef.current) {
            chartRef.current.timeScale().setVisibleRange({ from, to });
          }
        });
      }

      // 记录当前位置
      lastPlaybackPosRef.current = playbackPosition;
    }
  }, [playbackPosition, fullData, targetIndex]);

  // ========== 渲染图表数据（内部函数）==========
  const renderChartData = (data, isPlaybackMode = true) => {
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

    // 根据价格范围动态设置精度
    const prices = candles.map(c => c.close);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const avgPrice = (minPrice + maxPrice) / 2;

    let precision = 2;
    if (avgPrice >= 1000) {
      precision = 2;
    } else if (avgPrice >= 1) {
      precision = Math.min(8, Math.max(2, -Math.floor(Math.log10(avgPrice)) + 3));
    } else if (avgPrice > 0) {
      precision = Math.min(8, Math.ceil(-Math.log10(avgPrice)) + 2);
    }

    // 应用价格格式
    seriesRef.current.candle.applyOptions({
      priceFormat: {
        type: 'price',
        precision: precision,
        minMove: Math.pow(10, -precision)
      }
    });

    // 在回放模式下，先设置固定视图范围，再设置数据
    if (isPlaybackMode && candles.length > 0 && fullData.length > 0 && targetIndex > 0) {
      // 固定视图范围：以目标时间为中心的150根K线的时间范围
      // 这个范围在整个回放过程中保持不变
      const viewStart = Math.max(0, targetIndex - 75);
      const viewEnd = Math.min(fullData.length - 1, targetIndex + 75);

      // 使用完整数据的时间范围（固定不变）
      const from = Math.floor(fullData[viewStart].time / 1000);
      const to = Math.floor(fullData[viewEnd].time / 1000);

      // 先设置视图范围
      chartRef.current.timeScale().setVisibleRange({ from, to });

      // 禁用自动缩放
      chartRef.current.timeScale().applyOptions({
        lockVisibleTimeRangeOnResize: true
      });
    }

    // 设置K线和成交量
    seriesRef.current.candle.setData(candles);
    seriesRef.current.volume.setData(volumes);

    // 设置技术指标
    updateIndicators(candles);

    // 回放模式：设置数据后再次确保视图范围不变
    if (isPlaybackMode && candles.length > 0 && fullData.length > 0 && targetIndex > 0) {
      const viewStart = Math.max(0, targetIndex - 75);
      const viewEnd = Math.min(fullData.length - 1, targetIndex + 75);
      const from = Math.floor(fullData[viewStart].time / 1000);
      const to = Math.floor(fullData[viewEnd].time / 1000);

      // 强制设置视图范围（在 setData 之后）
      setTimeout(() => {
        chartRef.current.timeScale().setVisibleRange({ from, to });
      }, 0);
    } else {
      // 正常模式：自动滚动到最新位置
      if (candles.length > 0) {
        const lastCandle = candles[candles.length - 1];
        const startIdx = Math.max(0, candles.length - 100);
        const from = candles[startIdx].time;
        const to = lastCandle.time;
        chartRef.current.timeScale().setVisibleRange({ from, to });
      }
    }
  };

  // ========== 渲染图表 ==========
  const renderChart = (data, targetPrice = price, targetTime = time) => {
    // 保存完整数据用于回放
    setFullData(data);
    setPlaybackPosition(0);
    setIsPlaying(false);

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

    // 根据价格范围动态设置精度
    const prices = candles.map(c => c.close);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const avgPrice = (minPrice + maxPrice) / 2;

    let precision = 2;
    if (avgPrice >= 1000) {
      precision = 2;
    } else if (avgPrice >= 1) {
      precision = Math.min(8, Math.max(2, -Math.floor(Math.log10(avgPrice)) + 3));
    } else if (avgPrice > 0) {
      precision = Math.min(8, Math.ceil(-Math.log10(avgPrice)) + 2);
    }

    // 应用价格格式
    seriesRef.current.candle.applyOptions({
      priceFormat: {
        type: 'price',
        precision: precision,
        minMove: Math.pow(10, -precision)
      }
    });

    // 设置K线和成交量
    seriesRef.current.candle.setData(candles);
    seriesRef.current.volume.setData(volumes);

    // 设置技术指标
    updateIndicators(candles);

    // 添加价格线
    addPriceLine(parseFloat(targetPrice));

    // 定位到目标时间
    const targetDate = new Date(targetTime);
    const targetTimestamp = Math.floor(targetDate.getTime() / 1000);

    let nearest = null;
    let minDiff = Infinity;
    for (const c of candles) {
      const diff = Math.abs(c.time - targetTimestamp);
      if (diff < minDiff) {
        minDiff = diff;
        nearest = c;
      }
    }

    if (nearest) {
      // 初始化 markers，只包含发布时间标记
      markersRef.current = [{
        time: nearest.time,
        position: 'belowBar',
        color: 'blue',
        shape: 'arrowUp',
        text: '发布时间',
        size: 3
      }];
      seriesRef.current.candle.setMarkers(markersRef.current);

      const idx = candles.findIndex(c => c.time === nearest.time);

      // 保存目标索引用于回放
      setTargetIndex(idx);

      const from = candles[Math.max(0, idx - 80)].time;
      const to = candles[Math.min(candles.length - 1, idx + 80)].time;
      chartRef.current.timeScale().setVisibleRange({ from, to });
    }
  };

  // ========== 更新技术指标 ==========
  const updateIndicators = (candles) => {
    const { ma5, ma10, ma20, ma60, ema21, ema55, ema100, ema200, bb, macd } = indicators;

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

    // MACD
    if (macd.show && seriesRef.current.macdLine && seriesRef.current.macdSignal && seriesRef.current.macdHistogram) {
      const macdData = calculateMACD(candles, macd.fastPeriod, macd.slowPeriod, macd.signalPeriod);
      seriesRef.current.macdLine.setData(macdData.macd);
      seriesRef.current.macdSignal.setData(macdData.signal);
      seriesRef.current.macdHistogram.setData(macdData.histogram);
      seriesRef.current.macdLine.applyOptions({ visible: true });
      seriesRef.current.macdSignal.applyOptions({ visible: true });
      seriesRef.current.macdHistogram.applyOptions({ visible: true });
    } else if (seriesRef.current.macdLine && seriesRef.current.macdSignal && seriesRef.current.macdHistogram) {
      seriesRef.current.macdLine.applyOptions({ visible: false });
      seriesRef.current.macdSignal.applyOptions({ visible: false });
      seriesRef.current.macdHistogram.applyOptions({ visible: false });
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

  // ========== 交易对自动补全 ==========
  const handleSymbolBlur = () => {
    if (!symbol) return;

    // 先去除前后空格
    const trimmedSymbol = symbol.trim().toUpperCase();

    if (!trimmedSymbol.endsWith('USDT')) {
      setSymbol(trimmedSymbol + 'USDT');
    } else {
      setSymbol(trimmedSymbol);
    }
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

  // 排序函数
  const sortHistoryList = (list, sortMethod = sortType) => {
    const sorted = [...list];
    switch (sortMethod) {
      case 'time-desc':
        sorted.sort((a, b) => new Date(b.time) - new Date(a.time));
        break;
      case 'time-asc':
        sorted.sort((a, b) => new Date(a.time) - new Date(b.time));
        break;
      case 'name-asc':
        sorted.sort((a, b) => a.symbol.localeCompare(b.symbol));
        break;
      case 'name-desc':
        sorted.sort((a, b) => b.symbol.localeCompare(a.symbol));
        break;
      default:
        sorted.sort((a, b) => new Date(b.time) - new Date(a.time));
    }
    return sorted;
  };

  const saveToHistory = () => {
    if (!symbol || !time || !price) {
      alert('请输入完整参数');
      return;
    }

    const record = { symbol, time, interval, price, zoneType };

    // 检查是否存在相同币种+相同时间的记录
    const existingIndex = history.findIndex(
      item => item.symbol === symbol && item.time === time
    );

    let newHistory;
    if (existingIndex !== -1) {
      // 存在相同记录，更新它
      newHistory = [...history];
      newHistory[existingIndex] = record;
      alert('已更新观察列表中的记录');
    } else {
      // 不存在，添加新记录
      newHistory = [record, ...history];
      alert('已保存到观察列表');
    }

    // 根据当前排序方式自动排序
    newHistory = sortHistoryList(newHistory);

    localStorage.setItem('searchHistory', JSON.stringify(newHistory));
    setHistory(newHistory);
    setFilteredHistory(newHistory);
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

    // 使用排序函数
    filtered = sortHistoryList(filtered);

    setFilteredHistory(filtered);
  };

  const resetFilter = () => {
    setFilterSymbol('');
    setFilterStart('');
    setFilterEnd('');
    setSortType('time-desc');
    // 重置后按时间倒序排序
    const sorted = sortHistoryList(history, 'time-desc');
    setFilteredHistory(sorted);
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
          promises.push(dataService.fetchBinanceKlines(item.symbol, item.interval, batchStart, batchEnd, batchSize, 'futures'));
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
      renderChart(data, item.price, item.time);
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
    const updatedItem = {
      ...updatedHistory[historyIdx],
      time: editForm.time,
      price: editForm.price,
      zoneType: editForm.zoneType
    };
    updatedHistory[historyIdx] = updatedItem;

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

    // 如果编辑的是当前正在查看的记录，更新状态并重新渲染图表
    if (symbol === originalItem.symbol &&
        time === originalItem.time &&
        interval === originalItem.interval) {
      setTime(updatedItem.time);
      setPrice(updatedItem.price);
      setZoneType(updatedItem.zoneType);

      // 如果图表已经加载（fullData存在），重新渲染图表
      if (fullData && fullData.length > 0) {
        renderChart(fullData, updatedItem.price, updatedItem.time);
      }
    }
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
      markersRef.current = [...markersRef.current, {
        time: Math.floor(selectedPoint.time / 1000),
        position: 'belowBar',
        color: '#26a69a',
        shape: 'arrowUp',
        text: 'Long',
        size: 2
      }];
      seriesRef.current.candle.setMarkers(markersRef.current);
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
      markersRef.current = [...markersRef.current, {
        time: Math.floor(selectedPoint.time / 1000),
        position: 'aboveBar',
        color: '#ef5350',
        shape: 'arrowDown',
        text: 'Short',
        size: 2
      }];
      seriesRef.current.candle.setMarkers(markersRef.current);
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
      markersRef.current = [...markersRef.current, {
        time: Math.floor(selectedPoint.time / 1000),
        position: positionState.currentPosition.type === 'long' ? 'belowBar' : 'aboveBar',
        color: positionState.currentPosition.type === 'long' ? '#26a69a' : '#ef5350',
        shape: 'circle',
        text: 'Add',
        size: 1
      }];
      seriesRef.current.candle.setMarkers(markersRef.current);
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
      markersRef.current = [...markersRef.current, {
        time: Math.floor(selectedPoint.time / 1000),
        position: positionState.currentPosition.type === 'long' ? 'aboveBar' : 'belowBar',
        color: '#ff9800',
        shape: 'circle',
        text: 'Reduce',
        size: 1
      }];
      seriesRef.current.candle.setMarkers(markersRef.current);
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
      markersRef.current = [...markersRef.current, {
        time: Math.floor(selectedPoint.time / 1000),
        position: posType === 'long' ? 'aboveBar' : 'belowBar',
        color: '#9e9e9e',
        shape: 'square',
        text: 'Close',
        size: 2
      }];
      seriesRef.current.candle.setMarkers(markersRef.current);
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
      {/* 顶部标题栏 */}
      <div className="app-header">
        <h1>潜力区币回测工具</h1>
        {version === 'local' && <span className="version-badge">本地版</span>}
      </div>

      {/* 搜索面板 */}
      <div className="search-panel">
        <div className="search-section">
          <h3>交易设置</h3>
          <div className="search-row">
            <div className="input-group">
              <label>交易对</label>
              <input
                value={symbol}
                onChange={e => setSymbol(e.target.value)}
                onBlur={handleSymbolBlur}
                placeholder="如: BTC 或 BTCUSDT"
              />
            </div>
            <div className="input-group">
              <label>时间</label>
              <input
                type="datetime-local"
                value={time}
                onChange={e => setTime(e.target.value)}
              />
            </div>
            <div className="input-group">
              <label>价格</label>
              <input
                type="number"
                step="any"
                value={price}
                onChange={e => setPrice(e.target.value)}
                placeholder="目标价格"
              />
            </div>
          </div>
          <div className="search-row">
            <div className="input-group">
              <label>周期</label>
              <select value={interval} onChange={e => handleIntervalChange(e.target.value)}>
                <option value="3m">3分钟</option>
                <option value="1m">1分钟</option>
                <option value="5m">5分钟</option>
                <option value="15m">15分钟</option>
                <option value="30m">30分钟</option>
                <option value="1h">1小时</option>
                <option value="4h">4小时</option>
                <option value="1d">1天</option>
              </select>
            </div>
            <div className="input-group">
              <label>区域类型</label>
              <select value={zoneType} onChange={e => setZoneType(e.target.value)}>
                <option value="bottom">兜底区 📈</option>
                <option value="top">探顶区 📉</option>
              </select>
            </div>
          </div>
        </div>

        <div className="action-buttons">
          <button className="btn-primary" onClick={loadKlineData} disabled={loading}>
            {loading ? '⏳ 加载中...' : '🔍 搜索'}
          </button>
          <button className="btn-secondary" onClick={saveToHistory}>
            💾 保存查询
          </button>
          <button className="btn-secondary" onClick={() => setShowIndicators(!showIndicators)}>
            📊 技术指标 {showIndicators ? '▲' : '▼'}
          </button>
        </div>
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

          {/* MACD */}
          <div className="indicator-group">
            <h4>MACD - 指数平滑移动平均线</h4>
            <div className="indicator-row">
              <label>
                <input
                  type="checkbox"
                  checked={indicators.macd.show}
                  onChange={(e) => setIndicators({ ...indicators, macd: { ...indicators.macd, show: e.target.checked } })}
                />
                显示MACD
              </label>
              <label>
                快线周期:
                <input
                  type="number"
                  min="1"
                  style={{ width: '50px' }}
                  value={indicators.macd.fastPeriod}
                  onChange={(e) => setIndicators({ ...indicators, macd: { ...indicators.macd, fastPeriod: parseInt(e.target.value) || 12 } })}
                />
              </label>
              <label>
                慢线周期:
                <input
                  type="number"
                  min="1"
                  style={{ width: '50px' }}
                  value={indicators.macd.slowPeriod}
                  onChange={(e) => setIndicators({ ...indicators, macd: { ...indicators.macd, slowPeriod: parseInt(e.target.value) || 26 } })}
                />
              </label>
              <label>
                信号线周期:
                <input
                  type="number"
                  min="1"
                  style={{ width: '50px' }}
                  value={indicators.macd.signalPeriod}
                  onChange={(e) => setIndicators({ ...indicators, macd: { ...indicators.macd, signalPeriod: parseInt(e.target.value) || 9 } })}
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
          <div
            ref={macdContainerRef}
            className="macd-chart"
            style={{ visibility: indicators.macd.show ? 'visible' : 'hidden' }}
          />
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
            <span><i style={{ background: '#000000' }}></i>EMA200</span>
            <strong style={{ marginLeft: '15px' }}>BB:</strong>
            <span><i style={{ background: '#2196f3' }}></i>布林带</span>
            <strong style={{ marginLeft: '15px' }}>MACD:</strong>
            <span><i style={{ background: '#2962FF' }}></i>MACD</span>
            <span><i style={{ background: '#FF6D00' }}></i>Signal</span>
          </div>

          {/* 时间回放控制面板 */}
          {fullData.length > 0 && (
            <div className="playback-panel">
              <div className="playback-controls">
                <button
                  className="playback-btn"
                  onClick={isPlaying ? pausePlayback : startPlayback}
                  title={isPlaying ? '暂停' : '播放'}
                >
                  {isPlaying ? '⏸' : '▶'}
                </button>
                <button
                  className="playback-btn"
                  onClick={resetPlayback}
                  title="重置到开始"
                >
                  ⏮
                </button>
                <div className="playback-info">
                  <span>{playbackPosition} / {fullData.length}</span>
                </div>
                <div className="speed-control">
                  <label>速度:</label>
                  <select
                    value={playbackSpeed}
                    onChange={(e) => handlePlaybackSpeedChange(parseFloat(e.target.value))}
                  >
                    <option value={0.5}>0.5x</option>
                    <option value={1}>1x</option>
                    <option value={2}>2x</option>
                    <option value={5}>5x</option>
                    <option value={10}>10x</option>
                  </select>
                </div>
              </div>
              <div className="playback-slider">
                <input
                  type="range"
                  min={Math.max(20, targetIndex - 20)}
                  max={fullData.length}
                  value={playbackPosition}
                  onChange={(e) => handlePlaybackPositionChange(parseInt(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
          )}
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
              <label>
                排序方式
                <select
                  value={sortType}
                  onChange={(e) => setSortType(e.target.value)}
                >
                  <option value="time-desc">时间倒序（最新在前）</option>
                  <option value="time-asc">时间正序（最旧在前）</option>
                  <option value="name-asc">名称正序（A-Z）</option>
                  <option value="name-desc">名称倒序（Z-A）</option>
                </select>
              </label>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button onClick={applyFilter}>筛选</button>
                <button onClick={resetFilter}>重置</button>
              </div>
            </div>

            {/* 历史记录列表 */}
            <div>
              {filteredHistory.map((item, idx) => {
                // 统计当前币种在列表中出现的次数
                const symbolCount = filteredHistory.filter(h => h.symbol === item.symbol).length;
                // 如果出现多次，添加背景色
                const isDuplicate = symbolCount > 1;
                const backgroundColor = isDuplicate ? 'rgba(255, 193, 7, 0.1)' : 'transparent';

                return (
                  <div
                    key={idx}
                    className={`history-item ${item.zoneType}-zone`}
                    style={{
                      cursor: editingIndex === idx ? 'default' : 'pointer',
                      backgroundColor: backgroundColor
                    }}
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
                        <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span>{item.symbol} - {item.zoneType === 'bottom' ? '兜底区' : '探顶区'}</span>
                          {isDuplicate && (
                            <span style={{
                              fontSize: '9px',
                              padding: '1px 4px',
                              borderRadius: '3px',
                              backgroundColor: '#ff9800',
                              color: 'white',
                              fontWeight: 'normal'
                            }}>
                              ×{symbolCount}
                            </span>
                          )}
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
                );
              })}
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
        <button className="btn-secondary" onClick={() => setShowBacktest(!showBacktest)}>
          💼 Position 持仓工具 {showBacktest ? '▲' : '▼'}
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
                  价值 (USDT): <input
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
                  <span>持仓价值:</span>
                  <strong>{(positionState.currentPosition.quantity * positionState.currentPosition.avgPrice).toFixed(2)} USDT</strong>
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
                      <div>价值: {(trade.quantity * trade.entryPrice).toFixed(2)} USDT |
                        <span className={trade.pnl >= 0 ? 'profit' : 'loss'} style={{ fontWeight: 'bold' }}>
                          盈亏: {trade.pnl.toFixed(2)} USDT
                        </span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#666' }}>
                        {new Date(trade.closeTime).toLocaleString('zh-CN', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                          hour12: false
                        })}
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
        数据来源：币安合约市场（Binance Futures）公共API，直接从浏览器调用。
      </div>
    </div>
  );
}
