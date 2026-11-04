import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FaChevronLeft,
  FaChevronUp,
  FaChevronDown,
  FaChevronRight,
  FaSearchPlus,
  FaSearchMinus,
  FaTh,
  FaImages,
  FaArrowsAlt,
  FaRegHandPointer
} from 'react-icons/fa';
import {
  getCharacterNeighborhood,
  getNextCharacterPosition,
  getPreviousCharacterPosition,
  isHiddenPosition
} from '../utils/charNav';
import { readSegmentation, readSettings, writeSegmentation } from '../utils/segmentCache';
import {
  recordPractice,
  readPractice,
  readLastPracticed,
  PRACTICE_THRESHOLD_MS
} from '../utils/practiceStore';
import { hashImageData } from '../utils/imageHash';
import { makeThumbnail } from '../utils/thumbnail';
import { segmentCharacters } from '../utils/segment';

// 缩放因子
const ZOOM_FACTOR = 1.05;
// 微调步长（图片坐标系像素）
const ADJUST_STEP = 2;
// 单字框默认宽度占图片宽度的比例
const CHAR_WIDTH_RATIO = 0.25;
// 单字框最小高度比例
const MIN_CHAR_HEIGHT_RATIO = 0.1;
// 单字框最小缩放限制（占图片短边比例）
const MIN_ZOOM_RATIO = 0.02;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** 把 viewBox 限制在图片范围内，并限制缩放上下限 */
const fitViewBox = (viewBox, imageWidth, imageHeight) => {
  const minWidth = Math.max(1, imageWidth * MIN_ZOOM_RATIO);
  const minHeight = Math.max(1, imageHeight * MIN_ZOOM_RATIO);
  const width = clamp(viewBox.width, minWidth, imageWidth);
  const height = clamp(viewBox.height, minHeight, imageHeight);
  return {
    width,
    height,
    x: clamp(viewBox.x, 0, Math.max(0, imageWidth - width)),
    y: clamp(viewBox.y, 0, Math.max(0, imageHeight - height))
  };
};

const touchDistance = (touches) => {
  const [a, b] = touches;
  const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  return distance || 1;
};

/**
 * 临摹页：图片模式（点选单字）与单字模式（拖动 / 双指缩放 / 导航）
 */
const PracticeView = ({
  image,
  title,
  selectedCharacter,
  setSelectedCharacter,
  onBack,
  onOpenSegment,
  recentImages = [],
  onSwitchImage,
  db,
  gridVersion = 0,
  resumePractice = true
}) => {
  const frameRef = useRef(null);
  const canvasRef = useRef(null);
  const gestureRef = useRef({ mode: 'none', x: 0, y: 0 });
  const pinchRef = useRef(null);

  const [dragging, setDragging] = useState(false);
  const [showDpad, setShowDpad] = useState(false);
  // 已保存的切分网格（打开字帖即加载，直接叠在图上点选）
  const [savedBoxes, setSavedBoxes] = useState(null);
  const [savedLayout, setSavedLayout] = useState('vertical');
  // 图片原始尺寸（渲染网格用；不能依赖 ref，ref 在重新挂载时是 null）
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  // 当前字练过次数（用于顶栏展示）
  const [practiceCount, setPracticeCount] = useState(0);
  const practiceTimerRef = useRef(null);
  const resumeAppliedRef = useRef(false);
  // 续练自动进入的那一次不计入练习次数（用户并未真正练习）
  const skipNextCountRef = useRef(false);
  // 待续练的字索引（等框渲染好后跳转）
  const [pendingResumeIndex, setPendingResumeIndex] = useState(null);
  // 当前字帖的缓存键与已保存的单字取景调整
  const cacheKeyRef = useRef('');

  const saveTimerRef = useRef(null);

  const isCharMode = Boolean(selectedCharacter);

  const exitCharMode = useCallback(() => {
    setSelectedCharacter(null);
    setShowDpad(false);
  }, [setSelectedCharacter]);

  /* ---------------- 载入已保存的切分 ---------------- */

  useEffect(() => {
    if (!image || !db) return undefined;
    let cancelled = false;

    const load = async () => {
      const prefix = `${hashImageData(image)}:`;

      // 记录图片原始尺寸（供网格定位）
      try {
        const probe = new Image();
        probe.src = image;
        await new Promise((resolve, reject) => {
          probe.onload = resolve;
          probe.onerror = reject;
        });
        if (!cancelled) {
          setNaturalSize({
            width: probe.naturalWidth || probe.width,
            height: probe.naturalHeight || probe.height
          });
        }
        // 释放解码后的位图，避免与切分/放大镜的副本同时驻留内存
        probe.src = '';
      } catch (error) {
        /* 尺寸拿不到时网格不渲染，不影响其他功能 */
      }
      if (cancelled) return;

      // 先读这张字帖的设置：它决定了该用哪份缓存
      const settings = await readSettings(db, hashImageData(image));
      if (cancelled) return;
      // 字帖固定竖排，默认键与切分面板保持一致，避免同一张图存两份缓存
      const desiredLayout = settings && settings.layout ? settings.layout : 'vertical';
      const desiredGrid = Boolean(settings && settings.hasGrid);

      // 按「设置对应的键」优先查找：手动结果 > 自动结果
      const preferredKeys = [
        `${prefix}${desiredLayout}:${desiredGrid ? 'grid' : 'free'}`,
        // 兼容旧数据：同 layout 的另一变体
        `${prefix}${desiredLayout}:${desiredGrid ? 'free' : 'grid'}`
      ];

      let found = null;
      for (const key of preferredKeys) {
        const manual = await readSegmentation(db, `${key}:manual`);
        if (cancelled) return;
        if (manual && manual.boxes && manual.boxes.length > 0) {
          found = {
            boxes: manual.boxes,
            layout: manual.layout || 'vertical',
            cacheKey: `${key}:manual`,
            adjustments: manual.adjustments || {}
          };
          break;
        }
        const auto = await readSegmentation(db, key);
        if (cancelled) return;
        if (auto && auto.boxes && auto.boxes.length > 0) {
          found = {
            boxes: auto.boxes,
            layout: auto.layout || 'vertical',
            cacheKey: key,
            adjustments: auto.adjustments || {}
          };
          break;
        }
      }

      if (cancelled) return;

      // 仍然没有：按设置主动切分一次
      if (!found) {
        try {
          const segmentation = await segmentCharacters(image, {
            layout: desiredLayout,
            hasGrid: desiredGrid
          });
          if (cancelled) return;
          if (segmentation && !segmentation.failed && segmentation.boxes.length > 0) {
            const newKey = `${prefix}${desiredLayout}:${desiredGrid ? 'grid' : 'free'}`;
            found = {
              boxes: segmentation.boxes,
              layout: segmentation.layout || 'vertical',
              cacheKey: newKey,
              adjustments: {}
            };
            writeSegmentation(db, newKey, {
              boxes: segmentation.boxes,
              layout: segmentation.layout,
              strategy: segmentation.strategy,
              imageWidth: segmentation.imageWidth,
              imageHeight: segmentation.imageHeight
            });
          }
        } catch (error) {
          // 切分失败时退回手动点选
        }
      }

      if (!cancelled) {
        setSavedBoxes(found ? found.boxes : null);
        setSavedLayout(found && found.layout ? found.layout : 'vertical');
        cacheKeyRef.current =
          (found && found.cacheKey) || `${prefix}${desiredLayout}:${desiredGrid ? 'grid' : 'free'}`;
        // 旧数据迁移：历史版本把调整存在 adjustments 里，
        // 现在 boxes 是唯一数据源，进入时把旧调整合并进 boxes 并落盘
        if (found && found.adjustments && Object.keys(found.adjustments).length > 0) {
          const migrated = (found.boxes || []).map((box, i) => {
            const old = found.adjustments[i];
            if (!old) return box;
            return {
              ...box,
              x: Math.round(old.x),
              y: Math.round(old.y),
              width: Math.round(old.width),
              height: Math.round(old.height),
              adjusted: true
            };
          });
          setSavedBoxes(migrated);
          if (db && found.cacheKey) {
            writeSegmentation(db, found.cacheKey, {
              boxes: migrated,
              layout: found.layout,
              strategy: found.strategy || 'manual',
              imageWidth: found.boxes && found.boxes[0] ? found.imageWidth : undefined,
              imageHeight: found.imageHeight
            });
          }
        }

        // 续练：自动跳到上次练到的字（每次进入该字帖只做一次）
        if (resumePractice && found && found.boxes && found.boxes.length > 0 && !resumeAppliedRef.current) {
          resumeAppliedRef.current = true;
          const last = await readLastPracticed(db, hashImageData(image));
          if (!cancelled && last && last.index >= 0 && last.index < found.boxes.length) {
            setPendingResumeIndex(last.index);
          }
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [image, db, gridVersion]);

  // 续练：待跳转的索引就绪后，自动进入该字
  useEffect(() => {
    if (pendingResumeIndex === null || !savedBoxes || savedBoxes.length === 0) return;
    if (selectedCharacter) {
      setPendingResumeIndex(null);
      return;
    }
    const box = savedBoxes[pendingResumeIndex];
    if (!box) {
      setPendingResumeIndex(null);
      return;
    }
    skipNextCountRef.current = true;
    handleSavedBoxClick(box, pendingResumeIndex);
    setPendingResumeIndex(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingResumeIndex, savedBoxes]);

  /* ---------------- 练习记录 ---------------- */

  // 进入某个字：读已有次数 + 起计时器（停留 3 秒算练过一次）
  useEffect(() => {
    if (practiceTimerRef.current) {
      clearTimeout(practiceTimerRef.current);
      practiceTimerRef.current = null;
    }

    const character = selectedCharacter;
    if (!character || !db || !image) {
      setPracticeCount(0);
      return undefined;
    }
    const gridIndex = character.grid && typeof character.grid.index === 'number' ? character.grid.index : -1;
    if (gridIndex < 0) {
      setPracticeCount(0);
      return undefined;
    }

    const imageHash = hashImageData(image);
    let cancelled = false;

    readPractice(db, imageHash, gridIndex).then((record) => {
      if (!cancelled) setPracticeCount(record ? record.count || 0 : 0);
    });

    practiceTimerRef.current = setTimeout(async () => {
      if (cancelled) return;
      // 续练自动进入的那次直接跳过，避免「打开就 +1」
      if (skipNextCountRef.current) {
        skipNextCountRef.current = false;
        return;
      }
      const saved = await recordPractice(db, imageHash, gridIndex);
      if (!cancelled && saved) setPracticeCount(saved.count || 0);
    }, PRACTICE_THRESHOLD_MS);

    return () => {
      cancelled = true;
      if (practiceTimerRef.current) {
        clearTimeout(practiceTimerRef.current);
        practiceTimerRef.current = null;
      }
    };
  }, [selectedCharacter, db, image]);

  /* ---------------- 图片模式：点选单字 ---------------- */

  // 点击已切好的框直接进入临摹
  const handleSavedBoxClick = (box, index) => {
    const naturalWidth = naturalSize.width;
    const naturalHeight = naturalSize.height;
    if (!naturalWidth || !naturalHeight) return;

    // 未调整过的框：加 12% 留白，保证切分框与字形有偏差时四边仍完整显示。
    // 已调整过的框（box.adjusted）：直接用用户定好的取景，不再加 padding，
    // 否则每次进入都会外扩，越调越大。
    const viewBox = box.adjusted
      ? { x: box.x, y: box.y, width: box.width, height: box.height }
      : (() => {
          const padding = Math.max(3, Math.round(Math.min(box.width, box.height) * 0.12));
          const x = Math.max(0, box.x - padding);
          const y = Math.max(0, box.y - padding);
          return {
            x,
            y,
            width: Math.min(naturalWidth - x, box.width + padding * 2),
            height: Math.min(naturalHeight - y, box.height + padding * 2)
          };
        })();

    setSelectedCharacter({
      src: image,
      width: naturalWidth,
      height: naturalHeight,
      viewBox,
      grid: { boxes: savedBoxes, index }
    });
  };

  const handleStageClick = (event) => {
    const frame = frameRef.current;
    if (!frame) return;
    const img = frame.querySelector('img');
    if (!img) return;

    const rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const naturalWidth = img.naturalWidth || rect.width;
    const naturalHeight = img.naturalHeight || rect.height;
    const scaleX = naturalWidth / rect.width;
    const scaleY = naturalHeight / rect.height;

    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;

    // 先在屏幕像素下算一个近似正方形的框，再换算到图片坐标
    const cssWidth = rect.width * CHAR_WIDTH_RATIO;
    const cssHeight = Math.max(cssWidth, rect.height * MIN_CHAR_HEIGHT_RATIO);

    const viewBox = fitViewBox(
      {
        x: (clickX - cssWidth / 2) * scaleX,
        y: (clickY - cssHeight / 2) * scaleY,
        width: cssWidth * scaleX,
        height: cssHeight * scaleY
      },
      naturalWidth,
      naturalHeight
    );

    setSelectedCharacter({
      src: image,
      width: naturalWidth,
      height: naturalHeight,
      viewBox
    });
  };

  /* ---------------- 单字模式：视图变换 ---------------- */

  // 待写入的调整：{ index, viewBox }（防抖期间暂存）
  const pendingAdjustmentRef = useRef(null);

  /**
   * 把调整后的取景写回切分框
   *
   * 设计要点：
   * - boxes 是唯一数据源（不再单独维护 adjustments）
   * - 存入的是用户看到的精确取景（不含 padding）
   * - 给该框打 adjusted 标记，后续进入不再额外加 padding，避免反复外扩
   */
  const persistAdjustment = useCallback(
    async (index, viewBox) => {
      if (index === null || index < 0 || !db || !cacheKeyRef.current) return;
      const key = cacheKeyRef.current;
      const existing = await readSegmentation(db, key);
      if (!existing) return;

      const nextBoxes = (existing.boxes || []).map((box, i) =>
        i === index
          ? {
              ...box,
              x: Math.round(viewBox.x),
              y: Math.round(viewBox.y),
              width: Math.round(viewBox.width),
              height: Math.round(viewBox.height),
              adjusted: true
            }
          : box
      );

      // 先同步更新内存里的框：否则再次点击时仍用旧快照，
      // 会重新加 padding（表现为「越调越大」）。
      // 放在写库之前，避免组件卸载导致 setState 被丢弃。
      setSavedBoxes(nextBoxes);

      await writeSegmentation(db, key, {
        boxes: nextBoxes,
        layout: existing.layout,
        strategy: existing.strategy,
        imageWidth: existing.imageWidth,
        imageHeight: existing.imageHeight
      });
    },
    [db]
  );

  // 立即落盘（切字 / 退出前调用，避免防抖被取消而丢数据）
  const flushPendingAdjustment = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingAdjustmentRef.current;
    if (!pending) return;
    pendingAdjustmentRef.current = null;
    persistAdjustment(pending.index, pending.viewBox);
  }, [persistAdjustment]);

  // 把当前字的取景写入缓存（防抖 500ms）
  const scheduleSaveAdjustment = useCallback(
    (index, viewBox) => {
      if (index === null || index < 0 || !cacheKeyRef.current) return;
      pendingAdjustmentRef.current = { index, viewBox };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const pending = pendingAdjustmentRef.current;
        pendingAdjustmentRef.current = null;
        if (pending) persistAdjustment(pending.index, pending.viewBox);
      }, 500);
    },
    [persistAdjustment]
  );

  useEffect(
    () => () => {
      // 组件卸载时把待写入的调整落盘，避免丢失
      flushPendingAdjustment();
    },
    [flushPendingAdjustment]
  );

  const applyViewBox = useCallback(
    (updater) => {
      setSelectedCharacter((prev) => {
        if (!prev) return prev;
        const nextViewBox = fitViewBox(updater(prev.viewBox), prev.width, prev.height);
        if (prev.grid && typeof prev.grid.index === 'number') {
          scheduleSaveAdjustment(prev.grid.index, nextViewBox);
        }
        return { ...prev, viewBox: nextViewBox };
      });
    },
    [setSelectedCharacter, scheduleSaveAdjustment]
  );

  const adjust = useCallback(
    (dx, dy) => {
      applyViewBox((viewBox) => ({ ...viewBox, x: viewBox.x + dx, y: viewBox.y + dy }));
    },
    [applyViewBox]
  );

  const zoom = useCallback(
    (zoomIn) => {
      applyViewBox((viewBox) => {
        const factor = zoomIn ? 1 / ZOOM_FACTOR : ZOOM_FACTOR;
        const width = viewBox.width * factor;
        const height = viewBox.height * factor;
        const centerX = viewBox.x + viewBox.width / 2;
        const centerY = viewBox.y + viewBox.height / 2;
        return { x: centerX - width / 2, y: centerY - height / 2, width, height };
      });
    },
    [applyViewBox]
  );

  // 切分网格（从「自动切字」进入时带上）：导航按真实字框跳，避免等距推算的累积误差
  const grid = selectedCharacter && selectedCharacter.grid ? selectedCharacter.grid : null;

  const boxToViewBox = useCallback(
    (box) => {
      // 已调整过的框直接用存储值（不再加 padding，避免反复外扩）
      if (box.adjusted) {
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      }
      const padding = Math.max(2, Math.round(Math.min(box.width, box.height) * 0.06));
      const x = Math.max(0, box.x - padding);
      const y = Math.max(0, box.y - padding);
      return {
        x,
        y,
        width: Math.min(selectedCharacter.width - x, box.width + padding * 2),
        height: Math.min(selectedCharacter.height - y, box.height + padding * 2)
      };
    },
    [selectedCharacter]
  );

  const selectGridIndex = useCallback(
    (index) => {
      if (!grid || index < 0 || index >= grid.boxes.length) return false;
      // 用户主动切字 → 之后的停留都应正常计数
      skipNextCountRef.current = false;
      // 切字前把待保存的调整立刻写入，避免防抖被取消
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        flushPendingAdjustment();
      }
      const box = grid.boxes[index];
      setSelectedCharacter((prev) =>
        prev
          ? {
              ...prev,
              viewBox: boxToViewBox(box),
              grid: { boxes: grid.boxes, index }
            }
          : prev
      );
      return true;
    },
    [boxToViewBox, grid, setSelectedCharacter]
  );

  const goNext = useCallback(() => {
    if (!selectedCharacter) return;
    if (grid) {
      selectGridIndex(grid.index + 1);
      return;
    }
    const position = getNextCharacterPosition(
      selectedCharacter,
      selectedCharacter.viewBox.x,
      selectedCharacter.viewBox.y,
      1
    );
    if (isHiddenPosition(position)) return;
    applyViewBox((viewBox) => ({ ...viewBox, x: position.x, y: position.y }));
  }, [applyViewBox, grid, selectGridIndex, selectedCharacter]);

  const goPrev = useCallback(() => {
    if (!selectedCharacter) return;
    if (grid) {
      selectGridIndex(grid.index - 1);
      return;
    }
    const position = getPreviousCharacterPosition(
      selectedCharacter,
      selectedCharacter.viewBox.x,
      selectedCharacter.viewBox.y,
      1
    );
    if (isHiddenPosition(position)) return;
    applyViewBox((viewBox) => ({ ...viewBox, x: position.x, y: position.y }));
  }, [applyViewBox, grid, selectGridIndex, selectedCharacter]);

  /* ---------------- 鼠标 / 触摸手势 ---------------- */

  const dragBy = useCallback(
    (dxPx, dyPx) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      applyViewBox((viewBox) => ({
        ...viewBox,
        x: viewBox.x - (dxPx * viewBox.width) / rect.width,
        y: viewBox.y - (dyPx * viewBox.height) / rect.height
      }));
    },
    [applyViewBox]
  );

  const handleMouseDown = (event) => {
    gestureRef.current = { mode: 'drag', x: event.clientX, y: event.clientY };
    setDragging(true);
  };

  const handleMouseMove = (event) => {
    if (gestureRef.current.mode !== 'drag') return;
    dragBy(event.clientX - gestureRef.current.x, event.clientY - gestureRef.current.y);
    gestureRef.current.x = event.clientX;
    gestureRef.current.y = event.clientY;
  };

  const endGesture = useCallback(() => {
    gestureRef.current = { mode: 'none', x: 0, y: 0 };
    pinchRef.current = null;
    setDragging(false);
  }, []);

  const beginPinch = (touches) => {
    const viewBox = selectedCharacter.viewBox;
    pinchRef.current = {
      distance: touchDistance(touches),
      centerX: viewBox.x + viewBox.width / 2,
      centerY: viewBox.y + viewBox.height / 2,
      width: viewBox.width,
      height: viewBox.height
    };
  };

  const updatePinch = (touches) => {
    const pinch = pinchRef.current;
    if (!pinch) return;
    const ratio = touchDistance(touches) / pinch.distance;
    const width = pinch.width / ratio;
    const height = pinch.height / ratio;
    setSelectedCharacter((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        viewBox: fitViewBox(
          {
            x: pinch.centerX - width / 2,
            y: pinch.centerY - height / 2,
            width,
            height
          },
          prev.width,
          prev.height
        )
      };
    });
  };

  const handleTouchStart = (event) => {
    if (event.touches.length >= 2) {
      beginPinch(event.touches);
      gestureRef.current = { mode: 'pinch', x: 0, y: 0 };
      return;
    }
    const touch = event.touches[0];
    gestureRef.current = { mode: 'drag', x: touch.clientX, y: touch.clientY };
    setDragging(true);
  };

  const handleTouchMove = (event) => {
    if (event.touches.length >= 2) {
      if (gestureRef.current.mode !== 'pinch') beginPinch(event.touches);
      gestureRef.current = { mode: 'pinch', x: 0, y: 0 };
      updatePinch(event.touches);
      event.preventDefault();
      return;
    }

    if (gestureRef.current.mode === 'pinch') {
      // 双指抬起一指后，用剩余手指继续拖动
      pinchRef.current = null;
      const touch = event.touches[0];
      gestureRef.current = { mode: 'drag', x: touch.clientX, y: touch.clientY };
      return;
    }

    if (gestureRef.current.mode !== 'drag') return;
    const touch = event.touches[0];
    dragBy(touch.clientX - gestureRef.current.x, touch.clientY - gestureRef.current.y);
    gestureRef.current.x = touch.clientX;
    gestureRef.current.y = touch.clientY;
    event.preventDefault();
  };

  const handleTouchEnd = (event) => {
    if (event.touches.length === 0) {
      endGesture();
      return;
    }
    pinchRef.current = null;
    const touch = event.touches[0];
    gestureRef.current = { mode: 'drag', x: touch.clientX, y: touch.clientY };
  };

  const handleMinimapClick = (event) => {
    if (!selectedCharacter) return;
    const img = event.currentTarget.querySelector('img');
    if (!img) return;
    const imgRect = img.getBoundingClientRect();
    if (!imgRect.width || !imgRect.height) return;
    const scaleX = selectedCharacter.width / imgRect.width;
    const scaleY = selectedCharacter.height / imgRect.height;
    const centerX = (event.clientX - imgRect.left) * scaleX;
    const centerY = (event.clientY - imgRect.top) * scaleY;
    applyViewBox((viewBox) => ({
      ...viewBox,
      x: centerX - viewBox.width / 2,
      y: centerY - viewBox.height / 2
    }));
  };

  /* ---------------- 键盘快捷键（桌面端） ---------------- */

  useEffect(() => {
    if (!isCharMode) return undefined;

    const handlers = {
      ArrowUp: () => adjust(0, -ADJUST_STEP),
      ArrowDown: () => adjust(0, ADJUST_STEP),
      ArrowLeft: () => adjust(-ADJUST_STEP, 0),
      ArrowRight: () => adjust(ADJUST_STEP, 0),
      '+': () => zoom(true),
      '=': () => zoom(true),
      '-': () => zoom(false),
      PageDown: goNext,
      PageUp: goPrev,
      Escape: exitCharMode
    };

    const onKeyDown = (event) => {
      const handler = handlers[event.key];
      if (!handler) return;
      event.preventDefault();
      handler();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isCharMode, adjust, zoom, goNext, goPrev, exitCharMode]);

  /* ---------------- 渲染 ---------------- */

  const neighborhood = selectedCharacter
    ? grid
      ? [-2, -1, 0, 1, 2].map((offset) => {
          const targetIndex = grid.index + offset;
          const box = grid.boxes[targetIndex];
          return box
            ? { x: box.x, y: box.y, width: box.width, height: box.height, index: targetIndex }
            : { x: -1, y: -1, width: 0, height: 0, index: -1 };
        })
      : getCharacterNeighborhood(selectedCharacter).map((position) => ({
          ...position,
          width: selectedCharacter.viewBox.width,
          height: selectedCharacter.viewBox.height,
          index: -1
        }))
    : [];

  return (
    <div className="practice">
      <div className="practice__bar">
        <button
          className="icon-btn"
          onClick={isCharMode ? exitCharMode : onBack}
          aria-label={isCharMode ? '返回完整图片' : '返回字帖库'}
        >
          <FaChevronLeft size={17} />
        </button>
        <div className="practice__bar-title">
          {isCharMode
            ? `单字临摹${practiceCount > 0 ? ` · 练过 ${practiceCount} 次` : ''}`
            : title || '临摹'}
        </div>
        {isCharMode ? (
          <button className="icon-btn" onClick={onBack} aria-label="返回字帖库">
            <FaImages size={16} />
          </button>
        ) : (
          <span style={{ width: 44, height: 44 }} aria-hidden="true" />
        )}
      </div>

      {!isCharMode && (
        <div className="practice__body">
          <div className="stage-actions">
            <button className="btn btn--ghost btn--block" onClick={onOpenSegment}>
              <FaTh size={13} />
              自动切字，逐字临摹
            </button>
          </div>

          <div
            className="stage-frame"
            ref={frameRef}
            style={
              naturalSize.width > 0 && naturalSize.height > 0
                ? { aspectRatio: `${naturalSize.width} / ${naturalSize.height}` }
                : undefined
            }
          >
            {/* 用普通 img 而不是 Magnifier：
                Magnifier 会同时解码 imageSrc 和 largeImageSrc（同一张大图的
                两份副本），iOS 上 4000x4500 的图直接多占 74MB，
                是「App 被系统因内存不足杀掉」的主因之一。
                移动端本来就用双指缩放，悬停放大并无必要。 */}
            <img src={image} alt="字帖" className="stage-image" decoding="async" />
            {savedBoxes && savedBoxes.length > 0 ? (
              <div className="stage-grid">
                {naturalSize.width > 0 && savedBoxes.map((box, index) => {
                  const nw = naturalSize.width;
                  const nh = naturalSize.height;
                  return (
                    <button
                      key={`${index}-${Math.round(box.x)}-${Math.round(box.y)}`}
                      className="stage-grid__box"
                      style={{
                        left: `${(box.x / nw) * 100}%`,
                        top: `${(box.y / nh) * 100}%`,
                        width: `${(box.width / nw) * 100}%`,
                        height: `${(box.height / nh) * 100}%`
                      }}
                      onClick={() => handleSavedBoxClick(box, index)}
                      aria-label={`第 ${index + 1} 个字`}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="stage-hotspot" onClick={handleStageClick} role="button" tabIndex={0} aria-label="点选单字" />
            )}
            <div className="stage-hint">
              <FaRegHandPointer size={11} />
              {savedBoxes && savedBoxes.length > 0
                ? `点字直接临摹（已切 ${savedBoxes.length} 字）`
                : '轻触选择要临摹的字'}
            </div>
          </div>

          {recentImages.length > 1 && (
            <div className="recent-strip">
              {recentImages.map((item, index) => (
                <button
                  key={index}
                  className={`recent-strip__item${item.url === image ? ' recent-strip__item--active' : ''}`}
                  onClick={() => onSwitchImage && onSwitchImage(item.url)}
                  aria-label={`切换到第 ${index + 1} 张字帖`}
                >
                  <img src={item.url} alt="" />
                </button>
              ))}
            </div>
          )}

        </div>
      )}

      {isCharMode && (
        <div className="char-view">
          <div className="char-body">
            <div
              className="char-canvas"
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={endGesture}
              onMouseLeave={endGesture}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
            >
              <svg
                viewBox={`${selectedCharacter.viewBox.x} ${selectedCharacter.viewBox.y} ${selectedCharacter.viewBox.width} ${selectedCharacter.viewBox.height}`}
                preserveAspectRatio="xMidYMid meet"
              >
                <image
                  href={selectedCharacter.src}
                  width={selectedCharacter.width}
                  height={selectedCharacter.height}
                />
              </svg>
              <div className="char-canvas__grid" aria-hidden="true" />
            </div>

            <div className="char-minimap">
              <button className="char-minimap__canvas" onClick={handleMinimapClick} aria-label="全景导航">
                <img src={selectedCharacter.src} alt="" />
                <span
                  className="char-minimap__box"
                  style={{
                    left: `${(selectedCharacter.viewBox.x / selectedCharacter.width) * 100}%`,
                    top: `${(selectedCharacter.viewBox.y / selectedCharacter.height) * 100}%`,
                    width: `${(selectedCharacter.viewBox.width / selectedCharacter.width) * 100}%`,
                    height: `${(selectedCharacter.viewBox.height / selectedCharacter.height) * 100}%`
                  }}
                />
              </button>
            </div>

            <div className="char-strip">
              {neighborhood.map((position, index) => {
                const hidden = position.x === -1 && position.y === -1;
                const active = grid
                  ? position.index === grid.index
                  : position.x === selectedCharacter.viewBox.x &&
                    position.y === selectedCharacter.viewBox.y;
                return (
                  <button
                    key={index}
                    className={`char-thumb${active ? ' char-thumb--active' : ''}${
                      hidden ? ' char-thumb--empty' : ''
                    }`}
                    onClick={() => {
                      if (hidden) return;
                      if (grid && position.index >= 0) {
                        selectGridIndex(position.index);
                        return;
                      }
                      applyViewBox((viewBox) => ({ ...viewBox, x: position.x, y: position.y }));
                    }}
                    disabled={hidden}
                    aria-label={active ? '当前字' : '跳转到相邻字'}
                  >
                    <svg
                      viewBox={
                        // 当前字：跟随主视图的 viewBox，保证缩略图与上方完全一致
                        // （用户放大/缩小/移动时，缩略图同步变化）
                        active && selectedCharacter
                          ? `${selectedCharacter.viewBox.x} ${selectedCharacter.viewBox.y} ${selectedCharacter.viewBox.width} ${selectedCharacter.viewBox.height}`
                          : `${position.x} ${position.y} ${position.width} ${position.height}`
                      }
                      preserveAspectRatio="xMidYMid meet"
                    >
                      <image
                        href={selectedCharacter.src}
                        width={selectedCharacter.width}
                        height={selectedCharacter.height}
                      />
                    </svg>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="dock">
            {showDpad && (
              <div className="dpad">
                <div />
                <button className="dpad__btn" onClick={() => adjust(0, -ADJUST_STEP)} aria-label="上移">
                  <FaChevronUp size={15} />
                </button>
                <div />
                <button className="dpad__btn" onClick={() => adjust(-ADJUST_STEP, 0)} aria-label="左移">
                  <FaChevronLeft size={15} />
                </button>
                <div className="dpad__center">微调</div>
                <button className="dpad__btn" onClick={() => adjust(ADJUST_STEP, 0)} aria-label="右移">
                  <FaChevronRight size={15} />
                </button>
                <div />
                <button className="dpad__btn" onClick={() => adjust(0, ADJUST_STEP)} aria-label="下移">
                  <FaChevronDown size={15} />
                </button>
                <div />
              </div>
            )}

            <div className="dock__row">
              <button className="dock-btn" onClick={goPrev}>
                <FaChevronUp />
                <span>上一字</span>
              </button>
              <button className="dock-btn" onClick={() => zoom(false)}>
                <FaSearchMinus />
                <span>缩小</span>
              </button>
              <button
                className={`dock-btn${showDpad ? ' dock-btn--active' : ''}`}
                onClick={() => setShowDpad((visible) => !visible)}
              >
                <FaArrowsAlt />
                <span>微调</span>
              </button>
              <button className="dock-btn" onClick={() => zoom(true)}>
                <FaSearchPlus />
                <span>放大</span>
              </button>
              <button className="dock-btn" onClick={goNext}>
                <FaChevronDown />
                <span>下一字</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PracticeView;
