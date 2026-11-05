/**
 * 多页字帖数据层回归测试。
 *
 * 直接 import 真实的 albumStore.js / albumProgress.js，用内存版 IndexedDB mock
 * 跑建帖、加页、删页、删帖、改名、续练指针与 v4→v5 清空重建。
 * 末尾的静态断言守住两条容易在重构中被改坏的约束：
 *   1. 返回字帖库时必须释放当前页原图与缩略图缓存；
 *   2. 字帖库 / 分页条只渲染小缩略图，绝不把完整 dataUrl 挂到 <img>。
 *
 * 运行：node scripts/test-album-store.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ALBUM_STORE,
  PAGE_STORE,
  THUMB_STORE,
  META_STORE,
  ALL_STORES,
  LEGACY_CACHE_STORES,
  MAX_ALBUMS,
  MAX_PAGES_PER_ALBUM,
  upgradeStores,
  makeAlbumTitle,
  readAlbums,
  readPage,
  readThumb,
  createAlbum,
  addPages,
  deletePage,
  deleteAlbum,
  renameAlbum,
  readCurrent,
  saveCurrent,
  clearCurrent,
  clearAllAlbums
} from '../src/utils/albumStore.js';
import { buildProgressMap, sumAlbumProgress } from '../src/utils/albumProgress.js';

let passed = 0;
const check = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name} — ${error.message}`);
    process.exitCode = 1;
  }
};

/** 最小 IndexedDB mock：版本升级 + get/put/delete/getAll/clear + 事务完成事件 */
const createFakeDb = (existingNames = []) => {
  const stores = new Map(existingNames.map((name) => [name, new Map()]));
  const makeRequest = (result) => {
    const request = { result };
    queueMicrotask(() => request.onsuccess && request.onsuccess());
    return request;
  };
  const makeStore = (name) => {
    if (!stores.has(name)) throw new Error(`store 不存在: ${name}`);
    const map = stores.get(name);
    return {
      get: (key) => makeRequest(map.get(key)),
      put: (value) => {
        map.set(value.id, { ...value });
        return makeRequest(value.id);
      },
      delete: (key) => {
        map.delete(key);
        return makeRequest(undefined);
      },
      getAll: () => makeRequest([...map.values()].map((value) => ({ ...value }))),
      getAllKeys: () => makeRequest([...map.keys()]),
      clear: () => {
        map.clear();
        return makeRequest(undefined);
      }
    };
  };
  const makeTransaction = () => {
    const tx = { objectStore: makeStore, oncomplete: null, onerror: null, onabort: null };
    setTimeout(() => tx.oncomplete && tx.oncomplete(), 0);
    return tx;
  };
  return {
    stores,
    objectStoreNames: { contains: (name) => stores.has(name) },
    createObjectStore: (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      return makeStore(name);
    },
    deleteObjectStore: (name) => stores.delete(name),
    transaction: makeTransaction
  };
};

const ALL_NAMES = [...ALL_STORES];
const FULL_IMAGE = `data:image/jpeg;base64,${'A'.repeat(4000)}`;
const FULL_IMAGE_2 = `data:image/jpeg;base64,${'B'.repeat(4000)}`;
const SMALL_THUMB = 'data:image/jpeg;base64,THUMB';

const pagesOf = (n, dataUrl = FULL_IMAGE) =>
  Array.from({ length: n }, (_, index) => ({
    dataUrl: index === 0 ? dataUrl : `${dataUrl}${index}`,
    size: 3000,
    thumb: SMALL_THUMB
  }));

/* ---------------- 数据库升级 ---------------- */

await check('v4 → v5 清空重建：删除 images、清空遗留缓存、建齐 7 张表', () => {
  const db = createFakeDb(['images', ...LEGACY_CACHE_STORES]);
  db.stores.get('segmentations').set('old:vertical:free', { id: 'old:vertical:free' });
  db.stores.get('practiceDaily').set('2026-11-05', { id: '2026-11-05', count: 3 });
  db.stores.get('images').set('recent_0', { id: 'recent_0', url: FULL_IMAGE });
  const cleared = upgradeStores(db, db.transaction(), 4);
  assert.equal(cleared, true);
  assert.equal(db.objectStoreNames.contains('images'), false);
  assert.equal(db.stores.get('segmentations').size, 0);
  assert.equal(db.stores.get('practiceDaily').size, 0);
  ALL_NAMES.forEach((name) => assert.ok(db.objectStoreNames.contains(name), `缺表 ${name}`));
});

await check('全新安装（oldVersion=0）只建表，不做清理', () => {
  const db = createFakeDb([]);
  const cleared = upgradeStores(db, db.transaction(), 0);
  assert.equal(cleared, false);
  assert.equal(db.stores.size, ALL_NAMES.length);
  assert.equal(db.objectStoreNames.contains('images'), false);
});

await check('重复调用升级逻辑是幂等的', () => {
  const db = createFakeDb([]);
  upgradeStores(db, db.transaction(), 0);
  upgradeStores(db, db.transaction(), 5);
  assert.equal(db.stores.size, ALL_NAMES.length);
});

await check('旧版本缺部分缓存表时不抛错', () => {
  const db = createFakeDb(['images', 'segmentations']);
  assert.doesNotThrow(() => upgradeStores(db, db.transaction(), 3));
  assert.equal(db.objectStoreNames.contains('albums'), true);
});

/* ---------------- 建帖与读取 ---------------- */

await check('常量：字帖数 / 每本页数 / 单次导入上限', () => {
  assert.equal(MAX_ALBUMS, 20);
  assert.equal(MAX_PAGES_PER_ALBUM, 30);
});

await check('createAlbum 把完整原图只写进 pages，元数据里没有 dataUrl', async () => {
  const db = createFakeDb(ALL_NAMES);
  const album = await createAlbum(db, { pages: pagesOf(2), now: 1000 });
  assert.equal(album.pages.length, 2);
  assert.equal(JSON.stringify(album).includes(FULL_IMAGE), false);
  assert.ok(album.coverThumb === SMALL_THUMB);
  assert.equal(db.stores.get(PAGE_STORE).size, 2);
  assert.equal(db.stores.get(THUMB_STORE).size, 2);
  assert.equal(db.stores.get(ALBUM_STORE).size, 1);
});

await check('readAlbums 只返回元数据，绝不携带完整原图', async () => {
  const db = createFakeDb(ALL_NAMES);
  await createAlbum(db, { pages: pagesOf(3), now: 1000 });
  const list = await readAlbums(db);
  assert.equal(list.length, 1);
  assert.equal(list[0].pages.length, 3);
  assert.equal(JSON.stringify(list).includes(FULL_IMAGE), false);
  list[0].pages.forEach((page) => {
    assert.deepEqual(Object.keys(page).sort(), ['addedAt', 'hash', 'id', 'size']);
  });
});

await check('readPage / readThumb 按需单条读取，不牵连其他页', async () => {
  const db = createFakeDb(ALL_NAMES);
  const album = await createAlbum(db, { pages: pagesOf(2), now: 1000 });
  const page = await readPage(db, album.pages[1].id);
  assert.equal(page.dataUrl.startsWith(FULL_IMAGE), true);
  assert.equal(await readThumb(db, album.pages[0].id), SMALL_THUMB);
  assert.equal(await readPage(db, 'not-exist'), null);
  assert.equal(await readThumb(db, 'not-exist'), '');
});

await check('空页列表不能建帖', async () => {
  const db = createFakeDb(ALL_NAMES);
  await assert.rejects(() => createAlbum(db, { pages: [] }), /至少要有一页/);
});

/* ---------------- 加页 / 删页 / 删帖 / 改名 ---------------- */

await check('addPages 追加页并刷新 updatedAt，原有页 id 不变', async () => {
  const db = createFakeDb(ALL_NAMES);
  const album = await createAlbum(db, { pages: pagesOf(1), now: 1000 });
  const next = await addPages(db, album.id, pagesOf(2), 2000);
  assert.equal(next.pages.length, 3);
  assert.equal(next.pages[0].id, album.pages[0].id);
  assert.equal(next.updatedAt, 2000);
  assert.equal(db.stores.get(PAGE_STORE).size, 3);
});

await check('deletePage 只删目标页与它的缩略图', async () => {
  const db = createFakeDb(ALL_NAMES);
  const album = await createAlbum(db, { pages: pagesOf(3), now: 1000 });
  const target = album.pages[1].id;
  const next = await deletePage(db, album.id, target);
  assert.equal(next.pages.length, 2);
  assert.equal(next.pages.some((page) => page.id === target), false);
  assert.equal(db.stores.get(PAGE_STORE).has(target), false);
  assert.equal(db.stores.get(THUMB_STORE).has(target), false);
  assert.equal(db.stores.get(PAGE_STORE).size, 2);
});

await check('deletePage 拒绝删掉最后一页，避免留下空字帖', async () => {
  const db = createFakeDb(ALL_NAMES);
  const album = await createAlbum(db, { pages: pagesOf(1), now: 1000 });
  const next = await deletePage(db, album.id, album.pages[0].id);
  assert.equal(next.pages.length, 1);
  assert.equal(db.stores.get(PAGE_STORE).size, 1);
});

await check('deleteAlbum 删整本及所有页，其它字帖完整保留', async () => {
  const db = createFakeDb(ALL_NAMES);
  const first = await createAlbum(db, { pages: pagesOf(2), now: 1000 });
  const second = await createAlbum(db, { pages: pagesOf(2, FULL_IMAGE_2), now: 2000 });
  await deleteAlbum(db, first.id);
  assert.equal(db.stores.get(ALBUM_STORE).has(first.id), false);
  assert.equal(db.stores.get(ALBUM_STORE).has(second.id), true);
  assert.equal(db.stores.get(PAGE_STORE).size, 2);
  assert.equal(db.stores.get(THUMB_STORE).size, 2);
  second.pages.forEach((page) => assert.ok(db.stores.get(PAGE_STORE).has(page.id)));
});

await check('deleteAlbum 不清理按图片哈希的切分/练习记录（跨字帖共享语义）', async () => {
  const db = createFakeDb(ALL_NAMES);
  db.stores.get('segmentations').set('h1:vertical:free', { id: 'h1:vertical:free' });
  const album = await createAlbum(db, { pages: pagesOf(1), now: 1000 });
  await deleteAlbum(db, album.id);
  assert.equal(db.stores.get('segmentations').size, 1);
});

await check('renameAlbum 去首尾空格，空名直接拒绝', async () => {
  const db = createFakeDb(ALL_NAMES);
  const album = await createAlbum(db, { pages: pagesOf(1), now: 1000 });
  assert.equal(await renameAlbum(db, album.id, '   '), null);
  const renamed = await renameAlbum(db, album.id, '  九成宫  ');
  assert.equal(renamed.title, '九成宫');
  assert.equal((await readAlbums(db))[0].title, '九成宫');
});

/* ---------------- 续练指针与清空 ---------------- */

await check('续练指针：保存 / 读取 / 清除', async () => {
  const db = createFakeDb(ALL_NAMES);
  assert.equal(await readCurrent(db), null);
  await saveCurrent(db, { albumId: 'a1', pageId: 'p2' });
  const pointer = await readCurrent(db);
  assert.equal(pointer.albumId, 'a1');
  assert.equal(pointer.pageId, 'p2');
  await clearCurrent(db);
  assert.equal(await readCurrent(db), null);
});

await check('clearAllAlbums 清空四张字帖表，不动练习/切分缓存', async () => {
  const db = createFakeDb(ALL_NAMES);
  await createAlbum(db, { pages: pagesOf(2), now: 1000 });
  await saveCurrent(db, { albumId: 'a', pageId: 'p' });
  db.stores.get('practiceDaily').set('2026-11-05', { id: '2026-11-05', count: 1 });
  await clearAllAlbums(db);
  [ALBUM_STORE, PAGE_STORE, THUMB_STORE, META_STORE].forEach((name) =>
    assert.equal(db.stores.get(name).size, 0, `${name} 应为空`)
  );
  assert.equal(db.stores.get('practiceDaily').size, 1);
});

await check('同一张图放进两本字帖时 hash 相同（切分/进度按内容共享）', async () => {
  const db = createFakeDb(ALL_NAMES);
  const one = await createAlbum(db, { pages: [{ dataUrl: FULL_IMAGE, thumb: '' }], now: 1000 });
  const two = await createAlbum(db, { pages: [{ dataUrl: FULL_IMAGE, thumb: '' }], now: 2000 });
  assert.equal(one.pages[0].hash, two.pages[0].hash);
  assert.ok(one.pages[0].hash.length < 40, '哈希应是短字符串');
});

await check('makeAlbumTitle 用固定时间戳可复现', () => {
  assert.equal(makeAlbumTitle(3, Date.UTC(2026, 10, 5)), '字帖 11月5日 · 3 页');
});

/* ---------------- 进度汇总 ---------------- */

await check('进度：手动切分结果优先于自动结果', () => {
  const pages = [{ id: 'p1', hash: 'h1' }];
  const segs = [
    { id: 'h1:vertical:free', boxes: new Array(10) },
    { id: 'h1:vertical:free:manual', boxes: new Array(8) }
  ];
  assert.equal(buildProgressMap(pages, segs, []).p1.total, 8);
});

await check('进度：无手动结果时取自动变体里最大的框数', () => {
  const pages = [{ id: 'p1', hash: 'h1' }, { id: 'p2', hash: 'h2' }];
  const segs = [
    { id: 'h1:vertical:free', boxes: new Array(7) },
    { id: 'h1:vertical:grid', boxes: new Array(12) },
    { id: 'h1:auto:free', boxes: [] },
    { id: 'h2:vertical:free:manual', boxes: new Array(4) }
  ];
  const map = buildProgressMap(pages, segs, []);
  assert.equal(map.p1.total, 12);
  assert.equal(map.p2.total, 4);
});

await check('进度：只统计 count>0 的不同字，按 pageId 输出', () => {
  const pages = [{ id: 'p1', hash: 'h1' }, { id: 'p2', hash: 'h2' }];
  const records = [
    { imageHash: 'h1', count: 2 },
    { imageHash: 'h1', count: 1 },
    { imageHash: 'h1', count: 0 },
    { imageHash: 'h3', count: 9 }
  ];
  const map = buildProgressMap(pages, [], records);
  assert.deepEqual(map.p1, { practiced: 2, total: 0 });
  assert.deepEqual(map.p2, { practiced: 0, total: 0 });
});

await check('sumAlbumProgress 把各页进度累加成卡片数字', () => {
  const album = { pages: [{ id: 'p1' }, { id: 'p2' }] };
  const map = {
    p1: { practiced: 3, total: 10 },
    p2: { practiced: 1, total: 8 },
    p3: { practiced: 99, total: 99 }
  };
  assert.deepEqual(sumAlbumProgress(album, map), { practiced: 4, total: 18 });
});

/* ---------------- 静态断言：内存生命周期 ---------------- */

const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const librarySource = readFileSync(new URL('../src/components/Library.jsx', import.meta.url), 'utf8');
const practiceSource = readFileSync(new URL('../src/components/PracticeView.jsx', import.meta.url), 'utf8');

await check('返回字帖库必须清空当前页原图与缩略图缓存', () => {
  const body = appSource.slice(
    appSource.indexOf('const handleBackToLibrary'),
    appSource.indexOf('/* ---------------- 导入')
  );
  assert.ok(/setImage\(null\)/.test(body), '必须释放完整 dataUrl');
  assert.ok(/setSelectedCharacter\(null\)/.test(body), '选中单字内嵌一份原图，也要释放');
  assert.ok(/clearThumbnailCache\(\)/.test(body), '必须清空缩略图缓存');
  assert.ok(/setActiveAlbumId\(null\)/.test(body));
});

await check('字帖列表只读 albums 元数据，绝不 getAll(pages)', () => {
  assert.ok(/readAlbums\(/.test(appSource));
  assert.ok(!/getAll\(\).*pages|transaction\(PAGE_STORE/.test(appSource));
  assert.ok(/readPage\(db, pageId\)/.test(appSource), '完整原图只能单条按需读');
});

await check('字帖库与分页条只渲染小缩略图，不挂完整原图', () => {
  assert.ok(/src=\{album\.coverThumb\}/.test(librarySource));
  assert.ok(!/item\.url/.test(librarySource));
  assert.ok(/readThumb\(db, pageId\)/.test(practiceSource));
  assert.ok(!/src=\{item\.url\}/.test(practiceSource));
  assert.ok(/LazyPageThumb/.test(practiceSource));
});

await check('切页时临摹页按 pageId 重新挂载，旧页状态与位图一起释放', () => {
  assert.ok(/key=\{activePageId\}/.test(appSource));
  assert.ok(/onSwitchPage=\{handleSwitchPage\}/.test(appSource));
});

console.log(`\n${passed} 项通过`);
