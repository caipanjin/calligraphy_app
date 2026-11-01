import React, { useCallback, useEffect, useState } from 'react';
import { FaTimes, FaRedo, FaExclamationTriangle, FaChevronRight } from 'react-icons/fa';
import {
  preprocessImage,
  recognizeText,
  groupWordsByLine,
  mapBboxToSource,
  describeOcrError,
  OCR_ERROR
} from '../utils/ocr';

const RING_RADIUS = 36;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * OCR 结果抽屉：进度环、文字 / 原图标注双视图、失败可重试
 */
const OCRSheet = ({ image, onSelectCharacter, onClose }) => {
  const [status, setStatus] = useState('loading');
  const [progress, setProgress] = useState(0);
  const [words, setWords] = useState([]);
  const [lines, setLines] = useState([]);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKind, setErrorKind] = useState(null);
  const [tab, setTab] = useState('text');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!image) return undefined;

    let cancelled = false;

    const run = async () => {
      try {
        setStatus('loading');
        setProgress(0);
        setErrorMessage('');
        setErrorKind(null);
        setWords([]);
        setLines([]);

        const img = new Image();
        img.src = image;
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () => reject(new Error('图片加载失败'));
        });
        if (cancelled) return;

        setImageSize({
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height
        });

        const { dataUrl, scale } = await preprocessImage(image);
        if (cancelled) return;

        const result = await recognizeText(
          dataUrl,
          (percent) => {
            if (!cancelled) setProgress(percent);
          },
          { skipCache: attempt > 0 }
        );
        if (cancelled) return;

        if (!result.words || result.words.length === 0) {
          setErrorKind(OCR_ERROR.NO_TEXT);
          setErrorMessage(describeOcrError({ kind: OCR_ERROR.NO_TEXT }));
          setStatus('error');
          return;
        }

        const mapped = result.words.map((word) => ({
          ...word,
          bbox: mapBboxToSource(word.bbox, scale)
        }));

        setWords(mapped);
        setLines(groupWordsByLine(mapped, scale > 0 ? 20 / scale : 20));
        setStatus('done');
      } catch (error) {
        if (cancelled) return;
        setErrorKind(error && error.kind ? error.kind : OCR_ERROR.UNKNOWN);
        setErrorMessage(describeOcrError(error));
        setStatus('error');
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [image, attempt]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleRetry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  const handleWordClick = (word) => {
    const padding = 10;
    const { width: imageWidth, height: imageHeight } = imageSize;
    const x = Math.max(0, word.bbox.x0 - padding);
    const y = Math.max(0, word.bbox.y0 - padding);

    onSelectCharacter({
      src: image,
      width: imageWidth,
      height: imageHeight,
      viewBox: {
        x,
        y,
        width: Math.min(imageWidth - x, word.bbox.x1 - word.bbox.x0 + padding * 2),
        height: Math.min(imageHeight - y, word.bbox.y1 - word.bbox.y0 + padding * 2)
      }
    });
  };

  const retryable = errorKind !== OCR_ERROR.ASSET;

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="文字识别">
        <div className="sheet__handle" />
        <div className="sheet__header">
          <h3 className="sheet__title">
            文字识别
            {status === 'done' && (
              <span className="section-head__hint" style={{ marginLeft: 8 }}>
                {words.length} 字
              </span>
            )}
          </h3>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <FaTimes size={15} />
          </button>
        </div>

        <div className="sheet__body">
          {status === 'loading' && (
            <div className="ocr-progress">
              <div className="ocr-progress__ring">
                <svg viewBox="0 0 84 84">
                  <circle cx="42" cy="42" r={RING_RADIUS} fill="none" stroke="var(--surface-3)" strokeWidth="6" />
                  <circle
                    cx="42"
                    cy="42"
                    r={RING_RADIUS}
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={RING_CIRCUMFERENCE}
                    strokeDashoffset={RING_CIRCUMFERENCE * (1 - progress / 100)}
                    style={{ transition: 'stroke-dashoffset 0.3s ease' }}
                  />
                </svg>
                <span className="ocr-progress__value">{progress}%</span>
              </div>
              <span className="ocr-progress__label">正在识别文字，首次使用需加载本地语言包</span>
            </div>
          )}

          {status === 'error' && (
            <div className="ocr-empty">
              <FaExclamationTriangle />
              <span>{errorMessage}</span>
            </div>
          )}

          {status === 'done' && (
            <>
              <div className="segmented">
                <button
                  className={`segmented__item${tab === 'text' ? ' segmented__item--active' : ''}`}
                  onClick={() => setTab('text')}
                >
                  识别文字
                </button>
                <button
                  className={`segmented__item${tab === 'overlay' ? ' segmented__item--active' : ''}`}
                  onClick={() => setTab('overlay')}
                >
                  原图标注
                </button>
              </div>

              {tab === 'text' ? (
                <div className="ocr-lines">
                  {lines.map((line, lineIndex) => (
                    <div className="ocr-line" key={lineIndex}>
                      {line.words.map((word, wordIndex) => (
                        <button
                          className="ocr-chip"
                          key={wordIndex}
                          onClick={() => handleWordClick(word)}
                          title={`置信度 ${Math.round(word.confidence || 0)}%`}
                        >
                          {word.text}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="ocr-preview">
                  <img src={image} alt="识别标注" />
                  {words.map((word, index) => (
                    <button
                      key={index}
                      className="ocr-box"
                      style={{
                        left: `${(word.bbox.x0 / imageSize.width) * 100}%`,
                        top: `${(word.bbox.y0 / imageSize.height) * 100}%`,
                        width: `${((word.bbox.x1 - word.bbox.x0) / imageSize.width) * 100}%`,
                        height: `${((word.bbox.y1 - word.bbox.y0) / imageSize.height) * 100}%`
                      }}
                      onClick={() => handleWordClick(word)}
                      aria-label={`选择 ${word.text}`}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="sheet__footer">
          {status === 'error' && retryable && (
            <button className="btn btn--ghost" onClick={handleRetry}>
              <FaRedo size={13} />
              重新识别
            </button>
          )}
          {status === 'done' && (
            <button className="btn btn--ghost" onClick={handleRetry}>
              <FaRedo size={13} />
              重新识别
            </button>
          )}
          <button className="btn btn--primary btn--block" onClick={onClose}>
            {status === 'done' ? '开始逐字临摹' : '手动选择字符'}
            <FaChevronRight size={12} />
          </button>
        </div>
      </div>
    </>
  );
};

export default OCRSheet;
