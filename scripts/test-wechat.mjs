/** 公众号图片提取的单元测试 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  extractImageUrls,
  isWeChatArticleUrl,
  pickFirstUrl,
  guessImageWidth,
  filterUsableImages,
  isWeChatBlockedPage
} from '../src/utils/wechatArticle.js';

let passed = 0;
const check = (name, fn) => {
  try { fn(); passed += 1; console.log(`PASS  ${name}`); }
  catch (e) { console.log(`FAIL  ${name} — ${e.message}`); process.exitCode = 1; }
};

check('提取图片：基本形态', () => {
  const html = '<img src="https://mmbiz.qpic.cn/sz_mmbiz_jpg/ABC/640?wx_fmt=jpeg">';
  assert.deepEqual(extractImageUrls(html), ['https://mmbiz.qpic.cn/sz_mmbiz_jpg/ABC/640?wx_fmt=jpeg']);
});

check('提取图片：协议相对 // 补 https', () => {
  const html = '"//mmbiz.qpic.cn/mmbiz_png/XYZ/0?wx_fmt=png"';
  assert.deepEqual(extractImageUrls(html), ['https://mmbiz.qpic.cn/mmbiz_png/XYZ/0?wx_fmt=png']);
});

check('提取图片：http 升为 https', () => {
  const html = '"http://mmbiz.qpic.cn/mmbiz_jpg/A/0?wx_fmt=jpeg"';
  assert.deepEqual(extractImageUrls(html), ['https://mmbiz.qpic.cn/mmbiz_jpg/A/0?wx_fmt=jpeg']);
});

check('提取图片：去重且保持顺序', () => {
  const html = `
    "https://mmbiz.qpic.cn/a/640?wx_fmt=jpeg"
    "https://mmbiz.qpic.cn/b/640?wx_fmt=jpeg"
    "https://mmbiz.qpic.cn/a/640?wx_fmt=jpeg"
  `;
  const urls = extractImageUrls(html);
  assert.equal(urls.length, 2);
  assert.ok(urls[0].includes('/a/'));
  assert.ok(urls[1].includes('/b/'));
});

check('提取图片：空输入安全', () => {
  assert.deepEqual(extractImageUrls(''), []);
  assert.deepEqual(extractImageUrls(null), []);
});

check('识别公众号文章链接', () => {
  assert.equal(isWeChatArticleUrl('https://mp.weixin.qq.com/s/FowHzkNmgEMe6XDRSpljcw'), true);
  assert.equal(isWeChatArticleUrl('https://example.com/s/abc'), false);
  assert.equal(isWeChatArticleUrl('不是链接'), false);
});

check('从分享文本中挑出链接', () => {
  const text = '在董其昌的笔下，看李白的月亮 https://mp.weixin.qq.com/s/FowHzkNmgEMe6XDRSpljcw 更多';
  assert.equal(pickFirstUrl(text), 'https://mp.weixin.qq.com/s/FowHzkNmgEMe6XDRSpljcw');
});

check('解析图片宽度', () => {
  assert.equal(guessImageWidth('https://mmbiz.qpic.cn/a/640?wx_fmt=jpeg'), 640);
  assert.equal(guessImageWidth('https://mmbiz.qpic.cn/a/0?wx_fmt=png'), 0);
});

check('过滤过小图片，保留原图标记(0)', () => {
  const urls = [
    'https://mmbiz.qpic.cn/a/100?wx_fmt=png',   // 小，去掉
    'https://mmbiz.qpic.cn/b/640?wx_fmt=jpeg',  // 够大，保留
    'https://mmbiz.qpic.cn/c/0?wx_fmt=jpeg'     // 原图，保留
  ];
  const out = filterUsableImages(urls);
  assert.equal(out.length, 2);
  assert.ok(!out.some(u => u.includes('/a/')));
});

check('识别微信风控验证页', () => {
  assert.equal(isWeChatBlockedPage('<html>wappoc_appmsgcaptcha</html>'), true);
  assert.equal(isWeChatBlockedPage('<div>环境异常</div>'), true);
  assert.equal(isWeChatBlockedPage('<html><img src="https://mmbiz.qpic.cn/a/640?wx_fmt=jpeg"></html>'), false);
});

// 真实文章回归（若存在抓取样本）
const sample = '/tmp/wx.html';
if (fs.existsSync(sample)) {
  check('真实文章：《在董其昌的笔下，看李白的月亮》应提取到 14 张图', () => {
    const html = fs.readFileSync(sample, 'utf8');
    const urls = extractImageUrls(html);
    assert.equal(urls.length, 14, `实际 ${urls.length} 张`);
    assert.ok(urls.every(u => u.startsWith('https://mmbiz.qpic.cn/')));
  });
} else {
  console.log('SKIP  真实文章回归（无 /tmp/wx.html 样本）');
}

console.log(`\n${passed} 项通过`);
