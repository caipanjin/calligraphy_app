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
  extractContentImageUrls,
  isWeChatArticleUrl,
  pickFirstUrl,
  isWeChatBlockedPage,
  readImageSize,
  looksLikeSticker,
  computeDHash,
  isSameImage
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
  // 过滤统计：原始张数 / 保留张数 / 跳过张数
  const [filteredInfo, setFilteredInfo] = useState(null);
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

      // 只取正文图片：微信页面里封面、头像、二维码都有明确标记，直接排除，
      // 比靠尺寸/视觉相似度去猜可靠得多
      const urls = extractContentImageUrls(text);
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

      // 抓取完就立刻做过滤与去重，让用户看到的列表就是最终可用的图
      setProgress(`正在分析 ${urls.length} 张图片…`);
      const prepared = await prepareImages(urls, (done, total) => {
        setProgress(`正在分析 ${done}/${total}…`);
      });
      if (cancelledRef.current) return;
      setProgress('');

      if (prepared.items.length === 0) {
        setErrorMessage(
          `文章里的 ${urls.length} 张图都不适合做字帖（可能是头像、二维码或尺寸过小）。`
        );
        setStatus('error');
        return;
      }

      setImages(prepared.items);
      setSelected(new Set(prepared.items.map((_, i) => i))); // 默认全选
      setFilteredInfo({
        original: urls.length,
        kept: prepared.items.length,
        skipped: prepared.skipped
      });
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

    // 图片在抓取阶段已经下载并过滤完毕，这里直接使用，无需再下载
    const results = indices.map((index) => ({
      url: images[index].url,
      source: images[index].source,
      width: images[index].width,
      height: images[index].height
    }));

    if (results.length === 0) return;
    onImport(results, { skipped: filteredInfo ? filteredInfo.skipped : 0 });
  }, [filteredInfo, images, onImport, selected]);

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
                {images.length} 张 · 已选 {selected.size}
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
              {filteredInfo && filteredInfo.skipped > 0 && (
                <div className="import-note">
                  已自动跳过 {filteredInfo.skipped} 张重复或无关的图片
                  （原图 {filteredInfo.original} 张）
                </div>
              )}
              <div className="import-grid">
                {images.map((image, index) => (
                  <button
                    key={index}
                    className={`import-thumb${selected.has(index) ? ' import-thumb--selected' : ''}`}
                    onClick={() => toggle(index)}
                    aria-label={`第 ${index + 1} 张图`}
                  >
                    <img src={image.url} alt="" loading="lazy" referrerPolicy="no-referrer" />
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
                {selected.size === images.length ? '取消全选' : '全选'}
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

/**
 * 下载全部图片并做「尺寸过滤 + 视觉去重」，返回最终可用的图片列表
 *
 * 关键：这一步在**抓取完成后**就执行，而不是等到点导入。
 * 否则用户会看到一堆重复图，选完才发现被合并掉了。
 */
const prepareImages = async (urls, onProgress) => {
  const items = [];
  const hashes = [];
  let skipped = 0;

  for (let i = 0; i < urls.length; i += 1) {
    if (onProgress) onProgress(i + 1, urls.length);
    try {
      const dataUrl = await fetchImageAsDataUrl(urls[i]);
      const size = readImageSize(dataUrl);

      // 1) 尺寸/比例过滤
      if (!looksLikeSticker(size)) {
        skipped += 1;
        continue;
      }

      // 2) 视觉去重
      const image = await loadImageForHash(dataUrl);
      if (!image) {
        skipped += 1;
        continue;
      }
      const hash = computeDHash(image);
      const duplicateIndex = hashes.findIndex((existing) => isSameImage(existing, hash));
      if (duplicateIndex >= 0) {
        // 保留分辨率更高的那一张
        const existing = items[duplicateIndex];
        if (size.width * size.height > existing.width * existing.height) {
          items[duplicateIndex] = {
            url: dataUrl,
            source: urls[i],
            width: size.width,
            height: size.height
          };
        }
        skipped += 1;
        continue;
      }

      hashes.push(hash);
      items.push({ url: dataUrl, source: urls[i], width: size.width, height: size.height });
    } catch (error) {
      skipped += 1;
    }
  }

  return { items, skipped };
};

/** 把 data URL 解码成 Image（用于计算感知哈希） */
const loadImageForHash = (dataUrl) =>
  new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = dataUrl;
  });

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
