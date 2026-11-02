import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FaTimes,
  FaLink,
  FaDownload,
  FaCheck,
  FaExclamationTriangle,
  FaClipboard
} from 'react-icons/fa';
import {
  extractImageUrls,
  isWeChatArticleUrl,
  pickFirstUrl,
  isWeChatBlockedPage,
  readImageSize,
  looksLikeSticker
} from '../utils/wechatArticle';
import { fetchText, fetchImageAsDataUrl } from '../utils/httpClient';

/** 同一篇文章的抓取结果缓存（微信限流严格，避免重复请求） */
const articleCache = new Map();
const CACHE_TTL = 10 * 60 * 1000;

/**
 * 从公众号文章导入字帖
 *
 * 流程：粘贴链接 → 抓文章 → 提取图片 → 勾选 → 下载导入
 * 原生环境下用 CapacitorHttp 绕开 CORS；Web 开发环境需 dev server 代理。
 */
const ImportSheet = ({ onImport, onClose, initialUrl = '' }) => {
  const [url, setUrl] = useState(initialUrl);
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [images, setImages] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [errorMessage, setErrorMessage] = useState('');
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState('');
  const [title, setTitle] = useState('');
  const cancelledRef = useRef(false);

  useEffect(() => () => { cancelledRef.current = true; }, []);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(pickFirstUrl(text) || text);
    } catch (error) {
      setErrorMessage('无法读取剪贴板，请手动粘贴链接');
    }
  }, []);

  const handleFetch = useCallback(async () => {
    const target = pickFirstUrl(url) || url.trim();
    if (!target) {
      setErrorMessage('请先粘贴文章链接');
      setStatus('error');
      return;
    }
    if (!isWeChatArticleUrl(target)) {
      setErrorMessage('这不像是公众号文章链接（应形如 mp.weixin.qq.com/s/...）');
      setStatus('error');
      return;
    }

    cancelledRef.current = false;
    setStatus('loading');
    setErrorMessage('');
    setImages([]);
    setSelected(new Set());

    try {
      // 命中缓存直接复用（微信对短时间内的重复请求会限流）
      const cached = articleCache.get(target);
      let usedCache = false;
      let throttled = false;
      let text = '';
      let httpStatus = 200;

      if (cached) {
        text = cached.text;
        usedCache = true;
      } else {
        const response = await fetchText(target);
        text = response.text;
        httpStatus = response.status;

        // 微信对高频请求会返回「精简页」（只有引导下载/验证的内容），
        // 特征：HTTP 200 但正文极短且不含 js_content。
        // 微信限流的特征：HTTP 200 但没有 js_content（返回的是精简引导页）
        const looksTiny = !text.includes('js_content');
        if (httpStatus === 200 && looksTiny) {
          throttled = true;
          // 重试两次，间隔递增（实测限流窗口约 1 分钟，这里给到 ~4 秒，
          // 再长会让用户等太久，剩下的靠提示让用户稍后再试）
          for (const wait of [2000, 4000]) {
            setProgress(`微信返回了精简页，正在重试…`);
            await new Promise((resolve) => setTimeout(resolve, wait));
            if (cancelledRef.current) return;
            const retry = await fetchText(target);
            if (retry.status === 200 && retry.text.includes('js_content')) {
              text = retry.text;
              httpStatus = retry.status;
              throttled = false;
              break;
            }
          }
          setProgress('');
        }

        if (httpStatus === 200 && text.includes('js_content')) {
          articleCache.set(target, { text, at: Date.now() });
        }
      }

      if (cancelledRef.current) return;

      if (httpStatus !== 200) {
        setErrorMessage(`抓取失败（HTTP ${httpStatus}）。文章可能需要验证或已删除。`);
        setStatus('error');
        return;
      }

      // 微信风控：请求过于频繁时会被跳转到验证页
      if (isWeChatBlockedPage(text)) {
        setErrorMessage('微信暂时限制了访问（出现验证页）。请等 1~2 分钟再试，或直接在微信内保存图片后从相册导入。');
        setStatus('error');
        return;
      }

      const urls = extractImageUrls(text);
      if (urls.length === 0) {
        setErrorMessage(
          throttled
            ? '微信暂时限制了抓取（返回了精简页）。请等 1~2 分钟再点「抓取文章图片」，或在微信里长按图片保存到相册后从相册导入。'
            : '文章里没有找到图片，可能是纯文字或图片被加密。'
        );
        setStatus('error');
        return;
      }

      // 文章标题（用于默认命名）
      const titleMatch =
        text.match(/<meta property="og:title" content="([^"]+)"/) ||
        text.match(/<h1[^>]*>([^<]+)<\/h1>/);
      setTitle(titleMatch ? titleMatch[1].trim() : '');

      setImages(urls);
      setSelected(new Set(urls.map((_, i) => i))); // 默认全选
      setStatus('done');
      if (usedCache) setErrorMessage('');
    } catch (error) {
      if (cancelledRef.current) return;
      const isCors = isWebLikeCors(error);
      setErrorMessage(
        isCors
          ? '浏览器里无法直接抓取公众号页面（跨域限制）。请在手机 App 内使用此功能。'
          : `抓取失败：${error.message || '网络错误'}`
      );
      setStatus('error');
    }
  }, [url]);

  // 首次带链接进入时自动抓取
  useEffect(() => {
    if (initialUrl) handleFetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (index) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleImport = useCallback(async () => {
    const indices = [...selected].sort((a, b) => a - b);
    if (indices.length === 0) return;

    setImporting(true);
    const results = [];
    const seenHashes = new Set();
    let skipped = 0;
    try {
      for (let i = 0; i < indices.length; i += 1) {
        const index = indices[i];
        setProgress(`下载并检查 ${i + 1}/${indices.length}`);
        try {
          const dataUrl = await fetchImageAsDataUrl(images[index]);

          // 用内容哈希去重（同一张图可能以不同 URL 出现多次）
          const hash = quickHash(dataUrl);
          if (seenHashes.has(hash)) {
            skipped += 1;
            continue;
          }

          // 尺寸过滤：剔除头像、二维码、横幅等干扰图
          const size = readImageSize(dataUrl);
          if (!looksLikeSticker(size)) {
            skipped += 1;
            continue;
          }

          seenHashes.add(hash);
          results.push({ url: dataUrl, source: images[index] });
        } catch (error) {
          console.error('图片下载失败', images[index], error);
        }
        if (cancelledRef.current) break;
      }
      setProgress('');
      if (results.length === 0) {
        setErrorMessage('没有可用的字帖图片（可能都是头像/二维码等干扰图），请在其他文章重试');
        setStatus('error');
        return;
      }
      if (skipped > 0) {
        // 通过回调让 App 显示提示
        onImport(results, { skipped });
      } else {
        onImport(results, { skipped: 0 });
      }
    } finally {
      setImporting(false);
    }
  }, [images, onImport, selected]);

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="从公众号导入">
        <div className="sheet__handle" />
        <div className="sheet__header">
          <h3 className="sheet__title">
            从公众号导入
            {status === 'done' && (
              <span className="section-head__hint" style={{ marginLeft: 8 }}>
                {images.length} 张图 · 已选 {selected.size}
              </span>
            )}
          </h3>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <FaTimes size={15} />
          </button>
        </div>

        <div className="sheet__body">
          <div className="import-url-row">
            <div className="import-url-input">
              <FaLink size={13} />
              <input
                type="text"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="粘贴公众号文章链接 mp.weixin.qq.com/s/..."
                spellCheck={false}
              />
            </div>
            <button className="icon-btn" onClick={handlePaste} aria-label="粘贴" title="从剪贴板粘贴">
              <FaClipboard size={14} />
            </button>
          </div>

          <button
            className="btn btn--primary btn--block import-fetch"
            onClick={handleFetch}
            disabled={status === 'loading'}
          >
            {status === 'loading' ? '正在抓取文章…' : '抓取文章图片'}
          </button>

          {status === 'error' && (
            <div className="sheet-empty">
              <FaExclamationTriangle />
              <span>{errorMessage}</span>
            </div>
          )}

          {status === 'done' && (
            <>
              {title && <div className="import-title">{title}</div>}
              <div className="import-grid">
                {images.map((imageUrl, index) => (
                  <button
                    key={index}
                    className={`import-thumb${selected.has(index) ? ' import-thumb--selected' : ''}`}
                    onClick={() => toggle(index)}
                    aria-label={`第 ${index + 1} 张图`}
                  >
                    <img src={imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
                    {selected.has(index) && (
                      <span className="import-thumb__check">
                        <FaCheck size={11} />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="sheet__footer">
          {status === 'done' && (
            <>
              <button
                className="btn btn--ghost"
                onClick={() =>
                  setSelected((prev) => (prev.size === images.length ? new Set() : new Set(images.map((_, i) => i))))
                }
              >
                {selected.size === images.length ? '全不选' : '全选'}
              </button>
              <button
                className="btn btn--primary btn--block"
                onClick={handleImport}
                disabled={selected.size === 0 || importing}
              >
                <FaDownload size={13} />
                {importing ? progress || '导入中…' : `导入 ${selected.size} 张`}
              </button>
            </>
          )}
          {status !== 'done' && (
            <button className="btn btn--ghost btn--block" onClick={onClose}>
              取消
            </button>
          )}
        </div>
      </div>
    </>
  );
};

/** 对 data URL 做快速内容哈希（取长度 + 抽样 FNV-1a） */
const quickHash = (dataUrl) => {
  const len = dataUrl.length;
  const stride = Math.max(1, Math.floor(len / 20000));
  let hash = 0x811c9dc5;
  for (let i = 0; i < len; i += stride) {
    hash ^= dataUrl.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${len.toString(36)}-${hash.toString(36)}`;
};

const isWebLikeCors = (error) => {
  const message = String((error && error.message) || '');
  return /Failed to fetch|NetworkError|Load failed|CORS/i.test(message);
};

export default ImportSheet;
