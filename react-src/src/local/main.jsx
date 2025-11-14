import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '../components/App';
import * as indexedDB from '../services/local/indexedDB';
import * as multiExchangeAPI from '../services/local/multiExchangeAPI';

// 本地版数据服务（支持币安+OKX智能切换）
const localDataService = {
  // IndexedDB方法
  initDB: indexedDB.initDB,
  getKlinesFromDB: indexedDB.getKlinesFromDB,
  saveKlinesToDB: indexedDB.saveKlinesToDB,
  clearKlineCache: indexedDB.clearKlineCache,

  // 多交易所API方法（自动切换币安/OKX）
  fetchBinanceKlines: async (symbol, interval, startTime, endTime, limit, marketType) => {
    const result = await multiExchangeAPI.fetchKlinesWithFallback(
      symbol, interval, startTime, endTime, limit, marketType
    );
    // 返回数据，兼容原有接口
    return result.data;
  },
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App dataService={localDataService} version="local" />
  </React.StrictMode>
);
