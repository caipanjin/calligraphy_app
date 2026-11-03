import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FaTimes,
  FaRedo,
  FaExclamationTriangle,
  FaHandPointer,
  FaTrashAlt,
  FaCompress,
  FaCut,
  FaPen,
  FaCheck,
  FaPlus
} from 'react-icons/fa';
import { segmentCharacters } from '../utils/segment';
import { hashImageData } from '../utils/imageHash';
import {
  readSegmentation,
  writeSegmentation,
  deleteSegmentation,
  readSettings,
  writeSettings
} from '../utils/segmentCache';
import { removeBox, mergeBoxes, splitBox, findNearestBoxIndex, addBox } from '../utils/boxEdit';
import { deleteImagePractice, readImagePractice } from '../utils/practiceStore';

// 字帖一律竖排，不再提供版面切换
const LAYOUT_OPTIONS = [{ value: 'vertical', label: '竖排' }];

/**
 * 自动切字抽屉：把整幅字帖按投影切成单字，点任意框直接进入单字临摹
 */
const SegmentSheet = ({ image, db, onSelectCharacter, onClose }) => {
  const [status, setStatus] = useState('loading');
  // 重新切分反馈：进行中（一直显示）与已完成（4 秒后消失）
  const [retryPending, setRetryPending] = useState(false);
  const [retryNotice, setRetryNotice] = useState('');
  const [result, setResult] = useState(null);
  const [layout, setLayout] = useState('vertical');
  const [hasGrid, setHasGrid] = useState(false);
  // 设置是否已从存储恢复（未恢复前不触发切分）
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [attempt, setAttempt] = useState(0);
  // 编辑模式：选中的框索引（null 表示未选中）
  const [editing, setEditing] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(null);
  // 用户手动修改过的框（非 null 时优先于自动结果，且不写回缓存）
  const [editedBoxes, setEditedBoxes] = useState(null);
  // 破坏性操作前的确认（会重置练习记录）
  const [pendingAction, setPendingAction] = useState(null);
  // 画框模式：用户在图上拖拽出一个新框（补切分漏掉的字）
  const [drawing, setDrawing] = useState(false);
  const [draftRect, setDraftRect] = useState(null); // 百分比坐标 {left, top, width, height}
  const draftStartRef = useRef(null);
  const previewRef = useRef(null);
  const [practicedCount, setPracticedCount] = useState(0);

  // 先恢复这张字帖上次的版面设置与「是否带格子线」
  useEffect(() => {
    if (!image || !db) {
      setSettingsLoaded(true);
      return undefined;
    }
    let cancelled = false;
    const load = async () => {
      const settings = await readSettings(db, hashImageData(image));
      if (cancelled) return;
      if (settings) {
        if (settings.layout) setLayout(settings.layout);
        if (typeof settings.hasGrid === 'boolean') setHasGrid(settings.hasGrid);
      }
      setSettingsLoaded(true);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [image, db]);

  // 记住用户的选择（换图 / 切换时生效，随切分一起持久化）
  useEffect(() => {
    if (!image || !db || !settingsLoaded) return;
    writeSettings(db, hashImageData(image), { layout, hasGrid });
  }, [image, db, layout, hasGrid, settingsLoaded]);

  useEffect(() => {
    if (!image || !settingsLoaded) return undefined;

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
          // 优先用户的手动结果
          const manual = await readSegmentation(db, `${cacheKey}:manual`);
          if (cancelled) return;
          if (manual && manual.boxes && manual.boxes.length > 0 && manual.imageWidth === naturalWidth) {
            const autoCached = await readSegmentation(db, cacheKey);
            setResult({
              boxes: autoCached && autoCached.boxes ? autoCached.boxes : manual.boxes,
              layout: manual.layout || 'vertical',
              strategy: (autoCached && autoCached.strategy) || 'manual'
            });
            setEditedBoxes(manual.boxes);
            setSelectedIndex(null);
            setStatus('done');
            return;
          }

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
          // 重新切分完成：给出明确反馈（结果可能与上次相同，用户需要知道确实执行了）
          if (attempt > 0) {
            const previousCount = result && result.boxes ? result.boxes.length : 0;
            const nextCount = segmentation.boxes.length;
            setRetryPending(false);
            setRetryNotice(
              previousCount > 0 && previousCount === nextCount
                ? `已重新切分，共 ${nextCount} 字（与上次结果相同）`
                : `已重新切分，共 ${nextCount} 字`
            );
          }
          // 点「重新切分」时清掉之前的手动调整，否则重开时手动记录会盖掉新结果
          if (attempt > 0) {
            deleteSegmentation(db, `${cacheKey}:manual`);
          }
          writeSegmentation(db, cacheKey, {
            boxes: segmentation.boxes,
            layout: segmentation.layout,
            strategy: segmentation.strategy,
            imageWidth: naturalWidth,
            imageHeight: naturalHeight
          });
        }
      } catch (error) {
        if (!cancelled) {
          setStatus('error');
          setRetryPending(false);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [image, layout, hasGrid, attempt, db, settingsLoaded]);

  // 仅「已完成」提示在 4 秒后自动消失（进行中提示要一直显示到计算完成）
  useEffect(() => {
    if (!retryNotice) return undefined;
    const timer = setTimeout(() => setRetryNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [retryNotice]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleRetry = useCallback(() => {
    setRetryPending(true);
    setRetryNotice('');
    setAttempt((value) => value + 1);
  }, []);

  /** 若该字帖已有练习记录，先确认（会重置记录） */
  const confirmIfPracticed = useCallback(
    async (action) => {
      if (!db || !image) {
        action();
        return;
      }
      const records = await readImagePractice(db, hashImageData(image));
      let practiced = 0;
      records.forEach((record) => {
        if (record && record.count > 0) practiced += 1;
      });
      if (practiced > 0) {
        setPracticedCount(practiced);
        setPendingAction(() => action);
        return;
      }
      action();
    },
    [db, image]
  );

  // 编辑框后清掉该字帖的练习记录（索引已错位）
  const clearPracticeForImage = useCallback(() => {
    if (db && image) deleteImagePractice(db, hashImageData(image));
  }, [db, image]);

  const runPendingAction = useCallback(async () => {
    const action = pendingAction;
    setPendingAction(null);
    if (db && image) {
      await deleteImagePractice(db, hashImageData(image));
    }
    if (action) action();
  }, [pendingAction, db, image]);

  const handleBoxClick = (box, index) => {
    if (editing) {
      setSelectedIndex((current) => (current === index ? null : index));
      return;
    }
    handlePick(box, index);
  };

  const handlePick = (box, index) => {
    // 单字视图留白 12%：切分框可能与字形有轻微偏差，多留一点保证四边完整显示
    const padding = Math.max(3, Math.round(Math.min(box.width, box.height) * 0.12));
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
  // 两个键：自动结果与用户结果分开存，互不覆盖
  const baseKey = image
    ? `${hashImageData(image)}:${layout}:${hasGrid ? 'grid' : 'free'}`
    : '';
  const manualKey = baseKey ? `${baseKey}:manual` : '';

  // 编辑结果立即持久化：下次打开直接复用
  /* ---------------- 画框（补漏切的字） ---------------- */

  const startDraw = () => {
    setDrawing(true);
    setSelectedIndex(null);
    setDraftRect(null);
    draftStartRef.current = null;
  };

  const cancelDraw = () => {
    setDrawing(false);
    setDraftRect(null);
    draftStartRef.current = null;
  };

  // 把鼠标/触摸位置换算成图片百分比坐标
  const pointToPercent = (event) => {
    const node = previewRef.current;
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    // 触屏事件：touchend 的 touches 是空数组，要用 changedTouches。
    // 直接读 touches[0] 会抛 TypeError（实测踩到过）。
    const touch =
      (event.touches && event.touches[0]) ||
      (event.changedTouches && event.changedTouches[0]) ||
      null;
    const clientX = touch ? touch.clientX : event.clientX;
    const clientY = touch ? touch.clientY : event.clientY;
    if (typeof clientX !== 'number' || typeof clientY !== 'number') return null;

    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
    };
  };

  const handleDrawStart = (event) => {
    if (!drawing) return;
    event.preventDefault();
    const point = pointToPercent(event);
    if (!point) return;
    draftStartRef.current = point;
    setDraftRect({ left: point.x, top: point.y, width: 0, height: 0 });
  };

  const handleDrawMove = (event) => {
    if (!drawing || !draftStartRef.current) return;
    event.preventDefault();
    const point = pointToPercent(event);
    if (!point) return;
    const start = draftStartRef.current;
    setDraftRect({
      left: Math.min(start.x, point.x),
      top: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y)
    });
  };

  const handleDrawEnd = (event) => {
    if (!drawing || !draftStartRef.current) return;
    event.preventDefault();
    const point = pointToPercent(event);
    const start = draftStartRef.current;
    draftStartRef.current = null;

    if (!point) {
      setDraftRect(null);
      return;
    }

    const left = Math.min(start.x, point.x);
    const top = Math.min(start.y, point.y);
    const width = Math.abs(point.x - start.x);
    const height = Math.abs(point.y - start.y);

    // 拖动距离过小 → 视为「单击」，直接生成默认大小的框。
    // 不能依赖 click 事件：handleDrawStart 里调用了 preventDefault()，
    // 浏览器不会再合成 click（实测导致单击永远不生效）。
    if (width < 0.02 || height < 0.02) {
      setDraftRect(null);
      const defaultBox = inferDefaultBox(point);
      if (defaultBox) {
        setDrawing(false);
        clearPracticeForImage();
        applyBoxes(addBox(boxes, defaultBox, true));
      }
      return;
    }

    const box = {
      x: Math.round(left * imageSize.width),
      y: Math.round(top * imageSize.height),
      width: Math.round(width * imageSize.width),
      height: Math.round(height * imageSize.height)
    };

    setDraftRect(null);
    setDrawing(false);
    clearPracticeForImage();
    applyBoxes(addBox(boxes, box, true));
  };

  /**
   * 根据点击位置推断一个「默认大小」的框
   *
   * 优先参考**同列最近的字**的宽高（竖排字帖里同列字大小最接近）；
   * 没有同列邻居时退回到全部框的中位数。
   */
  const inferDefaultBox = (percentPoint) => {
    if (!boxes || boxes.length === 0 || !imageSize.width) return null;

    const clickX = percentPoint.x * imageSize.width;
    const clickY = percentPoint.y * imageSize.height;

    // 找同列（中心 x 距离在一列宽内）且 y 最近的框
    let nearest = null;
    let nearestDist = Infinity;
    for (const box of boxes) {
      const centerX = box.x + box.width / 2;
      const sameColumn = Math.abs(centerX - clickX) <= Math.max(box.width * 0.6, 20);
      if (!sameColumn) continue;
      const centerY = box.y + box.height / 2;
      const dist = Math.abs(centerY - clickY);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = box;
      }
    }

    // 没有同列邻居：用所有框的中位数尺寸
    let width;
    let height;
    if (nearest) {
      width = nearest.width;
      height = nearest.height;
    } else {
      const widths = boxes.map((b) => b.width).sort((a, b) => a - b);
      const heights = boxes.map((b) => b.height).sort((a, b) => a - b);
      width = widths[Math.floor(widths.length / 2)];
      height = heights[Math.floor(heights.length / 2)];
    }

    // 以点击点为中心放置，并限制在图片范围内
    const x = Math.min(Math.max(0, clickX - width / 2), imageSize.width - width);
    const y = Math.min(Math.max(0, clickY - height / 2), imageSize.height - height);

    return {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height)
    };
  };


  // 记录最后一次写入的 Promise，关闭前等待它完成，
  // 避免「刚加完框就关闭」时重新加载读到旧数据
  const saveChainRef = useRef(Promise.resolve());

  const handleClose = useCallback(() => {
    // 等最后一次写入完成再关闭，保证临摹页重新加载时能读到最新结果
    saveChainRef.current.then(() => onClose()).catch(() => onClose());
  }, [onClose]);

  const queueSave = (promise) => {
    saveChainRef.current = promise || Promise.resolve();
    return saveChainRef.current;
  };

  const applyBoxes = (next) => {
    setEditedBoxes(next);
    setSelectedIndex(null);
    if (!db || !manualKey) return Promise.resolve(false);
    const promise = writeSegmentation(db, manualKey, {
      boxes: next,
      layout: result && result.layout ? result.layout : 'vertical',
      strategy: 'manual',
      edited: true,
      imageWidth: imageSize.width,
      imageHeight: imageSize.height,
      // 框的数量/顺序变了，之前按索引存的单字取景会错位，直接清空
      adjustments: {}
    });
    return queueSave(promise);
  };

  const handleDelete = () => {
    if (selectedIndex === null) return;
    const index = selectedIndex;
    confirmIfPracticed(() => {
      // 框结构变了，之前按索引存的练习记录会错位 → 一并清空
      clearPracticeForImage();
      applyBoxes(removeBox(boxes, index));
    });
  };

  const handleMerge = () => {
    if (selectedIndex === null) return;
    const neighbor = findNearestBoxIndex(boxes, selectedIndex);
    if (neighbor < 0) return;
    const index = selectedIndex;
    confirmIfPracticed(() => {
      clearPracticeForImage();
      applyBoxes(mergeBoxes(boxes, index, neighbor));
    });
  };

  const handleSplit = () => {
    if (selectedIndex === null) return;
    const index = selectedIndex;
    const vertical = result && result.layout === 'vertical';
    confirmIfPracticed(() => {
      clearPracticeForImage();
      applyBoxes(splitBox(boxes, index, vertical));
    });
  };

  const handleResetEdit = () => {
    setEditedBoxes(null);
    setSelectedIndex(null);
    if (!db || !manualKey) return;
    // 删掉手动结果，自动结果原样保留
    deleteSegmentation(db, manualKey);
  };

  return (
    <>
      <div className="sheet-backdrop" onClick={handleClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="自动切字">
        <div className="sheet__handle" />
        <div className="sheet__header">
          <h3 className="sheet__title">
            自动切字
            {status === 'done' && (
              <span className="section-head__hint" style={{ marginLeft: 8 }}>
                {editedBoxes
                  ? '已手动调整'
                  : result.strategy === 'grid-lines'
                  ? '按格线'
                  : result.layout === 'vertical'
                  ? '竖排'
                  : '横排'}{' '}
                · {boxes.length} 字
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
          <button className="icon-btn" onClick={handleClose} aria-label="关闭">
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

          {(retryPending || retryNotice) && (
            <div className={`seg-retry-notice${retryPending ? ' seg-retry-notice--pending' : ''}`}>
              {retryPending ? <FaRedo size={12} /> : <FaCheck size={12} />}
              {retryPending ? '正在重新切分…' : retryNotice}
            </div>
          )}

          {status === 'done' && editing && (
            <div className="seg-edit-hint">
              {drawing
                ? '在图片上单击生成一个默认大小的框，或拖拽画出指定大小'
                : selectedIndex === null
                  ? '点击任意框选中，再选择下方操作'
                  : `已选中第 ${selectedIndex + 1} 个框`}
            </div>
          )}

          {status === 'done' && (
            <div
              className={`seg-preview${drawing ? ' seg-preview--drawing' : ''}`}
              ref={previewRef}
              onMouseDown={handleDrawStart}
              onMouseMove={handleDrawMove}
              onMouseUp={handleDrawEnd}
              onMouseLeave={handleDrawEnd}
              onTouchStart={handleDrawStart}
              onTouchMove={handleDrawMove}
              onTouchEnd={handleDrawEnd}
            >
              <img src={image} alt="切分结果" draggable={false} />
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
              {draftRect && (
                <span
                  className="seg-draft"
                  style={{
                    left: `${draftRect.left * 100}%`,
                    top: `${draftRect.top * 100}%`,
                    width: `${draftRect.width * 100}%`,
                    height: `${draftRect.height * 100}%`
                  }}
                />
              )}
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
            {drawing ? (
              <button className="btn btn--text" onClick={cancelDraw}>
                取消加框
              </button>
            ) : (
              <button className="btn btn--ghost" onClick={startDraw}>
                <FaPlus size={13} />
                加框
              </button>
            )}
            {editedBoxes && (
              <button className="btn btn--text" onClick={handleResetEdit}>
                还原
              </button>
            )}
          </div>
        ) : (
          <div className="sheet__footer">
            {status !== 'loading' && (
              <button className="btn btn--ghost" onClick={() => confirmIfPracticed(handleRetry)}>
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

      {pendingAction && (
        <div className="modal-backdrop" onClick={() => setPendingAction(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3 className="modal__title">会重置练习记录</h3>
            <p className="modal__desc">
              这张字帖已练过 {practicedCount} 个字。重新切分或调整框的位置，
              之前的练习记录会因为字的位置变化而错位，将被清除。
            </p>
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => setPendingAction(null)}>
                取消
              </button>
              <button className="btn btn--danger" onClick={runPendingAction}>
                继续并清除
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SegmentSheet;
