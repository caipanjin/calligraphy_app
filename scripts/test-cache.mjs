/** 切分缓存与设置清理的单元测试（基于内存模拟的 store） */
import assert from 'node:assert/strict';

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

console.log(`\n${passed} 项通过`);
