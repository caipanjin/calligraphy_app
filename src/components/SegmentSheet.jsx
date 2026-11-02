import React, { useCallback, useEffect, useState } from 'react';
import { FaTimes, FaRedo, FaExclamationTriangle, FaHandPointer } from 'react-icons/fa';
import { segmentCharacters } from '../utils/segment';
import { hashImageData } from '../utils/imageHash';
import { readSegmentation, writeSegmentation } from '../utils/segmentCache';

const LAYOUT_OPTIONS = [
  { value: 'auto', label: '自动' },
  { value: 'vertical', label: '竖排' },
  { value: 'horizontal', label: '横排' }
];

/**
 * 自动切字抽屉：把整幅字帖按投影切成单字，点任意框直接进入单字临摹
 */
const SegmentSheet = ({ image, db, onSelectCharacter, onClose }) => {
  const [status, setStatus] = useState('loading');
  const [result, setResult] = useState(null);
  const [layout, setLayout] = useState('auto');
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!image) return undefined;

    let cancelled = false;

    const run = async () => {
      try {
        setStatus('loading');
        const img = new Image();
        img.src = image;
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () => reject(new Error('图片加载失败'));
        });
        if (cancelled) return;
        const naturalWidth = img.naturalWidth || img.width;
        const naturalHeight = img.naturalHeight || img.height;
        setImageSize({ width: naturalWidth, height: naturalHeight });

        const cacheKey = `${hashImageData(image)}:${layout}`;

        // 命中缓存直接复用（点「重新切分」时强制重算）
        if (attempt === 0) {
          const cached = await readSegmentation(db, cacheKey);
          if (cancelled) return;
          if (cached && cached.boxes && cached.boxes.length > 0 && cached.imageWidth === naturalWidth) {
            setResult({ boxes: cached.boxes, layout: cached.layout, strategy: cached.strategy });
            setStatus('done');
            return;
          }
        }

        const segmentation = await segmentCharacters(image, { layout });
        if (cancelled) return;

        setResult(segmentation);
        const empty = segmentation.failed || segmentation.boxes.length === 0;
        setStatus(empty ? 'empty' : 'done');

        if (!empty) {
          writeSegmentation(db, cacheKey, {
            boxes: segmentation.boxes,
            layout: segmentation.layout,
            strategy: segmentation.strategy,
            imageWidth: naturalWidth,
            imageHeight: naturalHeight
          });
        }
      } catch (error) {
        if (!cancelled) setStatus('error');
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [image, layout, attempt, db]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleRetry = useCallback(() => setAttempt((value) => value + 1), []);

  const handlePick = (box, index) => {
    const padding = Math.max(2, Math.round(Math.min(box.width, box.height) * 0.06));
    const x = Math.max(0, box.x - padding);
    const y = Math.max(0, box.y - padding);
    onSelectCharacter({
      src: image,
      width: imageSize.width,
      height: imageSize.height,
      viewBox: {
        x,
        y,
        width: Math.min(imageSize.width - x, box.width + padding * 2),
        height: Math.min(imageSize.height - y, box.height + padding * 2)
      },
      // 带上切分网格：临摹页的「上一字 / 下一字」按真实字框跳，而不是等距推算
      grid: { boxes, index }
    });
  };

  const boxes = result && !result.failed ? result.boxes : [];

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="自动切字">
        <div className="sheet__handle" />
        <div className="sheet__header">
          <h3 className="sheet__title">
            自动切字
            {status === 'done' && (
              <span className="section-head__hint" style={{ marginLeft: 8 }}>
                {result.layout === 'vertical' ? '竖排' : '横排'} · {boxes.length} 字
              </span>
            )}
          </h3>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <FaTimes size={15} />
          </button>
        </div>

        <div className="sheet__body">
          <div className="segmented">
            {LAYOUT_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={`segmented__item${layout === option.value ? ' segmented__item--active' : ''}`}
                onClick={() => setLayout(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          {status === 'loading' && <div className="seg-hint">正在分析版面…</div>}

          {status === 'error' && (
            <div className="sheet-empty">
              <FaExclamationTriangle />
              <span>切分失败，可换一张图或直接手动点选单字。</span>
            </div>
          )}

          {status === 'empty' && (
            <div className="sheet-empty">
              <FaExclamationTriangle />
              <span>没有找到可切分的文字区域。字距太密或背景较脏时，建议手动点选。</span>
            </div>
          )}

          {status === 'done' && (
            <div className="seg-preview">
              <img src={image} alt="切分结果" />
              {boxes.map((box, index) => (
                <button
                  key={index}
                  className="seg-box"
                  style={{
                    left: `${(box.x / imageSize.width) * 100}%`,
                    top: `${(box.y / imageSize.height) * 100}%`,
                    width: `${(box.width / imageSize.width) * 100}%`,
                    height: `${(box.height / imageSize.height) * 100}%`
                  }}
                  onClick={() => handlePick(box, index)}
                  aria-label={`选择第 ${index + 1} 个字`}
                />
              ))}
            </div>
          )}
        </div>

        <div className="sheet__footer">
          {status !== 'loading' && (
            <button className="btn btn--ghost" onClick={handleRetry}>
              <FaRedo size={13} />
              重新切分
            </button>
          )}
          <button className="btn btn--primary btn--block" onClick={onClose}>
            <FaHandPointer size={13} />
            手动点选
          </button>
        </div>
      </div>
    </>
  );
};

export default SegmentSheet;
