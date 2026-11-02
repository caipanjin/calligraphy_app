/**
 * 练习记录（IndexedDB）
 *
 * 记录「每个字练过几次」，用于：
 * - 单字页显示「练过 N 次」
 * - 字帖卡片显示进度条
 * - 打开字帖时续练
 *
 * 记录是纯自动计数，不提供手动标记。
 * 键 = `${图片哈希}:${字索引}`，与切分缓存同一套哈希体系。
 */

export const PRACTICE_STORE = 'practiceRecords';
export const DAILY_STORE = 'practiceDaily';

/** 停留多久算「练过一次」 */
export const PRACTICE_THRESHOLD_MS = 3000;

const withStore = (db, storeName, mode, fn) => {
  if (!db || !db.objectStoreNames.contains(storeName)) return null;
  try {
    const transaction = db.transaction(storeName, mode);
    return fn(transaction.objectStore(storeName), transaction);
  } catch (error) {
    return null;
  }
};

export const practiceKey = (imageHash, index) => `${imageHash}:${index}`;

export const dailyKey = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/**
 * 记录一次练习（计数 +1）
 * 同时累加当日汇总
 */
export const recordPractice = (db, imageHash, index) =>
  new Promise((resolve) => {
    if (!db) {
      resolve(null);
      return;
    }

    const stores = [PRACTICE_STORE, DAILY_STORE].filter((name) =>
      db.objectStoreNames.contains(name)
    );
    if (stores.length === 0) {
      resolve(null);
      return;
    }

    let transaction;
    try {
      transaction = db.transaction(stores, 'readwrite');
    } catch (error) {
      resolve(null);
      return;
    }

    const now = Date.now();
    let result = null;

    if (stores.includes(PRACTICE_STORE)) {
      const store = transaction.objectStore(PRACTICE_STORE);
      const key = practiceKey(imageHash, index);
      const request = store.get(key);
      request.onsuccess = () => {
        const existing = request.result;
        const next = existing
          ? { ...existing, count: (existing.count || 0) + 1, lastPracticedAt: now }
          : {
              id: key,
              imageHash,
              index,
              count: 1,
              firstPracticedAt: now,
              lastPracticedAt: now
            };
        store.put(next);
        result = next;
      };
    }

    if (stores.includes(DAILY_STORE)) {
      const dailyStore = transaction.objectStore(DAILY_STORE);
      const key = dailyKey();
      const request = dailyStore.get(key);
      request.onsuccess = () => {
        const existing = request.result;
        dailyStore.put(
          existing
            ? { ...existing, count: (existing.count || 0) + 1, lastAt: now }
            : { id: key, count: 1, lastAt: now }
        );
      };
    }

    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => resolve(null);
    transaction.onabort = () => resolve(null);
  });

/** 读取某张字帖的全部练习记录，返回 Map<字索引, 记录> */
export const readImagePractice = (db, imageHash) =>
  new Promise((resolve) => {
    const request = withStore(db, PRACTICE_STORE, 'readonly', (store) => store.getAll());
    if (!request) {
      resolve(new Map());
      return;
    }
    request.onsuccess = () => {
      const map = new Map();
      (request.result || [])
        .filter((record) => record.imageHash === imageHash)
        .forEach((record) => map.set(record.index, record));
      resolve(map);
    };
    request.onerror = () => resolve(new Map());
  });

/** 读取「上次练到的字」：lastPracticedAt 最大的那条 */
export const readLastPracticed = (db, imageHash) =>
  new Promise((resolve) => {
    const request = withStore(db, PRACTICE_STORE, 'readonly', (store) => store.getAll());
    if (!request) {
      resolve(null);
      return;
    }
    request.onsuccess = () => {
      const records = (request.result || []).filter((record) => record.imageHash === imageHash);
      if (records.length === 0) {
        resolve(null);
        return;
      }
      records.sort((a, b) => (b.lastPracticedAt || 0) - (a.lastPracticedAt || 0));
      resolve(records[0]);
    };
    request.onerror = () => resolve(null);
  });

/** 读取单条记录 */
export const readPractice = (db, imageHash, index) =>
  new Promise((resolve) => {
    const request = withStore(db, PRACTICE_STORE, 'readonly', (store) =>
      store.get(practiceKey(imageHash, index))
    );
    if (!request) {
      resolve(null);
      return;
    }
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
  });

/** 已练过的字数（count > 0） */
export const countPracticed = (records) => {
  let n = 0;
  records.forEach((record) => {
    if (record && record.count > 0) n += 1;
  });
  return n;
};

/** 删除某张字帖的全部练习记录（不删每日汇总） */
export const deleteImagePractice = (db, imageHash) =>
  new Promise((resolve) => {
    const request = withStore(db, PRACTICE_STORE, 'readonly', (store) => store.getAll());
    if (!request) {
      resolve(false);
      return;
    }
    request.onsuccess = () => {
      const keys = (request.result || [])
        .filter((record) => record.imageHash === imageHash)
        .map((record) => record.id);
      if (keys.length === 0) {
        resolve(true);
        return;
      }
      const write = withStore(db, PRACTICE_STORE, 'readwrite', (store) => store);
      if (!write) {
        resolve(false);
        return;
      }
      const store = write.objectStore(PRACTICE_STORE);
      keys.forEach((key) => store.delete(key));
      write.oncomplete = () => resolve(true);
      write.onerror = () => resolve(false);
      write.onabort = () => resolve(false);
    };
    request.onerror = () => resolve(false);
  });

/** 清空所有练习记录与每日汇总 */
export const clearAllPractice = (db) =>
  new Promise((resolve) => {
    if (!db) {
      resolve(false);
      return;
    }
    const stores = [PRACTICE_STORE, DAILY_STORE].filter((name) =>
      db.objectStoreNames.contains(name)
    );
    if (stores.length === 0) {
      resolve(false);
      return;
    }
    let transaction;
    try {
      transaction = db.transaction(stores, 'readwrite');
    } catch (error) {
      resolve(false);
      return;
    }
    stores.forEach((name) => transaction.objectStore(name).clear());
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
    transaction.onabort = () => resolve(false);
  });

/** 读取统计：今日 / 本周 / 累计字数 （按字计算，同一字多次练习只算一个字） */
export const readPracticeStats = (db) =>
  new Promise((resolve) => {
    const empty = { today: 0, week: 0, total: 0 };
    const allRequest = withStore(db, PRACTICE_STORE, 'readonly', (store) => store.getAll());
    const dailyRequest = withStore(db, DAILY_STORE, 'readonly', (store) => store.getAll());
    if (!allRequest || !dailyRequest) {
      resolve(empty);
      return;
    }

    let allRecords = null;
    let dailyRecords = null;

    const finish = () => {
      if (!allRecords || !dailyRecords) return;

      // 累计：练过的不同字数
      const practicedKeys = new Set(
        allRecords.filter((r) => r.count > 0).map((r) => r.id)
      );

      // 今日：当日汇总里的次数（同一天练多次也计多次，表示练习量）
      const today = dailyKey();
      const todayRecord = dailyRecords.find((r) => r.id === today);
      const todayCount = todayRecord ? todayRecord.count : 0;

      // 本周：最近 7 天汇总次数
      const now = new Date();
      const weekKeys = new Set();
      for (let i = 0; i < 7; i += 1) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        weekKeys.add(dailyKey(d));
      }
      const weekCount = dailyRecords
        .filter((r) => weekKeys.has(r.id))
        .reduce((sum, r) => sum + (r.count || 0), 0);

      resolve({ today: todayCount, week: weekCount, total: practicedKeys.size });
    };

    allRequest.onsuccess = () => {
      allRecords = allRequest.result || [];
      finish();
    };
    allRequest.onerror = () => {
      allRecords = [];
      finish();
    };
    dailyRequest.onsuccess = () => {
      dailyRecords = dailyRequest.result || [];
      finish();
    };
    dailyRequest.onerror = () => {
      dailyRecords = [];
      finish();
    };
  });

/** 读取每日汇总（用于统计页展示趋势） */
export const readDailySummary = (db, days = 14) =>
  new Promise((resolve) => {
    const request = withStore(db, DAILY_STORE, 'readonly', (store) => store.getAll());
    if (!request) {
      resolve([]);
      return;
    }
    request.onsuccess = () => {
      const all = request.result || [];
      const now = new Date();
      const keys = [];
      for (let i = days - 1; i >= 0; i -= 1) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        keys.push(dailyKey(d));
      }
      const byId = new Map(all.map((r) => [r.id, r]));
      resolve(
        keys.map((key) => ({
          date: key,
          count: byId.has(key) ? byId.get(key).count : 0
        }))
      );
    };
    request.onerror = () => resolve([]);
  });
