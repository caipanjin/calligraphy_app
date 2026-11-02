/**
 * 切分结果的本地缓存（IndexedDB）
 *
 * 大图切分需要 2 秒左右，同一张字帖反复打开没必要重算。
 * 缓存键 = 图片内容哈希 + 版面模式（竖排/横排各自一份）。
 */
export const SEGMENT_STORE = 'segmentations';

const withStore = (db, mode, fn) => {
  if (!db) return null;
  try {
    const transaction = db.transaction(SEGMENT_STORE, mode);
    return fn(transaction.objectStore(SEGMENT_STORE), transaction);
  } catch (error) {
    return null;
  }
};

export const readSegmentation = (db, key) =>
  new Promise((resolve) => {
    const request = withStore(db, 'readonly', (store) => store.get(key));
    if (!request) {
      resolve(null);
      return;
    }
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
  });

export const writeSegmentation = (db, key, payload) =>
  new Promise((resolve) => {
    const transaction = withStore(db, 'readwrite', (store) => {
      store.put({ id: key, ...payload, savedAt: Date.now() });
      return store;
    });
    if (!transaction) {
      resolve(false);
      return;
    }
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
  });

/**
 * 字帖级设置（版面模式 / 是否带格子线）
 *
 * 这些是「用户对这张字帖的判断」，与切分结果分开存：
 * 下次打开同一张字帖时能恢复上次的选择。
 */
export const SETTINGS_STORE = 'segmentationSettings';

const withSettingsStore = (db, mode, fn) => {
  if (!db || !db.objectStoreNames.contains(SETTINGS_STORE)) return null;
  try {
    const transaction = db.transaction(SETTINGS_STORE, mode);
    return fn(transaction.objectStore(SETTINGS_STORE), transaction);
  } catch (error) {
    return null;
  }
};

export const readSettings = (db, key) =>
  new Promise((resolve) => {
    const request = withSettingsStore(db, 'readonly', (store) => store.get(key));
    if (!request) {
      resolve(null);
      return;
    }
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
  });

export const writeSettings = (db, key, payload) =>
  new Promise((resolve) => {
    const transaction = withSettingsStore(db, 'readwrite', (store) => {
      store.put({ id: key, ...payload, savedAt: Date.now() });
      return store;
    });
    if (!transaction) {
      resolve(false);
      return;
    }
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
  });

/** 删除单条缓存 */
export const deleteSegmentation = (db, key) =>
  new Promise((resolve) => {
    const request = withStore(db, 'readwrite', (store) => store.delete(key));
    if (!request) {
      resolve(false);
      return;
    }
    request.onsuccess = () => resolve(true);
    request.onerror = () => resolve(false);
  });

/** 删除某张图片的全部缓存（所有版面模式） */
export const deleteSegmentationByPrefix = (db, prefix) =>
  new Promise((resolve) => {
    const transaction = withStore(db, 'readwrite', (store) => store);
    if (!transaction) {
      resolve(false);
      return;
    }
    const store = transaction.objectStore(SEGMENT_STORE);
    const keysRequest = store.getAllKeys();
    keysRequest.onsuccess = () => {
      keysRequest.result
        .filter((key) => String(key).startsWith(prefix))
        .forEach((key) => store.delete(key));
    };
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
  });

/** 清空所有切分缓存 */
export const clearSegmentations = (db) =>
  new Promise((resolve) => {
    const transaction = withStore(db, 'readwrite', (store) => store);
    if (!transaction) {
      resolve(false);
      return;
    }
    transaction.objectStore(SEGMENT_STORE).clear();
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
  });
