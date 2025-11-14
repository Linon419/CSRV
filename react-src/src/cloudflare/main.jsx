import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '../components/App';
import * as cloudflareAPI from '../services/cloudflare/api';

// Cloudflare版数据服务
const cloudflareDataService = {
  // K线数据API
  getKlinesFromDB: cloudflareAPI.getKlinesFromDB,
  saveKlinesToDB: cloudflareAPI.saveKlinesToDB,
  clearKlineCache: cloudflareAPI.clearKlineCache,
  fetchBinanceKlines: cloudflareAPI.fetchBinanceKlines,

  // 观察列表API
  getWatchlist: cloudflareAPI.getWatchlist,
  saveWatchlistItem: cloudflareAPI.saveWatchlistItem,
  deleteWatchlistItem: cloudflareAPI.deleteWatchlistItem,
  importWatchlist: cloudflareAPI.importWatchlist,
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App dataService={cloudflareDataService} version="cloudflare" />
  </React.StrictMode>
);
