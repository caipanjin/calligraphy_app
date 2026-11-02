/** 练习记录模块的纯逻辑测试（不依赖真实 IndexedDB） */
import assert from 'node:assert/strict';
import {
  practiceKey,
  dailyKey,
  countPracticed,
  PRACTICE_THRESHOLD_MS
} from '../src/utils/practiceStore.js';

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

check('练习记录键：图片哈希 + 索引', () => {
  assert.equal(practiceKey('abc123', 5), 'abc123:5');
  assert.equal(practiceKey('abc123', 0), 'abc123:0');
});

check('不同图片/不同索引的键互不相同', () => {
  assert.notEqual(practiceKey('a', 1), practiceKey('a', 2));
  assert.notEqual(practiceKey('a', 1), practiceKey('b', 1));
});

check('日期键格式 YYYY-MM-DD 且补零', () => {
  assert.equal(dailyKey(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(dailyKey(new Date(2026, 11, 31)), '2026-12-31');
});

check('日期键：月末边界正确', () => {
  assert.equal(dailyKey(new Date(2026, 1, 28)), '2026-02-28');
});

check('已练字数：只统计 count > 0 的记录', () => {
  const records = new Map([
    [0, { index: 0, count: 3 }],
    [1, { index: 1, count: 0 }],
    [2, { index: 2, count: 1 }]
  ]);
  assert.equal(countPracticed(records), 2);
});

check('已练字数：空记录返回 0', () => {
  assert.equal(countPracticed(new Map()), 0);
});

check('3 秒阈值常量正确', () => {
  assert.equal(PRACTICE_THRESHOLD_MS, 3000);
});

console.log(`\n${passed} 项通过`);
