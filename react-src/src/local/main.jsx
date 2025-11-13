import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '../components/App';
import * as indexedDB from '../services/local/indexedDB';
import * as binanceAPI from '../services/local/binanceAPI';

// 本地版数据服务
const localDataService = {
  // IndexedDB方法
  initDB: indexedDB.initDB,
  getKlinesFromDB: indexedDB.getKlinesFromDB,
  saveKlinesToDB: indexedDB.saveKlinesToDB,
  clearKlineCache: indexedDB.clearKlineCache,

  // 币安API方法
  fetchBinanceKlines: binanceAPI.fetchBinanceKlines,
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App dataService={localDataService} version="local" />
  </React.StrictMode>
);
