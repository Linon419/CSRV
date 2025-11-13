import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '../components/App';
import * as cloudflareAPI from '../services/cloudflare/api';

// Cloudflare版数据服务
const cloudflareDataService = {
  // Cloudflare API方法
  getKlinesFromDB: cloudflareAPI.getKlinesFromDB,
  saveKlinesToDB: cloudflareAPI.saveKlinesToDB,
  clearKlineCache: cloudflareAPI.clearKlineCache,
  fetchBinanceKlines: cloudflareAPI.fetchBinanceKlines,
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App dataService={cloudflareDataService} version="cloudflare" />
  </React.StrictMode>
);
