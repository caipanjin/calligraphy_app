/**
 * 字帖数据层（IndexedDB v5）
 *
 * 模型：一个「字帖」= 一本可含多页的册子，页与页之间只在本字帖内有序。
 *
 *   albums  元数据：{ id, title, createdAt, updatedAt, coverThumb, pages: [{id, hash, size, addedAt}] }
 *   pages   图片体：{ id, albumId, dataUrl }        ← 唯一持有完整 base64 的地方
 *   thumbs  页缩略图：{ id: pageId, thumb }         ← 240px 小图，可按需单条读
 *   meta    续练指针：{ id: 'current', albumId, pageId }
 *
 * 关键约束：**任何读取「字帖列表」的路径都不得加载 pages store**。
 * 旧版 images store 把 20 张完整 base64 一次性 getAll 进 React state，
 * 是 iOS jetsam 的常驻基线；现在列表只读元数据，完整原图只在打开某一页时
 * 由 readPage 单条读取，返回字帖库时由 App 置空释放。
 *
 * 切分缓存 / 练习记录仍按「图片内容哈希」寻址（hashImageData），不随字帖 id 变化：
 * 同一张图放进不同字帖时共享切分与进度，删掉其中一页不会清掉另一本字帖的记录。
 * 底部分页条因此也能在完全不解码原图的情况下显示进度与缩略图。
 */
import { hashImageData } from './imageHash.js';

export const ALBUM_STORE = 'albums';
export const PAGE_STORE = 'pages';
export const THUMB_STORE = 'thumbs';
export const META_STORE = 'meta';

/** 旧版遗留的缓存表：v4 → v5 清空重建时一并清掉，不留孤儿记录 */
export const LEGACY_CACHE_STORES = [
  'segmentations',
  'segmentationSettings',
  'practiceRecords',
  'practiceDaily'
];

export const ALL_STORES = [
  ...LEGACY_CACHE_STORES,
  ALBUM_STORE,
  PAGE_STORE,
  THUMB_STORE,
  META_STORE
];

export const MAX_ALBUMS = 20;
export const MAX_PAGES_PER_ALBUM = 30;
export const MAX_FILES_PER_IMPORT = 20;

const CURRENT_KEY = 'current';

const makeId = (prefix) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

/** 自动命名：字帖 11月5日 · 4 页 */
export const makeAlbumTitle = (pageCount, now = Date.now()) => {
  const date = new Date(now);
  const label = Number.isNaN(date.getTime())
    ? '新建'
    : `${date.getMonth() + 1}月${date.getDate()}日`;
  return `字帖 ${label} · ${pageCount} 页`;
};

const asPromise = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB 读取失败'));
  });

const txDone = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB 写入失败'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB 写入被中止'));
  });

/**
 * 数据库升级（在 onupgradeneeded 里同步调用）。
 *
 * v4 → v5 采用「清空重建」：删除旧 images store、清空遗留缓存表，
 * 用户重新导入字帖。旧数据不迁移，避免把 20 张单图硬拆成 20 本册子。
 * 全新安装（oldVersion=0）只建表，不做清理。
 *
 * @returns {boolean} 是否清掉了旧数据（供 UI 提示）
 */
export const upgradeStores = (database, transaction, oldVersion) => {
  const names = database.objectStoreNames;
  const cleared = Number(oldVersion) > 0 && Number(oldVersion) < 5;

  if (cleared) {
    if (names.contains('images')) database.deleteObjectStore('images');
    LEGACY_CACHE_STORES.forEach((name) => {
      if (names.contains(name) && transaction && transaction.objectStore) {
        transaction.objectStore(name).clear();
      }
    });
  }

  ALL_STORES.forEach((name) => {
    if (!names.contains(name)) database.createObjectStore(name, { keyPath: 'id' });
  });

  return cleared;
};

/** 读取全部字帖元数据（不含任何完整原图） */
export const readAlbums = async (db) => {
  const tx = db.transaction(ALBUM_STORE, 'readonly');
  const list = await asPromise(tx.objectStore(ALBUM_STORE).getAll());
  return (Array.isArray(list) ? list : [])
    .filter((album) => album && album.id)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
};

export const readAlbum = async (db, albumId) => {
  const tx = db.transaction(ALBUM_STORE, 'readonly');
  const album = await asPromise(tx.objectStore(ALBUM_STORE).get(albumId));
  return album || null;
};

/** 通用 getAll：进度汇总等场景一次读完整张小表 */
export const readAll = async (db, storeName) => {
  const tx = db.transaction(storeName, 'readonly');
  const list = await asPromise(tx.objectStore(storeName).getAll());
  return Array.isArray(list) ? list : [];
};

/** 读取某一页的完整原图。调用方负责在用完后丢弃引用。 */
export const readPage = async (db, pageId) => {
  if (!pageId) return null;
  const tx = db.transaction(PAGE_STORE, 'readonly');
  const page = await asPromise(tx.objectStore(PAGE_STORE).get(pageId));
  return page && page.dataUrl ? page : null;
};

/** 按需读取单页缩略图（懒加载：只有进入可视区才调用） */
export const readThumb = async (db, pageId) => {
  if (!pageId) return '';
  const tx = db.transaction(THUMB_STORE, 'readonly');
  const record = await asPromise(tx.objectStore(THUMB_STORE).get(pageId));
  return record && typeof record.thumb === 'string' ? record.thumb : '';
};

/**
 * 新建字帖。
 * @param {Array<{dataUrl,size?,hash?,thumb?}>} pages 已解码好的页（导入时已在内存里）
 */
export const createAlbum = async (db, { title, pages, now = Date.now() } = {}) => {
  const items = Array.isArray(pages) ? pages : [];
  if (items.length === 0) throw new Error('字帖至少要有一页');

  const albumId = makeId('album');
  const entries = items.map((item, index) => ({
    id: makeId('page'),
    order: index,
    hash: item.hash || hashImageData(item.dataUrl),
    size: item.size || 0,
    addedAt: now,
    dataUrl: item.dataUrl,
    thumb: item.thumb || ''
  }));

  const album = {
    id: albumId,
    title: title || makeAlbumTitle(entries.length, now),
    createdAt: now,
    updatedAt: now,
    coverThumb: entries[0].thumb || '',
    pages: entries.map((entry) => ({
      id: entry.id,
      hash: entry.hash,
      size: entry.size,
      addedAt: entry.addedAt
    }))
  };

  const tx = db.transaction([ALBUM_STORE, PAGE_STORE, THUMB_STORE], 'readwrite');
  tx.objectStore(ALBUM_STORE).put(album);
  entries.forEach((entry) => {
    tx.objectStore(PAGE_STORE).put({ id: entry.id, albumId, dataUrl: entry.dataUrl });
    tx.objectStore(THUMB_STORE).put({ id: entry.id, thumb: entry.thumb });
  });
  await txDone(tx);
  return album;
};

/** 往已有字帖追加页 */
export const addPages = async (db, albumId, pages, now = Date.now()) => {
  const album = await readAlbum(db, albumId);
  if (!album) throw new Error('字帖不存在');
  const items = Array.isArray(pages) ? pages : [];
  if (items.length === 0) return album;

  const existing = Array.isArray(album.pages) ? album.pages : [];
  const entries = items.map((item, index) => ({
    id: makeId('page'),
    hash: item.hash || hashImageData(item.dataUrl),
    size: item.size || 0,
    addedAt: now,
    dataUrl: item.dataUrl,
    thumb: item.thumb || ''
  }));

  const next = {
    ...album,
    updatedAt: now,
    coverThumb: album.coverThumb || entries[0].thumb || '',
    pages: [
      ...existing,
      ...entries.map((entry, index) => ({
        id: entry.id,
        hash: entry.hash,
        size: entry.size,
        addedAt: entry.addedAt,
        order: existing.length + index
      }))
    ]
  };

  const tx = db.transaction([ALBUM_STORE, PAGE_STORE, THUMB_STORE], 'readwrite');
  tx.objectStore(ALBUM_STORE).put(next);
  entries.forEach((entry) => {
    tx.objectStore(PAGE_STORE).put({ id: entry.id, albumId, dataUrl: entry.dataUrl });
    tx.objectStore(THUMB_STORE).put({ id: entry.id, thumb: entry.thumb });
  });
  await txDone(tx);
  return next;
};

/** 删除单页；只剩一页时拒绝，避免留下空字帖 */
export const deletePage = async (db, albumId, pageId) => {
  const album = await readAlbum(db, albumId);
  if (!album) return null;
  const existing = Array.isArray(album.pages) ? album.pages : [];
  const nextPages = existing.filter((page) => page.id !== pageId);
  if (nextPages.length === 0 || nextPages.length === existing.length) return album;

  const tx = db.transaction([ALBUM_STORE, PAGE_STORE, THUMB_STORE], 'readwrite');
  tx.objectStore(ALBUM_STORE).put({ ...album, pages: nextPages, updatedAt: Date.now() });
  tx.objectStore(PAGE_STORE).delete(pageId);
  tx.objectStore(THUMB_STORE).delete(pageId);
  await txDone(tx);
  return { ...album, pages: nextPages };
};

/**
 * 删除整本字帖及其所有页。
 * 刻意不清理按图片哈希寻址的切分 / 练习记录：同一张图可能属于另一本字帖，
 * 按内容共享是既定语义；孤儿记录体量极小，可由「清空全部字帖」统一回收。
 */
export const deleteAlbum = async (db, albumId) => {
  const album = await readAlbum(db, albumId);
  const ids = album && Array.isArray(album.pages) ? album.pages.map((page) => page.id) : [];

  const tx = db.transaction([ALBUM_STORE, PAGE_STORE, THUMB_STORE], 'readwrite');
  tx.objectStore(ALBUM_STORE).delete(albumId);
  ids.forEach((id) => {
    tx.objectStore(PAGE_STORE).delete(id);
    tx.objectStore(THUMB_STORE).delete(id);
  });
  await txDone(tx);
  return ids;
};

export const renameAlbum = async (db, albumId, title) => {
  const trimmed = String(title || '').trim();
  if (!trimmed) return null;
  const album = await readAlbum(db, albumId);
  if (!album) return null;
  const next = { ...album, title: trimmed, updatedAt: Date.now() };
  const tx = db.transaction(ALBUM_STORE, 'readwrite');
  tx.objectStore(ALBUM_STORE).put(next);
  await txDone(tx);
  return next;
};

/* ---------------- 续练指针 ---------------- */

export const readCurrent = async (db) => {
  const tx = db.transaction(META_STORE, 'readonly');
  const record = await asPromise(tx.objectStore(META_STORE).get(CURRENT_KEY));
  return record && record.albumId ? record : null;
};

export const saveCurrent = async (db, { albumId, pageId }) => {
  const tx = db.transaction(META_STORE, 'readwrite');
  tx.objectStore(META_STORE).put({
    id: CURRENT_KEY,
    albumId,
    pageId,
    savedAt: Date.now()
  });
  await txDone(tx);
};

export const clearCurrent = async (db) => {
  const tx = db.transaction(META_STORE, 'readwrite');
  tx.objectStore(META_STORE).delete(CURRENT_KEY);
  await txDone(tx);
};

/** 清空全部字帖（不动按哈希存的历史缓存，由 App 另行清理） */
export const clearAllAlbums = async (db) => {
  const tx = db.transaction([ALBUM_STORE, PAGE_STORE, THUMB_STORE, META_STORE], 'readwrite');
  [ALBUM_STORE, PAGE_STORE, THUMB_STORE, META_STORE].forEach((name) => {
    tx.objectStore(name).clear();
  });
  await txDone(tx);
};
