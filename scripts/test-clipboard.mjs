/** 剪贴板检测的纯逻辑测试（不依赖真实剪贴板） */
import assert from 'node:assert/strict';
import { findWeChatArticleUrl, findAnyUrl } from '../src/utils/clipboardDetect.js';

let passed = 0;
const check = (name, fn) => {
  try { fn(); passed += 1; console.log(`PASS  ${name}`); }
  catch (e) { console.log(`FAIL  ${name} — ${e.message}`); process.exitCode = 1; }
};

check('识别公众号链接', () => {
  assert.equal(
    findWeChatArticleUrl('https://mp.weixin.qq.com/s/bPLmHqqI7iiCI-_9O8QbAA'),
    'https://mp.weixin.qq.com/s/bPLmHqqI7iiCI-_9O8QbAA'
  );
});

check('识别带 query 的公众号链接', () => {
  const url = 'https://mp.weixin.qq.com/s/DSWM5PwgMgbtSJlruilX-g?click_id=27';
  assert.equal(findWeChatArticleUrl(url), url);
});

check('从分享文本中提取公众号链接', () => {
  const text = '他是翁同龢之父 https://mp.weixin.qq.com/s/DSWM5PwgMgbtSJlruilX-g?click_id=27 更多';
  assert.ok(findWeChatArticleUrl(text).startsWith('https://mp.weixin.qq.com/s/'));
});

check('非公众号链接不误判为公众号', () => {
  assert.equal(findWeChatArticleUrl('https://example.com/a'), '');
});

check('通用链接识别', () => {
  assert.equal(findAnyUrl('看看这个 https://example.com/x 好'), 'https://example.com/x');
  assert.equal(findAnyUrl('没有链接'), '');
});

check('空输入安全', () => {
  assert.equal(findWeChatArticleUrl(''), '');
  assert.equal(findWeChatArticleUrl(null), '');
  assert.equal(findAnyUrl(null), '');
});

check('纯文本（非链接）不返回 URL', () => {
  assert.equal(findWeChatArticleUrl('今天天气不错'), '');
  assert.equal(findAnyUrl('今天天气不错'), '');
});

console.log(`\n${passed} 项通过`);
