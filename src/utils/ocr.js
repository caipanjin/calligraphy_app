import { createWorker } from 'tesseract.js';

/**
 * 离线 OCR 引擎封装。
 *
 * 关键点：
 * 1. worker / wasm core / 语言包全部走本地 public/tesseract（由 scripts/fetch-ocr-assets.mjs 生成），
 *    不依赖 CDN，飞行模式下也能首次识别。
 * 2. worker 单例复用，避免每次识别都重新加载 12MB 资源。
 * 3. 识别任务串行排队：tesseract 的 worker 同一时刻只能处理一个任务。
 * 4. 按图片内容哈希缓存识别结果，切换图片来回看不重复算。
 * 5. 超时/资源缺失/无文字等错误分类，便于 UI 给出可操作提示。
 */

const ASSET_BASE = `${import.meta.env.BASE_URL}tesseract`;
const OCR_LANGS = 'chi_sim+eng';
const RECOGNIZE_TIMEOUT_MS = 120000;
const WORKER_INIT_TIMEOUT_MS = 90000;
const MAX_CACHE_ENTRIES = 8;

export const OCR_ERROR = {
  ASSET: 'asset',
  TIMEOUT: 'timeout',
  NO_TEXT: 'no-text',
  UNKNOWN: 'unknown'
};

const ocrError = (kind, message, cause) => {
  const error = new Error(message);
  error.kind = kind;
  if (cause) error.cause = cause;
  return error;
};

export const describeOcrError = (error) => {
  const kind = error && error.kind;
  if (kind === OCR_ERROR.ASSET) {
    return '本地识别资源加载失败。请确认已执行 npm run ocr:assets，或重新安装依赖后重试。';
  }
  if (kind === OCR_ERROR.TIMEOUT) {
    return '识别超时。图片过大或设备较慢，可重试或换一张较小的图片。';
  }
  if (kind === OCR_ERROR.NO_TEXT) {
    return '未识别到文字。书法字体与印刷体差异较大，可直接点击图片手动选择字符。';
  }
  return '识别失败，可重试或手动选择字符。';
};

const withTimeout = (promise, timeoutMs) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(ocrError(OCR_ERROR.TIMEOUT, `操作超时（${Math.round(timeoutMs / 1000)}s）`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

let workerPromise = null;
let progressHandler = null;

const createOcrWorker = async () => {
  const worker = await createWorker(OCR_LANGS, 1, {
    workerPath: `${ASSET_BASE}/worker.min.js`,
    corePath: `${ASSET_BASE}/core`,
    langPath: `${ASSET_BASE}/lang`,
    // 语言包已随包体分发，无需再往 IndexedDB 写一份
    cacheMethod: 'none',
    logger: (message) => {
      if (message && message.status === 'recognizing text' && progressHandler) {
        progressHandler(Math.round((message.progress || 0) * 100));
      }
    }
  });
  return worker;
};

export const getOcrWorker = () => {
  if (!workerPromise) {
    const init = createOcrWorker();
    workerPromise = withTimeout(init, WORKER_INIT_TIMEOUT_MS)
      .catch((error) => {
        init.then((worker) => worker.terminate()).catch(() => {});
        if (error && error.kind === OCR_ERROR.TIMEOUT) {
          throw ocrError(OCR_ERROR.ASSET, '识别引擎初始化超时', error);
        }
        throw ocrError(OCR_ERROR.ASSET, '识别引擎初始化失败', error);
      })
      .catch((error) => {
        workerPromise = null;
        throw error;
      });
  }
  return workerPromise;
};

export const resetOcrWorker = () => {
  const current = workerPromise;
  workerPromise = null;
  progressHandler = null;
  if (current) {
    current
      .then((worker) => worker.terminate())
      .catch(() => {});
  }
};

// tesseract 的 worker 同一时刻只能跑一个任务，这里用队列串行化
let taskQueue = Promise.resolve();

const enqueue = (task) => {
  const run = taskQueue.then(task, task);
  taskQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
};

const resultCache = new Map();

/**
 * 图片内容哈希：对 data URL 抽样做 FNV-1a，避免对几 MB 字符串做全量遍历。
 */
const hashImageData = (dataUrl) => {
  const length = dataUrl.length;
  const stride = Math.max(1, Math.floor(length / 200000));
  let hash = 0x811c9dc5;
  for (let i = 0; i < length; i += stride) {
    hash ^= dataUrl.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${length.toString(36)}-${hash.toString(36)}`;
};

const rememberResult = (key, value) => {
  if (resultCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = resultCache.keys().next().value;
    resultCache.delete(oldestKey);
  }
  resultCache.set(key, value);
};

/**
 * 图片预处理：限制尺寸、灰度化、Gamma 对比度增强。
 * 返回的 scale 是预处理图相对原图的缩放比，识别结果的 bbox 需按它回算。
 */
export const preprocessImage = (imageData) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      const maxSize = 2000;
      const sourceWidth = img.naturalWidth || img.width;
      const sourceHeight = img.naturalHeight || img.height;
      let width = sourceWidth;
      let height = sourceHeight;

      if (width > maxSize || height > maxSize) {
        if (width > height) {
          height = Math.round((height / width) * maxSize);
          width = maxSize;
        } else {
          width = Math.round((width / height) * maxSize);
          height = maxSize;
        }
      }

      // 预处理图相对原图的缩放比，识别结果的 bbox 需按它回算到原图坐标系
      const scale = sourceWidth > 0 ? width / sourceWidth : 1;

      canvas.width = width;
      canvas.height = height;

      ctx.drawImage(img, 0, 0, width, height);

      const imageDataObj = ctx.getImageData(0, 0, width, height);
      const data = imageDataObj.data;

      for (let i = 0; i < data.length; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        data[i] = gray;
        data[i + 1] = gray;
        data[i + 2] = gray;
      }

      ctx.putImageData(imageDataObj, 0, 0);

      const grayData = ctx.getImageData(0, 0, width, height);

      // 逐像素求极值：Math.min(...arr) 在百万级数组上会抛 RangeError（爆栈）
      let minVal = 255;
      let maxVal = 0;
      for (let i = 0; i < grayData.data.length; i += 4) {
        const v = grayData.data[i];
        if (v < minVal) minVal = v;
        if (v > maxVal) maxVal = v;
      }

      const range = maxVal - minVal;

      if (range > 0) {
        for (let i = 0; i < grayData.data.length; i += 4) {
          const normalized = (grayData.data[i] - minVal) / range;
          const enhanced = Math.pow(normalized, 1.5) * 255;
          grayData.data[i] = enhanced;
          grayData.data[i + 1] = enhanced;
          grayData.data[i + 2] = enhanced;
        }
      }

      ctx.putImageData(grayData, 0, 0);

      resolve({
        dataUrl: canvas.toDataURL('image/jpeg', 0.9),
        scale,
        width,
        height
      });
    };

    img.onerror = () => reject(new Error('图片加载失败，无法进行预处理'));
    img.src = imageData;
  });
};

/**
 * 识别文字。bbox 位于“预处理图”坐标系，调用方需用 mapBboxToSource 回算。
 *
 * @param {string} imageData 预处理后的 data URL
 * @param {(percent:number)=>void} [onProgress] 识别进度回调
 * @param {{skipCache?: boolean, timeoutMs?: number}} [options]
 */
export const recognizeText = (imageData, onProgress, options = {}) => {
  const { skipCache = false, timeoutMs = RECOGNIZE_TIMEOUT_MS } = options;
  const cacheKey = `${OCR_LANGS}:${hashImageData(imageData)}`;

  if (!skipCache && resultCache.has(cacheKey)) {
    if (onProgress) onProgress(100);
    return Promise.resolve(resultCache.get(cacheKey));
  }

  return enqueue(async () => {
    const worker = await getOcrWorker();
    progressHandler = onProgress || null;
    try {
      const recognizeTask = worker.recognize(imageData);
      const { data } = await withTimeout(recognizeTask, timeoutMs).catch((error) => {
        if (error && error.kind === OCR_ERROR.TIMEOUT) {
          // 超时后 worker 仍在跑，直接重建，避免后续任务全部卡住
          recognizeTask.catch(() => {});
          resetOcrWorker();
        }
        throw error;
      });

      const words = (data.words || [])
        .filter((word) => word.text && word.text.trim().length > 0)
        .map((word) => ({
          text: word.text,
          bbox: {
            x0: word.bbox.x0,
            y0: word.bbox.y0,
            x1: word.bbox.x1,
            y1: word.bbox.y1
          },
          confidence: word.confidence
        }));

      const result = { words, text: (data.text || '').trim() };
      rememberResult(cacheKey, result);
      return result;
    } catch (error) {
      if (error && error.kind) throw error;
      throw ocrError(OCR_ERROR.UNKNOWN, '识别失败', error);
    } finally {
      progressHandler = null;
    }
  });
};

// 将预处理图坐标系下的 bbox 映射回原图坐标系
export const mapBboxToSource = (bbox, scale) => {
  const ratio = scale > 0 ? 1 / scale : 1;
  return {
    x0: Math.round(bbox.x0 * ratio),
    y0: Math.round(bbox.y0 * ratio),
    x1: Math.round(bbox.x1 * ratio),
    y1: Math.round(bbox.y1 * ratio)
  };
};

export const groupWordsByLine = (words, yThreshold = 20) => {
  const lines = [];
  const sortedWords = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0);

  for (const word of sortedWords) {
    let addedToLine = false;

    for (const line of lines) {
      const lineY = line.avgY;
      const wordY = word.bbox.y0;

      if (Math.abs(lineY - wordY) < yThreshold) {
        line.words.push(word);
        line.avgY = (line.avgY * (line.words.length - 1) + wordY) / line.words.length;
        addedToLine = true;
        break;
      }
    }

    if (!addedToLine) {
      lines.push({
        words: [word],
        avgY: word.bbox.y0
      });
    }
  }

  // 行内按 x 升序，避免 tesseract 返回的 word 顺序错乱（如“九永和年”）
  // 注：竖排书法需按列切分，属于后续“整幅自动切字”的范畴
  lines.forEach((line) => line.words.sort((a, b) => a.bbox.x0 - b.bbox.x0));

  return lines.sort((a, b) => a.avgY - b.avgY);
};
