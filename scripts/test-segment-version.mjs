/**
 * 切分缓存「算法版本」回归测试。
 *
 * 与 test-cache.mjs（复刻键过滤规则）不同，本文件直接 import 真实的
 * src/utils/segmentCache.js，用内存版 IndexedDB mock 跑真实的读写函数，
 * 确保「写入注入版本 / 旧记录失效 / 手动结果豁免」测的是产品实现。
 *
 * 运行：node scripts/test-segment-version.mjs
 */
import assert from 'node:assert/strict';
import {
  SEGMENT_ALGORITHM_VERSION,
  isCurrentSegmentation,
  canReuseSegmentation,
  readSegmentation,
  writeSegmentation,
  deleteSegmentation,
  deleteSegmentationByPrefix,
  clearSegmentations
} from '../src/utils/segmentCache.js';

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

/** 最小 IndexedDB mock：get/put/delete/getAllKeys/clear + 事务完成事件 */
const createFakeDb = (initialSegments = {}, initialSettings = {}) => {
  const stores = {
    segmentations: new Map(Object.entries(initialSegments)),
    segmentationSettings: new Map(Object.entries(initialSettings))
  };
  const makeRequest = (result) => {
    const request = { result };
    queueMicrotask(() => request.onsuccess && request.onsuccess());
    return request;
  };
  const makeStore = (name) => {
    const map = stores[name];
    return {
      get: (key) => makeRequest(map.get(key)),
      put: (value) => {
        map.set(value.id, value);
        return makeRequest(value.id);
      },
      delete: (key) => {
        map.delete(key);
        return makeRequest(undefined);
      },
      getAllKeys: () => makeRequest([...map.keys()]),
      clear: () => map.clear()
    };
  };
  return {
    stores,
    objectStoreNames: { contains: (name) => name in stores },
    transaction: () => {
      const tx = {
        addEventListener: () => {},
        oncomplete: null,
        onerror: null,
        onabort: null,
        objectStore: (name) => makeStore(name)
      };
      // 宏任务触发，保证 getAllKeys 的 onsuccess（微任务）先执行完
      setTimeout(() => tx.oncomplete && tx.oncomplete(), 0);
      return tx;
    }
  };
};

const boxes = [{ x: 1, y: 2, width: 3, height: 4 }];
const AUTO_KEY = 'hash1:vertical:free';
const MANUAL_KEY = `${AUTO_KEY}:manual`;
const CURRENT = { algorithmVersion: SEGMENT_ALGORITHM_VERSION };

/** 模拟组件里的「命中缓存就跳过重算」决策顺序（判据本身是真实模块函数） */
const needsRecompute = async (db, cacheKey) => {
  const manualKey = `${cacheKey}:manual`;
  const manual = await readSegmentation(db, manualKey);
  if (canReuseSegmentation(manual, manualKey)) return false;
  const auto = await readSegmentation(db, cacheKey);
  return !canReuseSegmentation(auto, cacheKey);
};

await check('当前算法版本固定为 8（升级算法时须同步改测试与说明）', () => {
  assert.equal(SEGMENT_ALGORITHM_VERSION, 8);
});

await check('旧记录（无 algorithmVersion 字段）视为过期', () => {
  assert.equal(isCurrentSegmentation({ boxes }), false);
});

await check('低版本记录视为过期', () => {
  assert.equal(isCurrentSegmentation({ boxes, algorithmVersion: 1 }), false);
});

await check('当前版本记录有效', () => {
  assert.equal(isCurrentSegmentation({ boxes, ...CURRENT }), true);
});

await check('空记录 / 空 boxes 一律不可复用', () => {
  assert.equal(canReuseSegmentation(null, AUTO_KEY), false);
  assert.equal(canReuseSegmentation({ boxes: [], ...CURRENT }, AUTO_KEY), false);
  assert.equal(canReuseSegmentation({ ...CURRENT }, AUTO_KEY), false);
});

await check('旧手动结果豁免版本校验，永久保留', () => {
  assert.equal(canReuseSegmentation({ boxes }, MANUAL_KEY), true);
  assert.equal(canReuseSegmentation({ boxes, algorithmVersion: 1 }, MANUAL_KEY), true);
  assert.equal(canReuseSegmentation({ boxes, ...CURRENT }, MANUAL_KEY), true);
});

await check('旧自动结果不可复用', () => {
  assert.equal(canReuseSegmentation({ boxes }, AUTO_KEY), false);
  assert.equal(canReuseSegmentation({ boxes, algorithmVersion: 1 }, AUTO_KEY), false);
});

await check('当前算法产出的自动结果可复用', () => {
  assert.equal(canReuseSegmentation({ boxes, ...CURRENT }, AUTO_KEY), true);
});

await check('真实 writeSegmentation 会注入版本号且保留原有字段', async () => {
  const db = createFakeDb();
  const ok = await writeSegmentation(db, AUTO_KEY, {
    boxes,
    layout: 'vertical',
    strategy: 'projection',
    imageWidth: 996
  });
  assert.equal(ok, true);
  const record = db.stores.segmentations.get(AUTO_KEY);
  assert.equal(record.algorithmVersion, SEGMENT_ALGORITHM_VERSION);
  assert.equal(record.layout, 'vertical');
  assert.equal(record.imageWidth, 996);
  assert.deepEqual(record.boxes, boxes);
  assert.equal(typeof record.savedAt, 'number');
  assert.equal((await readSegmentation(db, AUTO_KEY)).algorithmVersion, SEGMENT_ALGORITHM_VERSION);
});

await check('调用方无法通过 payload 覆盖版本号', async () => {
  const db = createFakeDb();
  await writeSegmentation(db, AUTO_KEY, { boxes, algorithmVersion: 999 });
  assert.equal(db.stores.segmentations.get(AUTO_KEY).algorithmVersion, SEGMENT_ALGORITHM_VERSION);
});

await check('升级链路：旧自动缓存触发重算 → 同键覆盖 → 不留孤儿记录', async () => {
  const db = createFakeDb({ [AUTO_KEY]: { id: AUTO_KEY, boxes } });
  assert.equal(await needsRecompute(db, AUTO_KEY), true, '旧缓存应触发重算');

  // 模拟重算成功后写入（真实写入会带上当前版本号）
  await writeSegmentation(db, AUTO_KEY, { boxes: [...boxes, ...boxes], layout: 'vertical' });
  assert.equal(await needsRecompute(db, AUTO_KEY), false, '新结果应可直接复用');
  assert.equal(db.stores.segmentations.size, 1, '同键覆盖，不应产生新键');
  assert.equal(db.stores.segmentations.get(AUTO_KEY).boxes.length, 2);
});

await check('升级链路：旧手动结果不会被重算覆盖', async () => {
  const db = createFakeDb({ [MANUAL_KEY]: { id: MANUAL_KEY, boxes } });
  assert.equal(await needsRecompute(db, AUTO_KEY), false, '手动结果应优先复用');
  assert.equal((await readSegmentation(db, MANUAL_KEY)).boxes.length, 1);
});

await check('新版本缓存可正常复用，不会每次都重算', async () => {
  const db = createFakeDb({ [AUTO_KEY]: { id: AUTO_KEY, boxes, ...CURRENT } });
  assert.equal(await needsRecompute(db, AUTO_KEY), false);
});

await check('手动结果优先于当前算法的自动结果', async () => {
  const db = createFakeDb({
    [AUTO_KEY]: { id: AUTO_KEY, boxes, ...CURRENT },
    [MANUAL_KEY]: { id: MANUAL_KEY, boxes: [...boxes, ...boxes] }
  });
  const manual = await readSegmentation(db, MANUAL_KEY);
  assert.equal(canReuseSegmentation(manual, MANUAL_KEY), true);
  assert.equal(await needsRecompute(db, AUTO_KEY), false);
});

await check('删除单条缓存仍正常（重新切分时清掉手动结果）', async () => {
  const db = createFakeDb({ [MANUAL_KEY]: { id: MANUAL_KEY, boxes } });
  assert.equal(await deleteSegmentation(db, MANUAL_KEY), true);
  assert.equal(await readSegmentation(db, MANUAL_KEY), null);
});

await check('按 hash 前缀删除仍能清掉自动 + 手动结果及设置', async () => {
  const db = createFakeDb(
    {
      [AUTO_KEY]: { id: AUTO_KEY, boxes, ...CURRENT },
      [MANUAL_KEY]: { id: MANUAL_KEY, boxes },
      'hash2:vertical:free': { id: 'hash2:vertical:free', boxes, ...CURRENT }
    },
    { hash1: { id: 'hash1', layout: 'vertical' } }
  );
  assert.equal(await deleteSegmentationByPrefix(db, 'hash1'), true);
  assert.deepEqual([...db.stores.segmentations.keys()], ['hash2:vertical:free']);
  assert.equal(db.stores.segmentationSettings.size, 0);
});

await check('清空缓存仍同时清空两个 store', async () => {
  const db = createFakeDb(
    { [AUTO_KEY]: { id: AUTO_KEY, boxes, ...CURRENT } },
    { hash1: { id: 'hash1' } }
  );
  assert.equal(await clearSegmentations(db), true);
  assert.equal(db.stores.segmentations.size, 0);
  assert.equal(db.stores.segmentationSettings.size, 0);
});

await check('db 不可用时读写安全降级，不抛异常', async () => {
  assert.equal(await readSegmentation(null, AUTO_KEY), null);
  assert.equal(await writeSegmentation(null, AUTO_KEY, { boxes }), false);
});

console.log(`\n${passed} 项通过`);
