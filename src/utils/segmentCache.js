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
