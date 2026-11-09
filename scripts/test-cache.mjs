/** 切分缓存与设置清理的单元测试（基于内存模拟的 store） */
import assert from 'node:assert/strict';
import { readSegmentation } from '../src/utils/segmentCache.js';

let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name} — ${error.message}`);
    process.exitCode = 1;
  }
};

const SEGMENT_STORE = 'segmentations';
const SETTINGS_STORE = 'segmentationSettings';

/** 构造一个最小的 IndexedDB 模拟，用于验证「按前缀删除」与「清空」的键匹配逻辑 */
const createFakeDb = (segmentKeys, settingKeys) => {
  const storeData = {
    [SEGMENT_STORE]: new Map(segmentKeys.map((key) => [key, { id: key }])),
    [SETTINGS_STORE]: new Map(settingKeys.map((key) => [key, { id: key }]))
  };
  return {
    objectStoreNames: { contains: (name) => name in storeData },
    storeData
  };
};

/** 复刻 deleteSegmentationByPrefix 的键过滤规则 */
const deleteByPrefix = (db, prefix) => {
  const names = [SEGMENT_STORE, SETTINGS_STORE].filter((name) => db.objectStoreNames.contains(name));
  names.forEach((name) => {
    const store = db.storeData[name];
    [...store.keys()]
      .filter((key) => String(key).startsWith(prefix))
      .forEach((key) => store.delete(key));
  });
  return names;
};

/** 复刻 clearSegmentations */
const clearAll = (db) => {
  const names = [SEGMENT_STORE, SETTINGS_STORE].filter((name) => db.objectStoreNames.contains(name));
  names.forEach((name) => db.storeData[name].clear());
  return names;
};

check('按前缀删除会同时清理切分缓存与字帖设置', () => {
  const db = createFakeDb(
    ['hash1:auto:free', 'hash1:auto:free:manual', 'hash2:auto:free'],
    ['hash1', 'hash2']
  );
  const names = deleteByPrefix(db, 'hash1');
  assert.equal(names.length, 2, '应同时操作两个 store');
  assert.deepEqual([...db.storeData[SEGMENT_STORE].keys()], ['hash2:auto:free']);
  assert.deepEqual([...db.storeData[SETTINGS_STORE].keys()], ['hash2']);
});

check('删除只影响目标字帖，其他记录完整保留', () => {
  const db = createFakeDb(['a:1', 'b:1', 'c:1'], ['a', 'b', 'c']);
  deleteByPrefix(db, 'b');
  assert.equal(db.storeData[SEGMENT_STORE].size, 2);
  assert.equal(db.storeData[SETTINGS_STORE].size, 2);
  assert.ok(!db.storeData[SETTINGS_STORE].has('b'));
});

check('前缀匹配不会误删相似哈希', () => {
  const db = createFakeDb(['abc:1', 'abcd:1'], ['abc', 'abcd']);
  deleteByPrefix(db, 'abc:');
  assert.deepEqual([...db.storeData[SEGMENT_STORE].keys()], ['abcd:1']);
  assert.deepEqual([...db.storeData[SETTINGS_STORE].keys()], ['abc', 'abcd']);
});

check('清空会同时清掉两个 store', () => {
  const db = createFakeDb(['a:1', 'b:1'], ['a', 'b']);
  clearAll(db);
  assert.equal(db.storeData[SEGMENT_STORE].size, 0);
  assert.equal(db.storeData[SETTINGS_STORE].size, 0);
});

check('缺少某个 store 时不报错', () => {
  const db = {
    objectStoreNames: { contains: (name) => name === SEGMENT_STORE },
    storeData: { [SEGMENT_STORE]: new Map([['a:1', {}]]) }
  };
  const names = deleteByPrefix(db, 'a');
  assert.equal(names.length, 1);
  assert.equal(db.storeData[SEGMENT_STORE].size, 0);
});

// —— 读缓存兜底：旧算法留下的乱序框必须在读取时按阅读顺序复原 ——
/** 只实现 readSegmentation 需要的最小 IndexedDB 接口 */
const createReadDb = (record) => ({
  transaction: () => ({
    objectStore: () => ({
      get: () => {
        const request = {};
        queueMicrotask(() => {
          request.result = record;
          if (typeof request.onsuccess === 'function') request.onsuccess();
        });
        return request;
      }
    })
  })
});

// 带题款双联左联的 7 个框：前 4 个正常，后 3 个被旧算法排成 y 倒序
const messyLeft = [
  { x: 152, y: 206, width: 220, height: 194 },
  { x: 158, y: 428, width: 201, height: 260 },
  { x: 151, y: 775, width: 214, height: 48 },
  { x: 158, y: 965, width: 218, height: 276 },
  { x: 152, y: 1835, width: 207, height: 218 },
  { x: 134, y: 1558, width: 224, height: 228 },
  { x: 116, y: 1263, width: 242, height: 256 }
];
const boxKey = (b) => `${b.x},${b.y},${b.width},${b.height}`;

// check 是同步的，这里用一个汇总的异步用例
const asyncChecks = [];
const checkAsync = (name, fn) => asyncChecks.push(
  fn().then(
    () => { passed += 1; console.log(`PASS  ${name}`); },
    (error) => { console.log(`FAIL  ${name} — ${error.message}`); process.exitCode = 1; }
  )
);

checkAsync('读缓存会把旧算法留下的乱序框复原为阅读顺序', async () => {
  const record = {
    id: 'hash:vertical:free',
    layout: 'vertical',
    boxes: messyLeft,
    adjustments: { 3: { dx: 1 } }
  };
  const result = await readSegmentation(createReadDb(record), record.id);
  assert.deepEqual(result.boxes.map((b) => b.y), [206, 428, 775, 965, 1263, 1558, 1835]);
  assert.deepEqual(result.adjustments, record.adjustments, '其它字段必须原样保留');
  assert.equal(result.layout, 'vertical');
  // 只改顺序，不改任何框坐标
  assert.deepEqual(
    [...result.boxes].map(boxKey).sort(),
    messyLeft.map(boxKey).sort()
  );
});

checkAsync('横排缓存按横排规则排序，不套用竖排规则', async () => {
  const boxes = [
    { x: 300, y: 100, width: 80, height: 80 },
    { x: 100, y: 100, width: 80, height: 80 },
    { x: 200, y: 100, width: 80, height: 80 }
  ];
  const result = await readSegmentation(
    createReadDb({ layout: 'horizontal', boxes }), 'hash:horizontal:free'
  );
  assert.deepEqual(result.boxes.map((b) => b.x), [100, 200, 300]);
});

checkAsync('空记录 / 无框记录不会抛错', async () => {
  assert.equal(await readSegmentation(createReadDb(null), 'k'), null);
  const empty = await readSegmentation(createReadDb({ id: 'k', boxes: [] }), 'k');
  assert.deepEqual(empty.boxes, []);
});

await Promise.all(asyncChecks);

console.log(`\n${passed} 项通过`);
