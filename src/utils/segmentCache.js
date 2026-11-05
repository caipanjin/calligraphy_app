/**
 * 切分结果的本地缓存（IndexedDB）
 *
 * 大图切分需要 2 秒左右，同一张字帖反复打开没必要重算。
 * 缓存键 = 图片内容哈希 + 版面模式（竖排/横排各自一份），
 * 算法版本存在记录里（见 SEGMENT_ALGORITHM_VERSION），不写进键，
 * 这样旧缓存会在重算时被同键覆盖，不会留下一批永不命中的孤儿记录。
 */
export const SEGMENT_STORE = 'segmentations';

/**
 * 切分算法版本。
 *
 * 任何会改变「同一张图切出哪些框」的改动（src/utils/segment.js），
 * 都必须把这里 +1，否则用户装了新版仍会命中旧算法留下的缓存。
 *
 *   v1 = 历史版本：记录里没有 algorithmVersion 字段
 *   v2 = mergeSplitGlyphs 扁部件合并修复之后（含「石」字被切成两字的修复）
 *   v3 = 双联形态下把字距搜索上限放宽到 0.55W（两联不再被拆成 6 列）
 */
export const SEGMENT_ALGORITHM_VERSION = 3;

const MANUAL_SUFFIX = ':manual';

/** 该记录是否由当前算法产出（旧记录没有版本字段，一律视为过期） */
export const isCurrentSegmentation = (record) =>
  Boolean(record) && record.algorithmVersion === SEGMENT_ALGORITHM_VERSION;

/**
 * 能否直接复用这条缓存，省掉一次重算。
 *
 * 手动结果是用户亲手确认的最终框，与算法版本无关，永远保留；
 * 自动结果必须严格匹配当前算法版本。
 */
export const canReuseSegmentation = (record, key) => {
  if (!record || !Array.isArray(record.boxes) || record.boxes.length === 0) return false;
  if (String(key).endsWith(MANUAL_SUFFIX)) return true;
  return isCurrentSegmentation(record);
};

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
    // 注意：必须返回 transaction 本身，而不是 store。
    // 之前误把 store 当成 transaction，导致 oncomplete 永远不触发，
    // 依赖它完成的逻辑（如关闭面板前等待保存）会一直挂起。
    const transaction = withStore(db, 'readwrite', (store, tx) => {
      // 版本号放在最后，调用方无法覆盖：所有写入（含手动结果）都带当前算法版本。
      store.put({
        id: key,
        ...payload,
        algorithmVersion: SEGMENT_ALGORITHM_VERSION,
        savedAt: Date.now()
      });
      return tx;
    });
    if (!transaction || typeof transaction.addEventListener !== 'function') {
      resolve(false);
      return;
    }
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
    transaction.onabort = () => resolve(false);
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

/**
 * 删除某张图片的全部记录：切分缓存（含手动结果）+ 字帖设置
 *
 * 注意：getAllKeys 是异步的，必须等它在事务内完成删除后，事务才会提交，
 * 因此 resolve 要挂在 transaction.oncomplete 上。
 */
export const deleteSegmentationByPrefix = (db, prefix) =>
  new Promise((resolve) => {
    if (!db || !prefix) {
      resolve(false);
      return;
    }

    const storeNames = [];
    if (db.objectStoreNames.contains(SEGMENT_STORE)) storeNames.push(SEGMENT_STORE);
    if (db.objectStoreNames.contains(SETTINGS_STORE)) storeNames.push(SETTINGS_STORE);
    if (storeNames.length === 0) {
      resolve(false);
      return;
    }

    let transaction;
    try {
      transaction = db.transaction(storeNames, 'readwrite');
    } catch (error) {
      resolve(false);
      return;
    }

    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
    transaction.onabort = () => resolve(false);

    storeNames.forEach((name) => {
      const store = transaction.objectStore(name);
      const keysRequest = store.getAllKeys();
      keysRequest.onsuccess = () => {
        keysRequest.result
          .filter((key) => String(key).startsWith(prefix))
          .forEach((key) => store.delete(key));
      };
    });
  });

/** 清空所有切分缓存 */
export const clearSegmentations = (db) =>
  new Promise((resolve) => {
    if (!db) {
      resolve(false);
      return;
    }

    const storeNames = [];
    if (db.objectStoreNames.contains(SEGMENT_STORE)) storeNames.push(SEGMENT_STORE);
    if (db.objectStoreNames.contains(SETTINGS_STORE)) storeNames.push(SETTINGS_STORE);
    if (storeNames.length === 0) {
      resolve(false);
      return;
    }

    let transaction;
    try {
      transaction = db.transaction(storeNames, 'readwrite');
    } catch (error) {
      resolve(false);
      return;
    }

    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
    transaction.onabort = () => resolve(false);

    storeNames.forEach((name) => {
      transaction.objectStore(name).clear();
    });
  });
