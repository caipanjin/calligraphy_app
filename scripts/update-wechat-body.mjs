#!/usr/bin/env node
/**
 * 公众号正文更新（固定通道）
 *
 * 把一份 Markdown 定稿整篇替换进「已经打开的公众号图文编辑器」，
 * 保留标题、摘要、封面等表单字段不动，并保住公众号排版（标题 / 列表 / 代码块 / 加粗）。
 *
 *   node scripts/update-wechat-body.mjs docs/wechat-article-title1-final.md
 *   node scripts/update-wechat-body.mjs <md> --dry-run       # 只生成 HTML 并统计
 *   node scripts/update-wechat-body.mjs --check-only         # 只读编辑器状态
 *
 * 完整说明见 docs/wechat-editor-workflow.md
 *
 * 前置条件：
 *   1. 发布专用 Chrome 已登录公众号后台，且打开了图文编辑页（URL 含 appmsg_edit）
 *   2. Node >= 22（需要全局 fetch / WebSocket）
 *   3. 生成 HTML 需要 bun + baoyu-post-to-wechat skill；已有 HTML 时可用 --html 跳过
 *
 * 只需这一条命令，不要再手工推理 CDP / 剪贴板 / 粘贴事件的细节。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync, spawnSync } from "node:child_process";

const HOME = os.homedir();
const DEFAULT_CONVERTER = path.join(
  HOME,
  ".workbuddy/skills/baoyu-post-to-wechat/scripts/md-to-wechat.ts",
);
const EDITOR_SELECTOR = ".rich_media_content .ProseMirror";
const FALLBACK_PORTS = [57338];
const MOD_META = process.platform === "darwin" ? 4 : 2;

const HELP = `用法:
  node scripts/update-wechat-body.mjs <markdown.md> [选项]
  node scripts/update-wechat-body.mjs --check-only

选项:
  --html <path>        使用已渲染好的公众号 HTML，跳过 Markdown 转换
  --theme <name>       渲染主题（默认 default）
  --converter <path>   指定 md-to-wechat.ts 路径
  --port <n>           指定 Chrome 调试端口（默认自动探测）
  --dry-run            只生成 HTML 并输出统计，不连浏览器、不修改编辑器
  --check-only         只读取当前编辑器状态，不修改任何内容
  --json               输出单个 JSON 对象（步骤日志不再打印）
  --help               显示本帮助

示例:
  node scripts/update-wechat-body.mjs docs/wechat-article-title1-final.md
  node scripts/update-wechat-body.mjs docs/wechat-article-title1-final.md --dry-run
  node scripts/update-wechat-body.mjs --check-only --json
`;

// ---------------------------------------------------------------- 参数

function parseArgs(argv) {
  const opts = {
    markdown: null,
    html: null,
    theme: "default",
    converter: DEFAULT_CONVERTER,
    port: null,
    dryRun: false,
    checkOnly: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      console.log(HELP);
      process.exit(0);
    } else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--check-only") opts.checkOnly = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--html") opts.html = argv[++i];
    else if (a === "--theme") opts.theme = argv[++i];
    else if (a === "--converter") opts.converter = argv[++i];
    else if (a === "--port") opts.port = Number(argv[++i]);
    else if (a.startsWith("-")) throw new Error(`未知参数: ${a}`);
    else if (!opts.markdown) opts.markdown = a;
    else throw new Error("只能指定一个 Markdown 文件");
  }
  if (!opts.checkOnly && !opts.html && !opts.markdown) {
    throw new Error("请指定 Markdown 文件，或使用 --html / --check-only");
  }
  for (const p of [opts.markdown, opts.html]) {
    if (p && !fs.existsSync(path.resolve(p))) throw new Error(`文件不存在: ${p}`);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const log = (...args) => { if (!opts.json) console.log(...args); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- HTML 生成

function findBun() {
  for (const candidate of ["bun", "/opt/homebrew/bin/bun", "/usr/local/bin/bun"]) {
    const r = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (r.status === 0) return candidate;
  }
  return null;
}

function renderMarkdown(markdownPath) {
  if (!fs.existsSync(opts.converter)) {
    throw new Error(`找不到转换器: ${opts.converter}（可用 --converter 指定）`);
  }
  const bun = findBun();
  if (!bun) throw new Error("生成 HTML 需要 bun；或改用 --html 直接提供已渲染的 HTML");

  // md-to-wechat.ts 带 CLI 入口，必须走子进程，import 会先执行它的 usage
  const r = spawnSync(
    bun,
    [opts.converter, path.resolve(markdownPath), "--theme", opts.theme],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
  if (r.status !== 0) {
    throw new Error(`Markdown 转换失败: ${(r.stderr || r.stdout || "").trim().slice(0, 500)}`);
  }
  const out = (r.stdout || "").trim();
  const start = out.indexOf("{");
  const end = out.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("转换器输出不是 JSON");
  const parsed = JSON.parse(out.slice(start, end + 1));
  if (!parsed.htmlPath || !fs.existsSync(parsed.htmlPath)) {
    throw new Error("转换器未产出 HTML 文件");
  }
  return { htmlPath: parsed.htmlPath, title: parsed.title || "", summary: parsed.summary || "" };
}

function extractFragment(htmlPath) {
  const html = fs.readFileSync(htmlPath, "utf8");
  // baoyu-md 产出完整文档，正文在 <div id="output"> 内
  const m = html.match(/<div id="output"[^>]*>([\s\S]*)<\/div>\s*<\/body>/);
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
  const fragment = (m ? m[1] : body ? body[1] : html).trim();
  if (fragment.length < 200) throw new Error("HTML 正文片段异常短，拒绝替换");

  const plain = fragment
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return { fragment, plain };
}

// ---------------------------------------------------------------- CDP

function detectPort() {
  if (opts.port) return opts.port;
  let ps = "";
  try {
    ps = execFileSync("ps", ["-axo", "args="], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  } catch {
    // 忽略，走兜底端口
  }
  const lines = ps.split("\n").filter(
    (l) => l.includes("baoyu-skills/chrome-profile") && l.includes("--remote-debugging-port="),
  );
  for (const line of lines) {
    const m = line.match(/--remote-debugging-port=(\d+)/);
    if (m) return Number(m[1]);
  }
  return null;
}

async function findEditorPort() {
  const candidates = [...new Set([detectPort(), ...FALLBACK_PORTS].filter(Boolean))];
  for (const port of candidates) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const target = list.find(
        (t) => t.type === "page" && (t.url.includes("appmsg_edit") || t.url.includes("appmsg")),
      );
      if (target) return { port, target, list };
    } catch {
      // 端口不通，试下一个
    }
  }
  throw new Error(
    "找不到公众号编辑器窗口。请确认发布专用 Chrome 已登录并打开图文编辑页（URL 含 appmsg_edit），" +
      "或用 --port 指定调试端口。",
  );
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (!msg.id || !this.pending.has(msg.id)) return;
      const { resolve, reject, timer } = this.pending.get(msg.id);
      clearTimeout(timer);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || String(msg.error)));
      else resolve(msg.result);
    });
  }

  static async connect(url) {
    if (typeof WebSocket === "undefined") {
      throw new Error("需要 Node >= 22（全局 WebSocket 不可用）");
    }
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
      setTimeout(() => reject(new Error("WebSocket 连接超时")), 8000);
    });
    return new Cdp(ws);
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP 超时: ${method}`));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true });
    if (r.exceptionDetails) {
      throw new Error(`页面脚本异常: ${r.exceptionDetails.text || "unknown"}`);
    }
    return r.result?.value;
  }

  close() {
    try { this.ws.close(); } catch { /* 忽略 */ }
  }
}

const STATE_EXPR = `JSON.stringify((function(){
  const e = document.querySelector(${JSON.stringify(EDITOR_SELECTOR)});
  const txt = e ? (e.innerText || '').trim() : '';
  const h = e ? e.innerHTML : '';
  const count = (re) => (h.match(re) || []).length;
  const t = document.querySelector('#title');
  const d = document.querySelector('#digest') || document.querySelector('textarea[name="digest"]');
  return {
    bodyLen: txt.length,
    head: txt.slice(0, 70),
    tail: txt.slice(-50),
    sections: count(/<section/g),
    paragraphs: count(/<p[ >]/g),
    pres: count(/<pre/g),
    headings: count(/<h[1-6][ >]/g),
    listItems: count(/<li[ >]/g),
    strongs: count(/<strong[ >]/g),
    title: t ? (t.value || '') : null,
    digestLen: d ? (d.value || '').length : -1,
    fullText: txt
  };
})())`;

async function readState(cdp) {
  return JSON.parse(await cdp.evaluate(STATE_EXPR));
}

async function clickEditor(cdp) {
  const rect = JSON.parse(await cdp.evaluate(`JSON.stringify((function(){
    const e = document.querySelector(${JSON.stringify(EDITOR_SELECTOR)});
    if (!e) return { ok: false };
    e.scrollIntoView({ block: 'center' });
    const r = e.getBoundingClientRect();
    return { ok: true, x: r.left + Math.min(r.width / 2, 240), y: r.top + Math.min(r.height / 2, 40) };
  })())`));
  if (!rect.ok) throw new Error("找不到正文编辑器 (.rich_media_content .ProseMirror)");
  // 两次真实点击，贴近手工操作，确保 contenteditable 拿到焦点
  for (let i = 0; i < 2; i++) {
    for (const type of ["mousePressed", "mouseReleased"]) {
      await cdp.send("Input.dispatchMouseEvent", {
        type, x: rect.x, y: rect.y, button: "left", clickCount: 1,
      });
    }
    await sleep(200);
  }
}

async function ensureFocus(cdp) {
  const r = JSON.parse(await cdp.evaluate(`JSON.stringify((function(){
    const e = document.querySelector(${JSON.stringify(EDITOR_SELECTOR)});
    if (!e) return { ok: false, reason: 'editor-missing' };
    e.focus();
    const a = document.activeElement;
    return { ok: a === e || e.contains(a), active: a ? a.tagName : null };
  })())`));
  if (!r.ok) {
    throw new Error(`焦点不在正文编辑器（activeElement=${r.active}），已中止，避免误删标题或摘要`);
  }
}

async function press(cdp, key, code, vk, modifiers = 0) {
  const p = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
  await cdp.send("Input.dispatchKeyEvent", { ...p, type: "keyDown" });
  await sleep(70);
  await cdp.send("Input.dispatchKeyEvent", { ...p, type: "keyUp" });
  await sleep(150);
}

// ---------------------------------------------------------------- 主流程

function verify(before, after, plain) {
  const normalize = (s) => s.replace(/\s+/g, " ").trim();
  const expectedHead = normalize(plain).slice(0, 24);
  const afterText = normalize(after.fullText || "");
  const blocks =
    after.sections + after.paragraphs + after.headings + after.listItems;
  return {
    headMatch: expectedHead.length > 0 && afterText.includes(expectedHead),
    structured: blocks >= 5,
    lengthOk: after.bodyLen >= Math.max(200, normalize(plain).length * 0.7),
    blocks,
    expectedHead,
    oldBodyLen: before ? before.bodyLen : 0,
    afterBodyLen: after.bodyLen,
  };
}

function printReport(state, extra = {}) {
  log(`  正文 ${state.bodyLen} 字 | 块结构 ${state.sections + state.paragraphs + state.headings + state.listItems} 个` +
      ` | 代码块 ${state.pres} | 加粗 ${state.strongs}`);
  log(`  开头: ${state.head.replace(/\s+/g, " ").slice(0, 46)}`);
  log(`  标题: ${state.title || "(空)"}`);
  if (extra.backup) log(`  旧正文备份: ${extra.backup}`);
  if (extra.note) log(`  ${extra.note}`);
}

async function main() {
  if (typeof WebSocket === "undefined") {
    throw new Error("需要 Node >= 22（全局 WebSocket 不可用）");
  }

  let rendered = { htmlPath: null, title: "", summary: "" };
  let fragment = "";
  let plain = "";

  if (!opts.checkOnly) {
    log("[1/5] 生成公众号 HTML ...");
    if (opts.html) {
      rendered.htmlPath = path.resolve(opts.html);
      log(`  使用现成 HTML: ${rendered.htmlPath}`);
    } else {
      rendered = renderMarkdown(opts.markdown);
      log(`  转换器输出: ${rendered.htmlPath}`);
    }
    const extracted = extractFragment(rendered.htmlPath);
    fragment = extracted.fragment;
    plain = extracted.plain;
    log(`  正文片段 ${fragment.length} 字符 / 纯文本 ${plain.length} 字`);
    if (opts.dryRun) {
      const dry = {
        status: "DRY_RUN",
        htmlPath: rendered.htmlPath,
        htmlChars: fragment.length,
        plainChars: plain.length,
        title: rendered.title,
        summary: rendered.summary,
        head: plain.slice(0, 60),
      };
      if (opts.json) console.log(JSON.stringify(dry, null, 2));
      else log("  --dry-run 结束，未连接浏览器、未修改编辑器");
      return { code: 0, result: dry };
    }
  }

  log("[2/5] 定位公众号编辑器 ...");
  const { port, target } = await findEditorPort();
  log(`  CDP 端口 ${port} | ${target.url.slice(0, 90)}`);
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  // 尽力激活标签页；page-level WebSocket 不支持 Target.activateTarget，用 HTTP 端点
  await fetch(`http://127.0.0.1:${port}/json/activate/${target.id}`).catch(() => {});

  try {
    const before = await readState(cdp);
    if (opts.checkOnly) {
      const result = { status: "CHECK_ONLY", port, ...before, fullText: undefined };
      if (opts.json) console.log(JSON.stringify(result, null, 2));
      else { log("[3/5] 只读检查:"); printReport(before); }
      return { code: 0, result };
    }

    log("[3/5] 备份旧正文并聚焦编辑器 ...");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = path.join(os.tmpdir(), `wechat-body-backup-${stamp}.txt`);
    fs.writeFileSync(backup, before.fullText || "(empty)", "utf8");
    log(`  ${backup} (${before.bodyLen} 字)`);

    await clickEditor(cdp);
    await ensureFocus(cdp);

    log("[4/5] 清空并粘贴富文本正文 ...");
    await press(cdp, "a", "KeyA", 65, MOD_META);      // Cmd/Ctrl + A
    await press(cdp, "Backspace", "Backspace", 8, 0);
    await sleep(400);

    // 唯一能保住公众号排版的方式：派发带 text/html 的 paste 事件
    const pasteExpr = `(function(){
      const e = document.querySelector(${JSON.stringify(EDITOR_SELECTOR)});
      if (!e) return JSON.stringify({ ok: false, reason: 'editor-missing' });
      e.focus();
      const dt = new DataTransfer();
      dt.setData('text/html', ${JSON.stringify(fragment)});
      dt.setData('text/plain', ${JSON.stringify(plain)});
      e.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData: dt, bubbles: true, cancelable: true
      }));
      return JSON.stringify({ ok: true });
    })()`;
    await cdp.evaluate(pasteExpr);

    log("  等待编辑器解析（最多 12 秒）...");
    let after = null;
    let check = null;
    for (let i = 0; i < 12; i++) {
      await sleep(1000);
      after = await readState(cdp);
      check = verify(before, after, plain);
      if (check.headMatch && check.structured && check.lengthOk) break;
    }

    let status = "OK";
    let code = 0;
    if (!(check.headMatch && check.structured && check.lengthOk)) {
      log("  富文本粘贴未通过校验，用 insertHTML 兜底恢复文字 ...");
      const fallbackExpr = `(function(){
        const e = document.querySelector(${JSON.stringify(EDITOR_SELECTOR)});
        if (!e) return 'editor-missing';
        e.focus();
        const r = document.createRange(); r.selectNodeContents(e); r.collapse(true);
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        document.execCommand('insertHTML', false, ${JSON.stringify(fragment)});
        return 'ok';
      })()`;
      await cdp.evaluate(fallbackExpr);
      await sleep(2000);
      after = await readState(cdp);
      check = verify(before, after, plain);
      status = check.headMatch && check.lengthOk ? "FALLBACK_FLAT" : "FAILED";
      code = status === "FAILED" ? 1 : 2;
    }

    log(`[5/5] 校验: ${status}`);
    printReport(after, {
      backup,
      note: status === "FALLBACK_FLAT"
        ? "兜底恢复成功，但排版被压平；请在编辑器里手动重新粘贴一次（Word/浏览器复制富文本）"
        : status === "FAILED"
          ? "替换失败，旧正文已备份到上面的路径"
          : "标题与摘要未改动；摘要 / 封面 / 保存草稿仍需手动完成",
    });

    const result = {
      status,
      port,
      htmlPath: rendered.htmlPath,
      title: rendered.title,
      summary: rendered.summary,
      backup,
      before: { bodyLen: check.oldBodyLen, title: before.title, digestLen: before.digestLen },
      after: {
        bodyLen: after.bodyLen,
        title: after.title,
        digestLen: after.digestLen,
        blocks: check.blocks,
        pres: after.pres,
        strongs: after.strongs,
        headMatch: check.headMatch,
        structured: check.structured,
      },
    };
    if (opts.json) console.log(JSON.stringify(result, null, 2));
    return { code, result };
  } finally {
    cdp.close();
  }
}

let exitCode = 0;
try {
  const { code } = await main();
  exitCode = code;
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (opts.json) console.log(JSON.stringify({ status: "ERROR", message }, null, 2));
  else console.error(`ERROR: ${message}`);
  exitCode = 1;
}
process.exit(exitCode);
