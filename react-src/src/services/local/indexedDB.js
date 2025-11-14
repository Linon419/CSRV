/**
 * IndexedDB 本地数据库服务 (本地版本使用)
 */

const DB_NAME = 'backtest_db';
const DB_VERSION = 1;
const STORE_NAME = 'klines';

let db = null;

/**
 * 初始化IndexedDB数据库
 */
export function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const objectStore = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        objectStore.createIndex('symbol', 'symbol', { unique: false });
        objectStore.createIndex('interval', 'interval', { unique: false });
        objectStore.createIndex('time', 'time', { unique: false });
        objectStore.createIndex('composite', ['symbol', 'interval', 'time'], { unique: true });
      }
    };
  });
}

/**
 * 从IndexedDB获取K线数据
 */
export function getKlinesFromDB(symbol, interval, startTime, endTime) {
  if (!db) return Promise.resolve([]);

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const objectStore = transaction.objectStore(STORE_NAME);
    const index = objectStore.index('composite');
    const results = [];

    const range = IDBKeyRange.bound(
      [symbol, interval, startTime],
      [symbol, interval, endTime]
    );

    const request = index.openCursor(range);

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * 保存K线数据到IndexedDB
 */
export function saveKlinesToDB(symbol, interval, klines) {
  if (!db || !klines || klines.length === 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const objectStore = transaction.objectStore(STORE_NAME);

    klines.forEach(k => {
      const record = {
        id: `${symbol}_${interval}_${k[0]}`,
        symbol,
        interval,
        time: k[0],
        open: +k[1],
        high: +k[2],
        low: +k[3],
        close: +k[4],
        volume: +k[5],
        updatedAt: Date.now()
      };
      objectStore.put(record);
    });

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

/**
 * 清空K线缓存
 */
export function clearKlineCache() {
  if (!db) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const objectStore = transaction.objectStore(STORE_NAME);
    const request = objectStore.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
