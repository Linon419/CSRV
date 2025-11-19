import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createChart } from 'lightweight-charts';
import {
  movingAverage,
  exponentialMovingAverage,
  bollingerBands,
  calculateMACD,
  calculateFractals,
  intervalToMs
} from '../services/indicators';
import {
  createPositionState,
  openPosition,
  reducePosition,
  closePosition,
  setStopLoss,
  setTakeProfit,
  setLeverage,
  reducePositionByPercent,
  addPositionByPercent,
  calculateUnrealizedPnL,
  calculateTotalStats,
  createPositionLineConfig,
  createStopLossLineConfig,
  createTakeProfitLineConfig,
  exportTradingHistory
} from '../services/position';
import '../styles/global.css';

/**
 * 将 UTC 时间戳转换为本地时区显示（LightweightCharts 官方推荐方法）
 * 参考：https://tradingview.github.io/lightweight-charts/docs/time-zones
 * @param {number} originalTime - UTC 时间戳（秒）
 * @returns {number} 转换后的时间戳（秒），用于本地时区显示
 */
function timeToLocal(originalTime) {
  const d = new Date(originalTime * 1000);
  return Date.UTC(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
    d.getMilliseconds()
  ) / 1000;
}

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
    macd: { show: false, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
    fractals: { show: false, showLine: true, showMarkers: true }
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
  const [usePercent, setUsePercent] = useState(false); // 是否使用百分比模式
  const [percentInput, setPercentInput] = useState(25); // 百分比输入（默认25%）

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
  const [selectedHistoryIndex, setSelectedHistoryIndex] = useState(null); // 选中的历史记录索引

  // 管理员登录状态（仅Cloudflare版本使用）
  const [isAdmin, setIsAdmin] = useState(() => {
    if (version === 'cloudflare') {
      return localStorage.getItem('isAdmin') === 'true';
    }
    return false;
  });
  const [adminPassword, setAdminPassword] = useState(() => {
    if (version === 'cloudflare') {
      return localStorage.getItem('adminPassword') || '';
    }
    return '';
  });
  const [showLoginDialog, setShowLoginDialog] = useState(false);

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
        secondsVisible: false,
        // 自定义X轴刻度标签格式化
        tickMarkFormatter: (time) => {
          const date = new Date(time * 1000);
          const month = String(date.getUTCMonth() + 1).padStart(2, '0');
          const day = String(date.getUTCDate()).padStart(2, '0');
          const hours = String(date.getUTCHours()).padStart(2, '0');
          const minutes = String(date.getUTCMinutes()).padStart(2, '0');
          return `${month}-${day} ${hours}:${minutes}`;
        }
      },
      localization: {
        timeFormatter: (timestamp) => {
          // timestamp 已通过 timeToLocal 转换，使用 UTC 方法来格式化显示本地时间
          const date = new Date(timestamp * 1000);
          const month = String(date.getUTCMonth() + 1).padStart(2, '0');
          const day = String(date.getUTCDate()).padStart(2, '0');
          const hours = String(date.getUTCHours()).padStart(2, '0');
          const minutes = String(date.getUTCMinutes()).padStart(2, '0');
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
    const ma5 = chart.addLineSeries({
      color: 'orange',
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false
    });
    const ma10 = chart.addLineSeries({
      color: 'gold',
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false
    });
    const ma20 = chart.addLineSeries({
      color: 'blue',
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false
    });
    const ma60 = chart.addLineSeries({
      color: 'purple',
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false
    });

    // 创建EMA系列
    const ema21 = chart.addLineSeries({
      color: '#00bcd4',
      lineWidth: 1,
      visible: false,
      lastValueVisible: false,
      priceLineVisible: false
    });
    const ema55 = chart.addLineSeries({
      color: '#ff9800',
      lineWidth: 1,
      visible: false,
      lastValueVisible: false,
      priceLineVisible: false
    });
    const ema100 = chart.addLineSeries({
      color: '#e91e63',
      lineWidth: 1,
      visible: false,
      lastValueVisible: false,
      priceLineVisible: false
    });
    const ema200 = chart.addLineSeries({
      color: '#000000',
      lineWidth: 1,
      visible: false,
      lastValueVisible: false,
      priceLineVisible: false
    });

    // 创建布林带系列
    const bbUpper = chart.addLineSeries({
      color: '#2196f3',
      lineWidth: 1,
      lineStyle: 2,
      visible: false,
      lastValueVisible: false,
      priceLineVisible: false
    });
    const bbMiddle = chart.addLineSeries({
      color: '#2196f3',
      lineWidth: 1,
      visible: false,
      lastValueVisible: false,
      priceLineVisible: false
    });
    const bbLower = chart.addLineSeries({
      color: '#2196f3',
      lineWidth: 1,
      lineStyle: 2,
      visible: false,
      lastValueVisible: false,
      priceLineVisible: false
    });

    // 创建分形系列
    const fractalLine = chart.addLineSeries({
      color: '#9c27b0',
      lineWidth: 2,
      visible: false,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 5
    });

    // 图表点击事件
    chart.subscribeClick((param) => {
      if (!param.point || !param.time) return;

      // 只从K线系列获取价格数据，忽略均线等其他系列
      const candleData = param.seriesPrices.get(candleSeries);
      if (!candleData) return;

      // 验证K线数据的有效性
      if (typeof candleData !== 'object' || candleData.close === undefined) {
        return;
      }

      // 使用鼠标点击位置的Y坐标转换为价格，获得更精确的价格
      // coordinateToPrice 将屏幕坐标转换为价格值
      let price;
      try {
        const priceAtClick = candleSeries.coordinateToPrice(param.point.y);

        // 确保价格在该K线的范围内 (low ~ high)
        if (priceAtClick >= candleData.low && priceAtClick <= candleData.high) {
          // 使用点击位置的精确价格
          price = priceAtClick;
        } else {
          // 如果点击位置超出K线范围，使用收盘价
          price = candleData.close;
        }
      } catch (e) {
        // 如果坐标转换失败，使用收盘价
        price = candleData.close;
      }

      setSelectedPoint({
        time: param.time * 1000,
        price: price
      });
      setCurrentPrice(price);

      console.log(`Selected: ${new Date(param.time * 1000).toLocaleString()}, Price: ${price.toFixed(2)} (candlestick range: ${candleData.low.toFixed(2)} - ${candleData.high.toFixed(2)})`);
    });

    // 保存引用
    chartRef.current = chart;
    seriesRef.current = {
      candle: candleSeries,
      volume: volumeSeries,
      ma5, ma10, ma20, ma60,
      ema21, ema55, ema100, ema200,
      bbUpper, bbMiddle, bbLower,
      fractalLine
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
          visible: true,
          // 自定义X轴刻度标签格式化
          tickMarkFormatter: (time) => {
            const date = new Date(time * 1000);
            const month = String(date.getUTCMonth() + 1).padStart(2, '0');
            const day = String(date.getUTCDate()).padStart(2, '0');
            const hours = String(date.getUTCHours()).padStart(2, '0');
            const minutes = String(date.getUTCMinutes()).padStart(2, '0');
            return `${month}-${day} ${hours}:${minutes}`;
          }
        },
        localization: {
          timeFormatter: (timestamp) => {
            // timestamp 已通过 timeToLocal 转换，使用 UTC 方法格式化
            const date = new Date(timestamp * 1000);
            const month = String(date.getUTCMonth() + 1).padStart(2, '0');
            const day = String(date.getUTCDate()).padStart(2, '0');
            const hours = String(date.getUTCHours()).padStart(2, '0');
            const minutes = String(date.getUTCMinutes()).padStart(2, '0');
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
        lastValueVisible: false,
        priceLineVisible: false
      });
      const macdSignal = macdChart.addLineSeries({
        color: '#FF6D00',
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false
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
      // 根据时间间隔调整时间范围，避免数据量过大
      let beforeHours, afterHours;
      if (interval === '1m') {
        beforeHours = 6; afterHours = 12;  // 1min: 18小时 (1080根K线)
      } else if (interval === '3m') {
        beforeHours = 8; afterHours = 16;  // 3min: 24小时 (480根K线)
      } else {
        beforeHours = 24; afterHours = 48; // 其他: 72小时
      }
      const dayStart = targetDate.getTime() - beforeHours * 60 * 60 * 1000;
      const nextDayEnd = targetDate.getTime() + afterHours * 60 * 60 * 1000;

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
        // 根据时间间隔调整时间范围，避免数据量过大
        let beforeHours, afterHours;
        if (newInterval === '1m') {
          beforeHours = 6; afterHours = 12;  // 1min: 18小时 (1080根K线)
        } else if (newInterval === '3m') {
          beforeHours = 8; afterHours = 16;  // 3min: 24小时 (480根K线)
        } else {
          beforeHours = 24; afterHours = 48; // 其他: 72小时
        }
        const dayStart = targetDate.getTime() - beforeHours * 60 * 60 * 1000;
        const nextDayEnd = targetDate.getTime() + afterHours * 60 * 60 * 1000;

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
          time: timeToLocal(Math.floor(d.time / 1000)),
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close
        }));

        const volumes = candles.map((c, index) => ({
          time: c.time,
          value: currentData[index]?.volume || 0,
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
          time: timeToLocal(Math.floor(d.time / 1000)),
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close
        }));

        const volumes = candles.map((c, index) => ({
          time: c.time,
          value: currentData[index]?.volume || 0,
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
      time: timeToLocal(Math.floor(d.time / 1000)),
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close
    }));

    const volumes = candles.map((c, index) => ({
      time: c.time,
      value: data[index]?.volume || 0,
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
      time: timeToLocal(Math.floor(d.time / 1000)),
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close
    }));

    const volumes = candles.map((c, index) => ({
      time: c.time,
      value: data[index]?.volume || 0,
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
    const targetTimestamp = timeToLocal(Math.floor(targetDate.getTime() / 1000));

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

    // 分形指标
    if (indicators.fractals?.show) {
      const fractalData = calculateFractals(candles);

      // 绘制分形折线
      if (indicators.fractals.showLine && fractalData.fractalLine.length > 0) {
        seriesRef.current.fractalLine.setData(fractalData.fractalLine);
        seriesRef.current.fractalLine.applyOptions({ visible: true });
      } else {
        seriesRef.current.fractalLine.applyOptions({ visible: false });
      }

      // 在K线图上添加分形标记
      if (indicators.fractals.showMarkers) {
        const markers = [];

        // 上分形标记（阻力位）
        fractalData.upFractals.forEach(f => {
          markers.push({
            time: f.time,
            position: 'aboveBar',
            color: '#f44336',
            shape: 'arrowDown',
            text: '▼'
          });
        });

        // 下分形标记（支撑位）
        fractalData.downFractals.forEach(f => {
          markers.push({
            time: f.time,
            position: 'belowBar',
            color: '#4caf50',
            shape: 'arrowUp',
            text: '▲'
          });
        });

        seriesRef.current.candle.setMarkers(markers);
      } else {
        seriesRef.current.candle.setMarkers([]);
      }
    } else {
      seriesRef.current.fractalLine.applyOptions({ visible: false });
      seriesRef.current.candle.setMarkers([]);
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

  // ========== 管理员登录管理 ==========
  const handleAdminLogin = async (password) => {
    if (!password) {
      alert('请输入密码');
      return false;
    }

    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      const result = await response.json();

      if (result.success) {
        setIsAdmin(true);
        setAdminPassword(password);
        localStorage.setItem('isAdmin', 'true');
        localStorage.setItem('adminPassword', password);
        setShowLoginDialog(false);
        alert('登录成功！现在可以操作云端数据库了');
        // 重新加载数据（切换到数据库数据）
        await loadHistory();
        return true;
      } else {
        alert(result.error || '登录失败');
        return false;
      }
    } catch (error) {
      console.error('登录失败:', error);
      alert('登录失败: ' + error.message);
      return false;
    }
  };

  const handleAdminLogout = () => {
    setIsAdmin(false);
    setAdminPassword('');
    localStorage.removeItem('isAdmin');
    localStorage.removeItem('adminPassword');
    alert('已退出管理员登录');
    // 重新加载数据（切换到本地数据）
    loadHistory();
  };

  // ========== 历史记录管理 ==========
  const loadHistory = async () => {
    // Cloudflare版本：根据管理员状态选择数据源
    if (version === 'cloudflare' && dataService.getWatchlist) {
      // 管理员模式：从数据库加载
      if (isAdmin && adminPassword) {
        try {
          const watchlist = await dataService.getWatchlist();
          setHistory(watchlist);
          setFilteredHistory(watchlist);
          console.log(`从数据库加载了 ${watchlist.length} 条观察记录`);
        } catch (error) {
          console.error('加载观察列表失败:', error);
          alert('加载观察列表失败，请检查网络连接');
        }
        return;
      }
      // 游客模式：从localStorage加载（继续下面的逻辑）
    }

    // 本地版本或游客模式：从localStorage加载
    const saved = localStorage.getItem('searchHistory');
    if (saved) {
      const historyData = JSON.parse(saved);
      setHistory(historyData);
      setFilteredHistory(historyData);
      if (version === 'cloudflare') {
        console.log(`从浏览器本地加载了 ${historyData.length} 条观察记录（游客模式）`);
      }
    } else {
      setHistory([]);
      setFilteredHistory([]);
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
      case 'count-desc':
        // 按出现次数排序（次数多的在前）
        {
          const symbolCount = {};
          list.forEach(item => {
            symbolCount[item.symbol] = (symbolCount[item.symbol] || 0) + 1;
          });
          sorted.sort((a, b) => {
            const countDiff = symbolCount[b.symbol] - symbolCount[a.symbol];
            if (countDiff !== 0) return countDiff;
            // 次数相同时，按时间倒序
            return new Date(b.time) - new Date(a.time);
          });
        }
        break;
      case 'count-asc':
        // 按出现次数排序（次数少的在前）
        {
          const symbolCount = {};
          list.forEach(item => {
            symbolCount[item.symbol] = (symbolCount[item.symbol] || 0) + 1;
          });
          sorted.sort((a, b) => {
            const countDiff = symbolCount[a.symbol] - symbolCount[b.symbol];
            if (countDiff !== 0) return countDiff;
            // 次数相同时，按时间倒序
            return new Date(b.time) - new Date(a.time);
          });
        }
        break;
      default:
        sorted.sort((a, b) => new Date(b.time) - new Date(a.time));
    }
    return sorted;
  };

  const saveToHistory = async () => {
    if (!symbol || !time || !price) {
      alert('请输入完整参数');
      return;
    }

    // 确保 zoneType 有有效值，如果是 undefined 则默认为 'bottom'
    const finalZoneType = zoneType || 'bottom';
    console.log('保存记录 - 当前 zoneType:', zoneType, '最终使用:', finalZoneType); // 调试日志
    const record = { symbol, time, interval, price, zoneType: finalZoneType };
    console.log('保存的记录对象:', record); // 调试日志

    // Cloudflare版本：根据管理员状态选择保存位置
    if (version === 'cloudflare' && dataService.saveWatchlistItem) {
      // 管理员模式：保存到数据库
      if (isAdmin && adminPassword) {
        try {
          const result = await dataService.saveWatchlistItem(record, adminPassword);
          if (result.success) {
            // 重新加载列表
            await loadHistory();
            alert(result.action === 'updated' ? '已更新数据库中的记录' : '已保存到数据库');
          }
        } catch (error) {
          console.error('保存失败:', error);
          alert(error.message || '保存失败，请检查网络连接或管理员密码');
        }
        return;
      } else {
        // 游客模式：提示需要登录才能保存到数据库，或保存到本地
        alert('游客模式下数据仅保存在浏览器本地\n登录管理员账号可保存到云端数据库');
        // 继续执行下面的本地保存逻辑
      }
    }

    // 本地版本：使用localStorage保存
    // 检查是否存在相同币种+相同时间的记录
    const existingIndex = history.findIndex(
      item => item.symbol === symbol && item.time === time
    );

    let newHistory;
    let isNewRecord = false;
    if (existingIndex !== -1) {
      // 存在相同记录，更新它
      newHistory = [...history];
      newHistory[existingIndex] = record;
      alert('已更新观察列表中的记录');
    } else {
      // 不存在，添加新记录
      newHistory = [record, ...history];
      isNewRecord = true;
      alert('已保存到观察列表');
    }

    // 根据当前排序方式自动排序
    newHistory = sortHistoryList(newHistory);

    localStorage.setItem('searchHistory', JSON.stringify(newHistory));
    setHistory(newHistory);
    setFilteredHistory(newHistory);

    // 备份提醒：每10条新记录提醒一次（仅本地版本）
    if (isNewRecord && newHistory.length % 10 === 0 && newHistory.length > 0) {
      const lastBackupReminder = localStorage.getItem('lastBackupReminder');
      const now = Date.now();
      // 每24小时最多提醒一次
      if (!lastBackupReminder || now - parseInt(lastBackupReminder) > 24 * 60 * 60 * 1000) {
        localStorage.setItem('lastBackupReminder', now.toString());
        setTimeout(() => {
          if (confirm(`📊 您已保存 ${newHistory.length} 条观察记录！\n\n💡 提示：观察列表仅保存在当前浏览器中\n换浏览器或清除缓存会导致数据丢失\n\n是否现在备份数据？`)) {
            exportHistory();
          }
        }, 500);
      }
    }
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
    // Cloudflare版本：不支持批量清空（数据存在云端，删除需谨慎）
    if (version === 'cloudflare') {
      alert('云端版本暂不支持批量清空功能\n如需清理数据，请单独删除记录');
      return;
    }

    // 本地版本：清空localStorage
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

  // ========== 导出图表和分形数据 ==========

  // 导出图表为PNG
  const exportChartAsPNG = () => {
    if (!chartRef.current) {
      alert('请先加载图表数据');
      return;
    }

    try {
      // 使用 lightweight-charts 的 takeScreenshot 方法
      const canvas = chartRef.current.takeScreenshot();

      canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${symbol}_${interval}_fractal_${new Date().toISOString().slice(0, 10)}.png`;
        a.click();
        URL.revokeObjectURL(url);
      });
    } catch (error) {
      console.error('导出PNG失败:', error);
      alert('导出图片失败，请重试');
    }
  };

  // 导出分形数据为CSV
  const exportFractalAsCSV = () => {
    const candles = fullData.slice(0, playbackPosition > 0 ? playbackPosition : fullData.length);
    if (candles.length === 0) {
      alert('请先加载数据');
      return;
    }

    const fractalData = calculateFractals(candles);

    // CSV 头部
    let csv = 'Type,Time,Price,DateTime\n';

    // 添加上分形（阻力位）
    fractalData.upFractals.forEach(f => {
      const dt = new Date(f.time * 1000).toLocaleString('zh-CN');
      csv += `Up Fractal (阻力),${f.time},${f.value},${dt}\n`;
    });

    // 添加下分形（支撑位）
    fractalData.downFractals.forEach(f => {
      const dt = new Date(f.time * 1000).toLocaleString('zh-CN');
      csv += `Down Fractal (支撑),${f.time},${f.value},${dt}\n`;
    });

    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${symbol}_${interval}_fractals_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 导出分形数据为JSON
  const exportFractalAsJSON = () => {
    const candles = fullData.slice(0, playbackPosition > 0 ? playbackPosition : fullData.length);
    if (candles.length === 0) {
      alert('请先加载数据');
      return;
    }

    const fractalData = calculateFractals(candles);

    const exportData = {
      symbol,
      interval,
      exportTime: new Date().toISOString(),
      klineCount: candles.length,
      fractals: {
        upFractals: fractalData.upFractals.map(f => ({
          time: f.time,
          price: f.value,
          dateTime: new Date(f.time * 1000).toISOString(),
          type: '阻力位'
        })),
        downFractals: fractalData.downFractals.map(f => ({
          time: f.time,
          price: f.value,
          dateTime: new Date(f.time * 1000).toISOString(),
          type: '支撑位'
        })),
        fractalLine: fractalData.fractalLine
      },
      klineData: candles
    };

    const data = JSON.stringify(exportData, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${symbol}_${interval}_fractal_data_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 批量导出（ZIP打包）
  const exportAll = async () => {
    const candles = fullData.slice(0, playbackPosition > 0 ? playbackPosition : fullData.length);
    if (candles.length === 0) {
      alert('请先加载数据');
      return;
    }

    if (!window.JSZip) {
      alert('正在加载压缩库，请稍后重试...');
      // 动态加载 JSZip 库
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      script.onload = () => exportAll(); // 加载完成后重新调用
      document.head.appendChild(script);
      return;
    }

    try {
      const JSZip = window.JSZip;
      const zip = new JSZip();
      const timestamp = new Date().toISOString().slice(0, 10);
      const folderName = `${symbol}_${interval}_${timestamp}`;

      // 1. 添加图表PNG
      if (chartRef.current) {
        try {
          const canvas = chartRef.current.takeScreenshot();
          const blob = await new Promise(resolve => canvas.toBlob(resolve));
          zip.file(`${folderName}/chart.png`, blob);
        } catch (e) {
          console.warn('导出PNG失败，跳过', e);
        }
      }

      // 2. 添加CSV
      const fractalData = calculateFractals(candles);
      let csv = 'Type,Time,Price,DateTime\n';
      fractalData.upFractals.forEach(f => {
        const dt = new Date(f.time * 1000).toLocaleString('zh-CN');
        csv += `Up Fractal (阻力),${f.time},${f.value},${dt}\n`;
      });
      fractalData.downFractals.forEach(f => {
        const dt = new Date(f.time * 1000).toLocaleString('zh-CN');
        csv += `Down Fractal (支撑),${f.time},${f.value},${dt}\n`;
      });
      zip.file(`${folderName}/fractals.csv`, '\ufeff' + csv);

      // 3. 添加JSON
      const exportData = {
        symbol,
        interval,
        exportTime: new Date().toISOString(),
        klineCount: candles.length,
        fractals: {
          upFractals: fractalData.upFractals.map(f => ({
            time: f.time,
            price: f.value,
            dateTime: new Date(f.time * 1000).toISOString(),
            type: '阻力位'
          })),
          downFractals: fractalData.downFractals.map(f => ({
            time: f.time,
            price: f.value,
            dateTime: new Date(f.time * 1000).toISOString(),
            type: '支撑位'
          })),
          fractalLine: fractalData.fractalLine
        },
        klineData: candles
      };
      zip.file(`${folderName}/data.json`, JSON.stringify(exportData, null, 2));

      // 生成ZIP并下载
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${folderName}.zip`;
      a.click();
      URL.revokeObjectURL(url);

      alert('导出成功！');
    } catch (error) {
      console.error('批量导出失败:', error);
      alert('导出失败: ' + error.message);
    }
  };

  const importHistory = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!Array.isArray(data)) throw new Error('文件格式错误');

        // Cloudflare版本：使用批量导入API
        if (version === 'cloudflare' && dataService.importWatchlist) {
          try {
            const result = await dataService.importWatchlist(data);
            if (result.success) {
              await loadHistory();
              alert(`导入成功！\n新增: ${result.imported} 条\n更新: ${result.updated} 条\n失败: ${result.failed} 条`);
            }
          } catch (error) {
            console.error('导入失败:', error);
            alert('导入失败: ' + error.message);
          }
          return;
        }

        // 本地版本：合并到localStorage
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

  const handleHistoryClick = async (item, index) => {
    // 设置选中的历史记录索引
    setSelectedHistoryIndex(index);

    // 先设置状态
    setSymbol(item.symbol);
    setInterval(item.interval);
    setTime(item.time);
    setPrice(item.price);
    // 如果历史记录中没有zoneType（旧数据），默认设置为bottom
    setZoneType(item.zoneType || 'bottom');

    // 直接使用item的值加载数据
    if (!item.symbol || !item.time || !item.price) return;

    setLoading(true);
    try {
      const targetDate = new Date(item.time);
      // 根据时间间隔调整时间范围，避免数据量过大
      let beforeHours, afterHours;
      if (item.interval === '1m') {
        beforeHours = 6; afterHours = 12;  // 1min: 18小时 (1080根K线)
      } else if (item.interval === '3m') {
        beforeHours = 8; afterHours = 16;  // 3min: 24小时 (480根K线)
      } else {
        beforeHours = 24; afterHours = 48; // 其他: 72小时
      }
      const dayStart = targetDate.getTime() - beforeHours * 60 * 60 * 1000;
      const nextDayEnd = targetDate.getTime() + afterHours * 60 * 60 * 1000;

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

  const handleDeleteHistory = async (idx) => {
    if (!confirm('确定要删除这条记录吗？')) return;

    const originalItem = filteredHistory[idx];

    // Cloudflare版本：根据管理员状态选择删除位置
    if (version === 'cloudflare' && dataService.deleteWatchlistItem) {
      // 管理员模式：从数据库删除
      if (isAdmin && adminPassword) {
        try {
          // 使用数据库ID删除（如果存在）
          if (originalItem.id) {
            await dataService.deleteWatchlistItem(originalItem.id, adminPassword);
            await loadHistory();
            alert('已从数据库删除');
          } else {
            alert('无法删除：记录缺少ID');
          }
        } catch (error) {
          console.error('删除失败:', error);
          alert('删除失败: ' + error.message);
        }
        return;
      } else {
        // 游客模式：只能删除本地记录
        alert('游客模式下只能删除浏览器本地记录\n要删除数据库记录，请登录管理员账号');
        // 继续执行下面的本地删除逻辑
      }
    }

    // 本地版本：从localStorage删除
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
      const newState = openPosition(positionState, 'long', selectedPoint.price, selectedPoint.time, quantityInput, null, symbol);
      setPositionState(newState);
      updatePositionLines(newState);

      // 添加图表标记
      markersRef.current = [...markersRef.current, {
        time: timeToLocal(Math.floor(selectedPoint.time / 1000)),
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
      const newState = openPosition(positionState, 'short', selectedPoint.price, selectedPoint.time, quantityInput, null, symbol);
      setPositionState(newState);
      updatePositionLines(newState);

      // 添加图表标记
      markersRef.current = [...markersRef.current, {
        time: timeToLocal(Math.floor(selectedPoint.time / 1000)),
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
      let newState;
      if (usePercent) {
        // 按百分比加仓
        newState = addPositionByPercent(positionState, positionState.currentPosition.type, selectedPoint.price, selectedPoint.time, percentInput, symbol);
      } else {
        // 按数量加仓
        newState = openPosition(positionState, positionState.currentPosition.type, selectedPoint.price, selectedPoint.time, quantityInput, null, symbol);
      }
      setPositionState(newState);
      updatePositionLines(newState);

      // 添加图表标记
      markersRef.current = [...markersRef.current, {
        time: timeToLocal(Math.floor(selectedPoint.time / 1000)),
        position: positionState.currentPosition.type === 'long' ? 'belowBar' : 'aboveBar',
        color: positionState.currentPosition.type === 'long' ? '#26a69a' : '#ef5350',
        shape: 'circle',
        text: usePercent ? `+${percentInput}%` : 'Add',
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
      let newState;
      if (usePercent) {
        // 按百分比减仓
        newState = reducePositionByPercent(positionState, selectedPoint.price, selectedPoint.time, percentInput);
      } else {
        // 按数量减仓
        newState = reducePosition(positionState, selectedPoint.price, selectedPoint.time, quantityInput);
      }
      setPositionState(newState);
      updatePositionLines(newState);

      // 添加图表标记
      markersRef.current = [...markersRef.current, {
        time: timeToLocal(Math.floor(selectedPoint.time / 1000)),
        position: positionState.currentPosition ? (positionState.currentPosition.type === 'long' ? 'aboveBar' : 'belowBar') : 'aboveBar',
        color: '#ff9800',
        shape: 'circle',
        text: usePercent ? `-${percentInput}%` : 'Reduce',
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
        time: timeToLocal(Math.floor(selectedPoint.time / 1000)),
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

  const handleLeverageChange = (newLeverage) => {
    try {
      const newState = setLeverage(positionState, newLeverage);
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
        <div>
          {version === 'local' && <span className="version-badge">本地版</span>}
          {version === 'cloudflare' && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
              {isAdmin ? (
                <>
                  <span className="version-badge" style={{ backgroundColor: '#4CAF50' }}>管理员模式</span>
                  <button
                    onClick={handleAdminLogout}
                    style={{
                      padding: '5px 15px',
                      fontSize: '14px',
                      backgroundColor: '#ff5252',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                  >
                    退出登录
                  </button>
                </>
              ) : (
                <>
                  <span className="version-badge" style={{ backgroundColor: '#999' }}>游客模式</span>
                  <button
                    onClick={() => setShowLoginDialog(true)}
                    style={{
                      padding: '5px 15px',
                      fontSize: '14px',
                      backgroundColor: '#2196F3',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                  >
                    管理员登录
                  </button>
                </>
              )}
            </div>
          )}
        </div>
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

          {/* 分形指标 */}
          <div className="indicator-group">
            <h4>分形 (Bill Williams Fractals)</h4>
            <div className="indicator-row">
              <label>
                <input
                  type="checkbox"
                  checked={indicators.fractals?.show || false}
                  onChange={(e) => setIndicators({ ...indicators, fractals: { ...indicators.fractals, show: e.target.checked } })}
                />
                显示分形
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={indicators.fractals?.showLine ?? true}
                  disabled={!indicators.fractals?.show}
                  onChange={(e) => setIndicators({ ...indicators, fractals: { ...indicators.fractals, showLine: e.target.checked } })}
                />
                显示折线
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={indicators.fractals?.showMarkers ?? true}
                  disabled={!indicators.fractals?.show}
                  onChange={(e) => setIndicators({ ...indicators, fractals: { ...indicators.fractals, showMarkers: e.target.checked } })}
                />
                显示标记 (▲支撑 ▼阻力)
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
            <strong style={{ marginLeft: '15px' }}>分形:</strong>
            <span><i style={{ background: '#9c27b0' }}></i>折线</span>
            <span>▲支撑 ▼阻力</span>
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
                  <option value="count-desc">出现次数（多到少）</option>
                  <option value="count-asc">出现次数（少到多）</option>
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
                    className={`history-item ${item.zoneType}-zone ${selectedHistoryIndex === idx ? 'selected' : ''}`}
                    style={{
                      cursor: editingIndex === idx ? 'default' : 'pointer',
                      backgroundColor: selectedHistoryIndex === idx ? 'rgba(38, 166, 154, 0.15)' : backgroundColor,
                      borderLeft: selectedHistoryIndex === idx ? '4px solid #26a69a' : undefined,
                      paddingLeft: selectedHistoryIndex === idx ? '8px' : undefined
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
                    <div onClick={() => handleHistoryClick(item, idx)}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                        <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          {selectedHistoryIndex === idx && (
                            <span style={{ color: '#26a69a', fontSize: '14px' }}>✓</span>
                          )}
                          <span>{item.symbol} - {(item.zoneType === 'bottom' || !item.zoneType) ? '兜底区' : '探顶区'}</span>
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
              <button
                onClick={exportHistory}
                style={{ background: '#4caf50', color: 'white', fontWeight: 'bold' }}
                title="备份观察列表到本地文件"
              >
                💾 导出备份
              </button>
              <input
                type="file"
                accept=".json"
                onChange={importHistory}
                style={{ display: 'none' }}
                id="import-file"
              />
              <button
                onClick={() => document.getElementById('import-file').click()}
                style={{ background: '#2196f3', color: 'white', fontWeight: 'bold' }}
                title="从备份文件恢复观察列表"
              >
                📂 导入备份
              </button>
              <button onClick={handleClearCache}>清缓存</button>
            </div>
            {history.length > 0 && (
              <div style={{
                fontSize: '10px',
                color: '#666',
                marginTop: '8px',
                padding: '4px 8px',
                background: version === 'cloudflare' ? '#d4edda' : '#fff3cd',
                borderRadius: '3px',
                border: version === 'cloudflare' ? '1px solid #28a745' : '1px solid #ffc107'
              }}>
                {version === 'cloudflare'
                  ? '✅ 数据已同步到云端数据库，建议定期导出备份'
                  : '💡 提示：数据仅保存在当前浏览器，请定期导出备份'
                }
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 分形导出工具 */}
      {fullData.length > 0 && indicators.fractals?.show && (
        <div style={{ marginTop: '20px', padding: '15px', background: '#f5f5f5', borderRadius: '8px' }}>
          <h4 style={{ margin: '0 0 10px 0' }}>📊 分形数据导出</h4>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={exportChartAsPNG}
              style={{ background: '#9c27b0', color: 'white', padding: '8px 12px', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
              title="导出当前图表为PNG图片"
            >
              🖼️ 导出PNG
            </button>
            <button
              onClick={exportFractalAsCSV}
              style={{ background: '#4caf50', color: 'white', padding: '8px 12px', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
              title="导出分形数据为CSV表格"
            >
              📊 导出CSV
            </button>
            <button
              onClick={exportFractalAsJSON}
              style={{ background: '#2196f3', color: 'white', padding: '8px 12px', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
              title="导出完整数据为JSON格式"
            >
              📋 导出JSON
            </button>
            <button
              onClick={exportAll}
              style={{ background: '#ff9800', color: 'white', padding: '8px 12px', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
              title="批量导出所有格式（ZIP打包）"
            >
              📦 打包下载
            </button>
          </div>
          <div style={{ fontSize: '11px', color: '#666', marginTop: '8px' }}>
            💡 提示：导出内容包含{playbackPosition > 0 ? `前 ${playbackPosition} 根` : '所有'}K线的分形数据
          </div>
        </div>
      )}

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

              {/* 杠杆调节器 */}
              <div style={{ marginBottom: '15px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '5px' }}>
                  <label style={{ fontWeight: 'bold', fontSize: '14px' }}>杠杆:</label>
                  <span style={{
                    fontSize: '18px',
                    fontWeight: 'bold',
                    color: positionState.leverage > 10 ? '#ef5350' : '#26a69a',
                    minWidth: '40px'
                  }}>
                    {positionState.leverage}x
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="125"
                  value={positionState.leverage}
                  onChange={(e) => handleLeverageChange(parseInt(e.target.value))}
                  style={{ width: '100%' }}
                  className="leverage-slider"
                  disabled={!!positionState.currentPosition}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#666' }}>
                  <span>1x</span>
                  <span>25x</span>
                  <span>50x</span>
                  <span>75x</span>
                  <span>100x</span>
                  <span>125x</span>
                </div>
                <div style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
                  保证金: {(quantityInput / positionState.leverage).toFixed(2)} USDT
                  {positionState.leverage > 10 && (
                    <span style={{ color: '#ef5350', marginLeft: '10px' }}>⚠ 高杠杆风险</span>
                  )}
                </div>
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
                <h4>当前持仓 - {positionState.currentPosition.symbol || symbol}</h4>
                <div className="stat-item">
                  <span>类型:</span>
                  <strong style={{ color: positionState.currentPosition.type === 'long' ? '#26a69a' : '#ef5350' }}>
                    {positionState.currentPosition.type === 'long' ? 'Long (多仓)' : 'Short (空仓)'}
                  </strong>
                </div>
                <div className="stat-item">
                  <span>杠杆:</span>
                  <strong style={{ color: positionState.currentPosition.leverage > 10 ? '#ef5350' : '#26a69a' }}>
                    {positionState.currentPosition.leverage}x
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

                {/* 加仓/减仓模式选择 */}
                <div style={{ marginTop: '10px', marginBottom: '10px', padding: '10px', background: '#f5f5f5', borderRadius: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        checked={!usePercent}
                        onChange={() => setUsePercent(false)}
                        style={{ marginRight: '5px' }}
                      />
                      按价值
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        checked={usePercent}
                        onChange={() => setUsePercent(true)}
                        style={{ marginRight: '5px' }}
                      />
                      按百分比
                    </label>
                  </div>

                  {usePercent ? (
                    <div>
                      <div style={{ display: 'flex', gap: '5px', marginBottom: '5px' }}>
                        {[25, 50, 75, 100].map(percent => (
                          <button
                            key={percent}
                            onClick={() => setPercentInput(percent)}
                            className={percentInput === percent ? 'percent-btn active' : 'percent-btn'}
                            style={{
                              flex: 1,
                              padding: '5px',
                              border: percentInput === percent ? '2px solid #26a69a' : '1px solid #ccc',
                              background: percentInput === percent ? '#e8f5f3' : 'white',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '13px',
                              fontWeight: percentInput === percent ? 'bold' : 'normal'
                            }}
                          >
                            {percent}%
                          </button>
                        ))}
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="100"
                        value={percentInput}
                        onChange={(e) => setPercentInput(parseInt(e.target.value))}
                        style={{ width: '100%', marginTop: '5px' }}
                      />
                      <div style={{ fontSize: '12px', color: '#666', textAlign: 'center' }}>
                        {percentInput}% = {((positionState.currentPosition.quantity * positionState.currentPosition.avgPrice) * percentInput / 100).toFixed(2)} USDT
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: '12px', color: '#666' }}>
                      当前输入: {quantityInput} USDT
                    </div>
                  )}
                </div>

                {/* 加仓/减仓按钮 */}
                <div style={{ marginTop: '10px', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      className="trade-btn"
                      onClick={handleAddPosition}
                      style={{ background: '#4caf50' }}
                    >
                      {usePercent ? `加仓 +${percentInput}%` : '加仓 Add'}
                    </button>
                    <button
                      className="trade-btn"
                      onClick={handleReducePosition}
                      style={{ background: '#ff9800' }}
                    >
                      {usePercent ? `减仓 -${percentInput}%` : '减仓 Reduce'}
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
                        {trade.symbol || 'UNKNOWN'} | {trade.type === 'long' ? 'Long' : 'Short'} {trade.leverage ? `${trade.leverage}x` : '1x'} |
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

      {/* 管理员登录对话框 */}
      {showLoginDialog && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 10000
          }}
          onClick={() => setShowLoginDialog(false)}
        >
          <div
            style={{
              backgroundColor: 'white',
              padding: '30px',
              borderRadius: '8px',
              minWidth: '350px',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#333' }}>管理员登录</h2>
            <p style={{ color: '#666', marginBottom: '20px', fontSize: '14px' }}>
              登录后可将观察列表保存到云端数据库，支持跨设备同步。
            </p>
            <input
              type="password"
              placeholder="请输入管理员密码"
              style={{
                width: '100%',
                padding: '10px',
                fontSize: '14px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                boxSizing: 'border-box',
                marginBottom: '20px'
              }}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleAdminLogin(e.target.value);
                }
              }}
              id="admin-password-input"
            />
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowLoginDialog(false)}
                style={{
                  padding: '8px 20px',
                  fontSize: '14px',
                  backgroundColor: '#f5f5f5',
                  color: '#333',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                取消
              </button>
              <button
                onClick={() => {
                  const input = document.getElementById('admin-password-input');
                  handleAdminLogin(input.value);
                }}
                style={{
                  padding: '8px 20px',
                  fontSize: '14px',
                  backgroundColor: '#2196F3',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                登录
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
