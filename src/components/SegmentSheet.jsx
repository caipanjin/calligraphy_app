import React, { useCallback, useEffect, useState } from 'react';
import {
  FaTimes,
  FaRedo,
  FaExclamationTriangle,
  FaHandPointer,
  FaTrashAlt,
  FaCompress,
  FaCut,
  FaPen,
  FaCheck
} from 'react-icons/fa';
import { segmentCharacters } from '../utils/segment';
import { hashImageData } from '../utils/imageHash';
import { readSegmentation, writeSegmentation } from '../utils/segmentCache';
import { removeBox, mergeBoxes, splitBox, findNearestBoxIndex } from '../utils/boxEdit';

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
  const [hasGrid, setHasGrid] = useState(false);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [attempt, setAttempt] = useState(0);
  // 编辑模式：选中的框索引（null 表示未选中）
  const [editing, setEditing] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(null);
  // 用户手动修改过的框（非 null 时优先于自动结果，且不写回缓存）
  const [editedBoxes, setEditedBoxes] = useState(null);

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

        const cacheKey = `${hashImageData(image)}:${layout}:${hasGrid ? 'grid' : 'free'}`;

        // 命中缓存直接复用（点「重新切分」时强制重算）
        if (attempt === 0) {
          const cached = await readSegmentation(db, cacheKey);
          if (cancelled) return;
          if (cached && cached.boxes && cached.boxes.length > 0 && cached.imageWidth === naturalWidth) {
            setResult({ boxes: cached.boxes, layout: cached.layout, strategy: cached.strategy });
            setEditedBoxes(null);
            setSelectedIndex(null);
            setStatus('done');
            return;
          }
        }

        const segmentation = await segmentCharacters(image, { layout, hasGrid });
        if (cancelled) return;

        setResult(segmentation);
        setEditedBoxes(null);
        setSelectedIndex(null);
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
  }, [image, layout, hasGrid, attempt, db]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleRetry = useCallback(() => setAttempt((value) => value + 1), []);

  const handleBoxClick = (box, index) => {
    if (editing) {
      setSelectedIndex((current) => (current === index ? null : index));
      return;
    }
    handlePick(box, index);
  };

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

  const autoBoxes = result && !result.failed ? result.boxes : [];
  const boxes = editedBoxes || autoBoxes;

  // 任意编辑后切到「用户结果」，后续操作都基于它
  const applyBoxes = (next) => {
    setEditedBoxes(next);
    setSelectedIndex(null);
  };

  const handleDelete = () => {
    if (selectedIndex === null) return;
    applyBoxes(removeBox(boxes, selectedIndex));
  };

  const handleMerge = () => {
    if (selectedIndex === null) return;
    const neighbor = findNearestBoxIndex(boxes, selectedIndex);
    if (neighbor < 0) return;
    applyBoxes(mergeBoxes(boxes, selectedIndex, neighbor));
  };

  const handleSplit = () => {
    if (selectedIndex === null) return;
    applyBoxes(splitBox(boxes, selectedIndex, result.layout === 'vertical'));
  };

  const handleResetEdit = () => {
    setEditedBoxes(null);
    setSelectedIndex(null);
  };

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
                {result.strategy === 'grid-lines' ? '按格线' : result.layout === 'vertical' ? '竖排' : '横排'} ·{' '}
                {boxes.length} 字
              </span>
            )}
          </h3>
          {status === 'done' && (
            <button
              className={`icon-btn${editing ? ' icon-btn--accent' : ''}`}
              onClick={() => {
                setEditing((value) => !value);
                setSelectedIndex(null);
              }}
              aria-label={editing ? '完成编辑' : '编辑切分框'}
              title={editing ? '完成编辑' : '编辑'}
            >
              {editing ? <FaCheck size={15} /> : <FaPen size={14} />}
            </button>
          )}
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

          <label className="seg-toggle">
            <input
              type="checkbox"
              checked={hasGrid}
              onChange={(event) => setHasGrid(event.target.checked)}
            />
            <span>这张字帖带格子线</span>
            <em>开启后按格线切分，更准</em>
          </label>

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

          {status === 'done' && editing && (
            <div className="seg-edit-hint">
              {selectedIndex === null
                ? '点击任意框选中，再选择下方操作'
                : `已选中第 ${selectedIndex + 1} 个框`}
            </div>
          )}

          {status === 'done' && (
            <div className="seg-preview">
              <img src={image} alt="切分结果" />
              {boxes.map((box, index) => (
                <button
                  key={`${index}-${Math.round(box.x)}-${Math.round(box.y)}`}
                  className={`seg-box${editing ? ' seg-box--editable' : ''}${
                    selectedIndex === index ? ' seg-box--selected' : ''
                  }`}
                  style={{
                    left: `${(box.x / imageSize.width) * 100}%`,
                    top: `${(box.y / imageSize.height) * 100}%`,
                    width: `${(box.width / imageSize.width) * 100}%`,
                    height: `${(box.height / imageSize.height) * 100}%`
                  }}
                  onClick={() => handleBoxClick(box, index)}
                  aria-label={`第 ${index + 1} 个字`}
                />
              ))}
            </div>
          )}
        </div>

        {status === 'done' && editing ? (
          <div className="sheet__footer seg-edit-bar">
            <button className="btn btn--ghost" onClick={handleDelete} disabled={selectedIndex === null}>
              <FaTrashAlt size={13} />
              删除
            </button>
            <button className="btn btn--ghost" onClick={handleMerge} disabled={selectedIndex === null}>
              <FaCompress size={13} />
              合并
            </button>
            <button className="btn btn--ghost" onClick={handleSplit} disabled={selectedIndex === null}>
              <FaCut size={13} />
              拆分
            </button>
            {editedBoxes && (
              <button className="btn btn--text" onClick={handleResetEdit}>
                还原
              </button>
            )}
          </div>
        ) : (
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
        )}
      </div>
    </>
  );
};

export default SegmentSheet;
