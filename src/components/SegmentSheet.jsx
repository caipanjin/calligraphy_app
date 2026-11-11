import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FaChevronLeft,
  FaUndo,
  FaRedo,
  FaEllipsisH,
  FaExclamationTriangle,
  FaCheck,
  FaPen,
  FaPlus,
  FaTrashAlt,
  FaCompress,
  FaCut,
  FaArrowsAlt,
  FaCropAlt,
  FaGripLines
} from 'react-icons/fa';
import { segmentCharacters, releaseImageElement } from '../utils/segment';
import { hashImageData } from '../utils/imageHash';
import {
  readSegmentation,
  writeSegmentation,
  deleteSegmentation,
  readSettings,
  writeSettings,
  canReuseSegmentation
} from '../utils/segmentCache';
import {
  removeBox, mergeBoxes, splitBox, findNearestBoxIndex, addBox,
  groupBoxesByColumn, columnBoundaries, setColumnBoundary,
  resegmentColumnRange, moveBox, resizeBox, snapValue, pickRegionCuts
} from '../utils/boxEdit';
import { getCandidateBoundaries } from '../utils/inkProfile';
import { deleteImagePractice, readImagePractice } from '../utils/practiceStore';

// 字帖一律竖排：layout 仍是切分缓存的键的一部分，但不给用户切换入口

/**
 * 四个工具是「你要做什么」的一级分组，每个工具同时只有一种手势生效。
 * 具体某个框的删除 / 合并 / 拆分不算工具——它们只在选中框后出现。
 */
const TOOLS = [
  { value: 'adjust', label: '调整', icon: FaArrowsAlt },
  { value: 'add', label: '加框', icon: FaPlus },
  { value: 'region', label: '区域', icon: FaCropAlt },
  { value: 'boundary', label: '分界', icon: FaGripLines }
];

// 选中框上的 8 个拖拽手柄（四角 + 四边），每条边都能单独调整
const HANDLES = [
  { edge: 'nw', className: 'seg-handle--nw' },
  { edge: 'n', className: 'seg-handle--n' },
  { edge: 'ne', className: 'seg-handle--ne' },
  { edge: 'e', className: 'seg-handle--e' },
  { edge: 'se', className: 'seg-handle--se' },
  { edge: 's', className: 'seg-handle--s' },
  { edge: 'sw', className: 'seg-handle--sw' },
  { edge: 'w', className: 'seg-handle--w' }
];

/**
 * 字框编辑页（全屏）：把整幅字帖按投影切成单字，修正字框后点任意框进入单字临摹
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
  // 选中的框索引（null 表示未选中）
  const [selectedIndex, setSelectedIndex] = useState(null);
  // 用户手动修改过的框（非 null 时优先于自动结果，且不写回缓存）
  const [editedBoxes, setEditedBoxes] = useState(null);
  // 破坏性操作前的确认（会重置练习记录）
  const [pendingAction, setPendingAction] = useState(null);
  // 「⋯」菜单：带格子线、重新切分、还原为自动切分
  const [menuOpen, setMenuOpen] = useState(false);
  // 画框模式：用户在图上拖拽出一个新框（补切分漏掉的字）
  const [drawing, setDrawing] = useState(false);
  const [draftRect, setDraftRect] = useState(null); // 百分比坐标 {left, top, width, height}
  const draftStartRef = useRef(null);
  const previewRef = useRef(null);
  // 区域切分模式：拖出一个矩形而非单个字框，松手后按该区域的行投影找字间切线。
  // 只作用于手动结果（:manual），不改自动切分、不触发算法版本升级。
  const [regionMode, setRegionMode] = useState(false);
  const [regionCut, setRegionCut] = useState(null); // { box, lines }
  const [practicedCount, setPracticedCount] = useState(0);
  // 本列切线：只作用于选中框所在的列，绝不做跨列对齐或等距推断
  const [cutMode, setCutMode] = useState(false);
  const [candidateLines, setCandidateLines] = useState([]); // 原图坐标 y
  const [selectedLines, setSelectedLines] = useState([]);
  const [profilePending, setProfilePending] = useState(false);
  const [historyDepth, setHistoryDepth] = useState(0);
  const historyRef = useRef([]);
  const maskRef = useRef(null); // 缓存 buildInkMask 结果，避免每次找候选线都重新二值化
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);

  // 换一张字帖时清掉上一张的编辑中间状态
  useEffect(() => {
    setCutMode(false);
    setCandidateLines([]);
    setSelectedLines([]);
    setRegionMode(false);
    setRegionCut(null);
    setMenuOpen(false);
    setHistoryDepth(0);
    historyRef.current = [];
    maskRef.current = null;
    return () => {
      // 组件卸载（关闭编辑页）时也要放开掩码：1600px 级 ink 缓冲约 2~3MB
      maskRef.current = null;
    };
  }, [image]);

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
        let naturalWidth;
        let naturalHeight;
        try {
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error('图片加载失败'));
          });
          naturalWidth = img.naturalWidth || img.width;
          naturalHeight = img.naturalHeight || img.height;
        } finally {
          // 这份位图只为取尺寸，读完就释放，别和预览/切分的副本一起驻留
          releaseImageElement(img);
        }
        if (cancelled) return;
        setImageSize({ width: naturalWidth, height: naturalHeight });

        const cacheKey = `${hashImageData(image)}:${layout}:${hasGrid ? 'grid' : 'free'}`;
        const manualKey = `${cacheKey}:manual`;

        // 命中缓存直接复用（点「重新切分」时强制重算）
        if (attempt === 0) {
          // 优先用户的手动结果：用户亲手确认过的框不因算法升级而丢失
          const manual = await readSegmentation(db, manualKey);
          if (cancelled) return;
          if (canReuseSegmentation(manual, manualKey) && manual.imageWidth === naturalWidth) {
            // 自动结果只用来显示切分策略；旧算法的自动结果不能混进手动结果
            const autoCached = await readSegmentation(db, cacheKey);
            const currentAuto = canReuseSegmentation(autoCached, cacheKey) ? autoCached : null;
            setResult({
              boxes: currentAuto ? currentAuto.boxes : manual.boxes,
              layout: manual.layout || 'vertical',
              strategy: (currentAuto && currentAuto.strategy) || 'manual'
            });
            setEditedBoxes(manual.boxes);
            setSelectedIndex(null);
            setStatus('done');
            return;
          }

          const cached = await readSegmentation(db, cacheKey);
          if (cancelled) return;
          if (canReuseSegmentation(cached, cacheKey) && cached.imageWidth === naturalWidth) {
            setResult({ boxes: cached.boxes, layout: cached.layout, strategy: cached.strategy });
            setEditedBoxes(null);
            setSelectedIndex(null);
            setStatus('done');
            return;
          }
        }

        const segmentation = await segmentCharacters(image, {
          layout,
          hasGrid,
          // 复用切分算出的墨迹掩码：点「找候选线」时不再二次解码整张原图
          onMask: (mask) => {
            if (cancelled) return;
            maskRef.current = mask;
          }
        });
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

  const handleClose = useCallback(() => {
    // 等最后一次写入完成再关闭，保证临摹页重新加载时能读到最新结果
    saveChainRef.current.then(() => onClose()).catch(() => onClose());
  }, [onClose]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (menuOpen) {
        setMenuOpen(false);
        return;
      }
      handleClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleClose, menuOpen]);

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

  const selectBox = (box, index) => {
    setSelectedIndex((current) => (current === index ? null : index));
  };

  const handleBoxClick = (box, index) => {
    // 刚拖完框 / 切线时浏览器还可能合成一次 click，吞掉它，避免误改选中态
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    selectBox(box, index);
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

  // 选中框所在列（从右到左聚类、列内从上到下）。切线只覆盖这一列，
  // 其它列完全不参与——无格字帖各列字数、字高、字位都可能不同。
  const activeColumn = selectedIndex === null
    ? null
    : groupBoxesByColumn(boxes).find((column) => column.indices.includes(selectedIndex)) || null;
  const columnCuts = activeColumn ? columnBoundaries(boxes, activeColumn.indices) : [];
  const columnRange = activeColumn
    ? {
        x0: Math.min(...activeColumn.indices.map((i) => boxes[i].x)),
        x1: Math.max(...activeColumn.indices.map((i) => boxes[i].x + boxes[i].width)),
        y0: Math.min(...activeColumn.indices.map((i) => boxes[i].y)),
        y1: Math.max(...activeColumn.indices.map((i) => boxes[i].y + boxes[i].height))
      }
    : null;
  // 候选线面板在两种模式下共用：普通切线用本列候选，区域切分用区域候选
  const barLines = regionCut ? regionCut.lines : candidateLines;

  // 任意编辑后切到「用户结果」，后续操作都基于它
  // 两个键：自动结果与用户结果分开存，互不覆盖
  const baseKey = image
    ? `${hashImageData(image)}:${layout}:${hasGrid ? 'grid' : 'free'}`
    : '';
  const manualKey = baseKey ? `${baseKey}:manual` : '';

  /* ---------------- 画框（补漏切的字） ---------------- */

  const startDraw = () => {
    setRegionMode(false);
    setRegionCut(null);
    setDrawing(true);
    setSelectedIndex(null);
    setDraftRect(null);
    draftStartRef.current = null;
  };

  /** 区域切分：与「加框」共用拖拽手势，但松手后是分析区域而不是新增一个框 */
  const startRegionDraw = () => {
    setRegionMode(true);
    setRegionCut(null);
    setCutMode(false);
    setCandidateLines([]);
    setSelectedLines([]);
    setDrawing(true);
    setSelectedIndex(null);
    setDraftRect(null);
    draftStartRef.current = null;
  };

  const cancelDraw = () => {
    setDrawing(false);
    setRegionMode(false);
    setDraftRect(null);
    draftStartRef.current = null;
  };

  /**
   * 分析手绘区域：复用自动切分那份墨迹掩码，只在该矩形的 x 范围内做行投影，
   * 得到「可能的字间空白」。默认勾选经过 pickRegionCuts 护栏的线，用户可增减。
   */
  const analyzeRegion = async (box) => {
    setProfilePending(true);
    try {
      const { boundaries, mask } = await getCandidateBoundaries(image, {
        x0: box.x,
        x1: box.x + box.width,
        y0: box.y,
        y1: box.y + box.height,
        mask: maskRef.current,
        maxCount: 16
      });
      maskRef.current = mask;
      setRegionCut({ box, lines: boundaries });
      setSelectedLines(pickRegionCuts(boundaries, box));
    } catch (error) {
      setRegionCut(null);
      setSelectedLines([]);
    } finally {
      setProfilePending(false);
    }
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
      if (regionMode) {
        // 区域模式下单击没有语义：取消本次拖拽，不要误加一个默认字框
        setDrawing(false);
        setRegionMode(false);
        return;
      }
      const defaultBox = inferDefaultBox(point);
      if (defaultBox) {
        // 加框工具保持激活：可以连续补几个字，点「调整」或再点一次「加框」退出
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
    if (regionMode) {
      setDrawing(false);
      setRegionMode(false);
      analyzeRegion(box);
      return;
    }
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

  const queueSave = (promise) => {
    saveChainRef.current = promise || Promise.resolve();
    return saveChainRef.current;
  };

  /**
   * 提交一次编辑。拖动类操作在 pointerup 时才调用（拖动中只改本地状态），
   * 因此一次连续拖拽只记一步历史、只写一次缓存。
   *
   * options.historyFrom 传拖动开始前的框，用于撤销；
   * options.keepSelection 用于拖完切线后继续保持选中，方便连续微调。
   */
  const applyBoxes = (next, options = {}) => {
    if (options.record !== false) {
      historyRef.current.push(options.historyFrom || boxes);
      if (historyRef.current.length > 20) historyRef.current.shift();
      setHistoryDepth(historyRef.current.length);
    }
    setEditedBoxes(next);
    if (!options.keepSelection) setSelectedIndex(null);
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

  const handleUndo = () => {
    if (historyRef.current.length === 0) return;
    const previous = historyRef.current.pop();
    setHistoryDepth(historyRef.current.length);
    applyBoxes(previous, { record: false });
  };

  /* ---------------- 工具切换 ---------------- */

  // 当前生效的工具由实际手势状态反推，保证 tab 高亮永远和画面一致
  const tool = regionCut
    ? 'region'
    : drawing
      ? (regionMode ? 'region' : 'add')
      : cutMode
        ? 'boundary'
        : 'adjust';

  /** 切到某个工具；点当前工具则回到「调整」（相当于取消） */
  const selectTool = (next) => {
    const target = next === tool ? 'adjust' : next;
    setDrawing(false);
    setRegionMode(false);
    setRegionCut(null);
    setCutMode(false);
    setCandidateLines([]);
    setSelectedLines([]);
    setDraftRect(null);
    draftStartRef.current = null;
    if (target === 'add') {
      startDraw();
    } else if (target === 'region') {
      startRegionDraw();
    } else if (target === 'boundary') {
      setCutMode(true);
    }
  };

  const exitCutPanel = () => {
    setCutMode(false);
    setRegionCut(null);
    setCandidateLines([]);
    setSelectedLines([]);
  };

  /* ---------------- 本列切线 / 框拖动（不做跨列对齐） ---------------- */

  const toImagePoint = (event) => {
    const point = pointToPercent(event);
    if (!point) return null;
    return { x: point.x * imageSize.width, y: point.y * imageSize.height };
  };

  const startDrag = (event, config) => {
    if (drawing) return;
    const point = toImagePoint(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    // 捕获指针：拖出框 / 切线本身后仍能收到 move 与 up
    if (event.currentTarget.setPointerCapture && Number.isFinite(event.pointerId)) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch (error) {
        /* 某些浏览器不支持捕获时，退回容器级事件 */
      }
    }
    dragRef.current = {
      ...config,
      start: point,
      startBoxes: boxes.map((box) => ({ ...box })),
      startY: config.kind === 'boundary' ? columnCuts[config.boundaryIndex] : 0,
      column: activeColumn ? [...activeColumn.indices] : [],
      moved: false,
      lastBoxes: null
    };
  };

  const handleDragMove = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const point = toImagePoint(event);
    if (!point) return;
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 2) return;
    drag.moved = true;
    event.preventDefault();

    const bounds = { width: imageSize.width, height: imageSize.height };
    let next = null;
    if (drag.kind === 'move') {
      next = moveBox(drag.startBoxes, drag.index, dx, dy, bounds);
    } else if (drag.kind === 'resize') {
      next = resizeBox(drag.startBoxes, drag.index, drag.edge, dx, dy, bounds);
    } else if (drag.kind === 'boundary') {
      // 只吸附本列的候选线与其它切线，绝不吸附另一列的字位
      const candidates = [
        ...candidateLines,
        ...columnCuts.filter((_, i) => i !== drag.boundaryIndex)
      ];
      const y = snapValue(drag.startY + dy, candidates, 8);
      next = setColumnBoundary(drag.startBoxes, drag.column, drag.boundaryIndex, y);
    }
    if (!next) return;
    drag.lastBoxes = next;
    // 拖动中只更新本地显示，结束时才写缓存 / 记历史
    setEditedBoxes(next);
  };

  const handleDragEnd = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;

    // pointerdown 上阻止了默认行为，浏览器可能不再合成 click。
    // 点击（未拖动）在这里显式处理，并把随后可能到来的 click 吞掉。
    suppressClickRef.current = true;
    setTimeout(() => {
      suppressClickRef.current = false;
    }, 80);
    if (!drag.moved) {
      if (drag.kind === 'move') selectBox(boxes[drag.index], drag.index);
      return;
    }
    if (!drag.lastBoxes) return;
    applyBoxes(drag.lastBoxes, {
      historyFrom: drag.startBoxes,
      keepSelection: true
    });
  };

  /** 只在本列范围内找行投影低谷，给出「可能」的字间切线，由用户点选 */
  const handleFindCandidates = async () => {
    if (!columnRange || !image || profilePending) return;
    setProfilePending(true);
    try {
      const { boundaries, mask } = await getCandidateBoundaries(image, {
        x0: columnRange.x0,
        x1: columnRange.x1,
        y0: columnRange.y0,
        y1: columnRange.y1,
        mask: maskRef.current,
        maxCount: 16
      });
      maskRef.current = mask;
      setCandidateLines(boundaries);
      setSelectedLines([]);
    } catch (error) {
      setCandidateLines([]);
    } finally {
      setProfilePending(false);
    }
  };

  const toggleCandidateLine = (y) => {
    setSelectedLines((current) =>
      current.includes(y) ? current.filter((v) => v !== y) : [...current, y].sort((a, b) => a - b)
    );
  };

  const handleApplyCuts = () => {
    if (!activeColumn || selectedLines.length === 0) return;
    const next = resegmentColumnRange(boxes, activeColumn.indices, selectedLines, true);
    if (next === boxes) return;
    const source = boxes; // 确认弹窗期间 boxes 可能变化，历史固定为点击那一刻
    confirmIfPracticed(() => {
      clearPracticeForImage();
      applyBoxes(next, { historyFrom: source });
      setCandidateLines([]);
      setSelectedLines([]);
    });
  };

  /**
   * 把区域大框按选中的切线一次拆成多个字框。
   * 复用 resegmentColumnRange：把大框临时追加到数组末尾，只重切它一个，
   * 函数内部会保留其它框并统一按阅读顺序重排（新框不会排到末尾导致跳字）。
   */
  const handleApplyRegionCuts = () => {
    if (!regionCut || selectedLines.length === 0) return;
    const source = boxes;
    const draft = [...source, regionCut.box];
    const next = resegmentColumnRange(draft, [source.length], selectedLines, true);
    if (next === draft) return;
    confirmIfPracticed(() => {
      clearPracticeForImage();
      applyBoxes(next, { historyFrom: source });
      setRegionCut(null);
      setSelectedLines([]);
    });
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

  /* ---------------- 文案 ---------------- */

  // 版面固定竖排，不再作为信息展示；这里只说"框是怎么来的"
  const strategyLabel = !result
    ? ''
    : editedBoxes
      ? '已手动调整'
      : result.strategy === 'grid-lines'
        ? '按格线切分'
        : '自动切分';

  const toolHint = (() => {
    if (tool === 'add') return '轻点补框，或拖出指定大小；可连续补多个';
    if (tool === 'region') {
      return regionCut
        ? `区域切分：找到 ${barLines.length} 条候选线，点编号增减，再点「应用」`
        : '拖出矩形框住题款 / 小字区域，松手后自动找字间空白';
    }
    if (tool === 'boundary') {
      return selectedIndex === null
        ? '先点本列任意一个字框，再拖动横线调整相邻两字的边界'
        : `本列 ${columnCuts.length + 1} 字：拖动横线调边界，上下两字同步不重叠`;
    }
    return selectedIndex === null
      ? '点字框选中后可拖动、拉角改大小'
      : `已选中第 ${selectedIndex + 1} 个字：可拖动位置、拉四角改大小`;
  })();

  return (
    <>
      <div className="seg-page" role="dialog" aria-modal="true" aria-label="字框编辑">
        <div className="seg-page__bar">
          <button className="icon-btn" onClick={handleClose} aria-label="返回临摹">
            <FaChevronLeft size={17} />
          </button>
          <div className="seg-page__title">
            <b>字框编辑</b>
            {status === 'done' && (
              <span>
                {boxes.length} 字 · {strategyLabel}
              </span>
            )}
          </div>
          <button
            className="icon-btn"
            onClick={handleUndo}
            disabled={historyDepth === 0}
            aria-label="撤销上一步"
            title="撤销"
          >
            <FaUndo size={14} />
          </button>
          <button
            className="icon-btn"
            onClick={() => setMenuOpen((value) => !value)}
            aria-label="更多选项"
            title="更多"
          >
            <FaEllipsisH size={15} />
          </button>
        </div>

        {menuOpen && (
          <>
            <div className="seg-menu-backdrop" onClick={() => setMenuOpen(false)} />
            <div className="seg-menu" role="menu">
              <label className="seg-menu__row">
                <span>
                  这张字帖带格子线
                  <em>开启后按格线切分，更准</em>
                </span>
                <input
                  type="checkbox"
                  checked={hasGrid}
                  onChange={(event) => setHasGrid(event.target.checked)}
                />
              </label>
              <button
                className="seg-menu__row"
                onClick={() => {
                  setMenuOpen(false);
                  confirmIfPracticed(handleRetry);
                }}
              >
                <span>
                  重新切分
                  <em>按当前设置重算全部字框</em>
                </span>
                <FaRedo size={12} />
              </button>
              {editedBoxes && (
                <button
                  className="seg-menu__row"
                  onClick={() => {
                    setMenuOpen(false);
                    handleResetEdit();
                  }}
                >
                  <span>
                    还原为自动切分
                    <em>丢弃这次的手动调整</em>
                  </span>
                  <FaUndo size={12} />
                </button>
              )}
            </div>
          </>
        )}

        {status === 'done' && (
          <div className="seg-tools">
            <div className="seg-tools__tabs" role="tablist" aria-label="编辑工具">
              {TOOLS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.value}
                    className={`seg-tool${tool === item.value ? ' seg-tool--active' : ''}`}
                    onClick={() => selectTool(item.value)}
                    role="tab"
                    aria-selected={tool === item.value}
                  >
                    <Icon size={15} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="seg-tools__hint">{toolHint}</p>
          </div>
        )}

        <div className="seg-page__stage">
          {status === 'loading' && <div className="seg-hint">正在分析版面…</div>}

          {status === 'error' && (
            <div className="sheet-empty">
              <FaExclamationTriangle />
              <span>切分失败。可点右上角「⋯」重新切分，或返回后直接轻触图片选字。</span>
            </div>
          )}

          {status === 'empty' && (
            <div className="sheet-empty">
              <FaExclamationTriangle />
              <span>没有找到可切分的文字区域。字距太密或背景较脏时，可返回后直接轻触图片选字。</span>
            </div>
          )}

          {(retryPending || retryNotice) && (
            <div className={`seg-retry-notice${retryPending ? ' seg-retry-notice--pending' : ''}`}>
              {retryPending ? <FaRedo size={12} /> : <FaCheck size={12} />}
              {retryPending ? '正在重新切分…' : retryNotice}
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
              onPointerMove={handleDragMove}
              onPointerUp={handleDragEnd}
              onPointerCancel={handleDragEnd}
            >
              <img src={image} alt="切分结果" draggable={false} />
              {boxes.map((box, index) => (
                <div
                  key={`${index}-${Math.round(box.x)}-${Math.round(box.y)}`}
                  className={`seg-box${drawing ? '' : ' seg-box--editable'}${
                    selectedIndex === index ? ' seg-box--selected' : ''
                  }`}
                  style={{
                    left: `${(box.x / imageSize.width) * 100}%`,
                    top: `${(box.y / imageSize.height) * 100}%`,
                    width: `${(box.width / imageSize.width) * 100}%`,
                    height: `${(box.height / imageSize.height) * 100}%`
                  }}
                  onClick={() => handleBoxClick(box, index)}
                  onPointerDown={(event) => startDrag(event, { kind: 'move', index })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      handleBoxClick(box, index);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`第 ${index + 1} 个字`}
                >
                  {!drawing && selectedIndex === index &&
                    HANDLES.map((handle) => (
                      <span
                        key={handle.edge}
                        className={`seg-handle ${handle.className}`}
                        onPointerDown={(event) =>
                          startDrag(event, { kind: 'resize', index, edge: handle.edge })
                        }
                        role="presentation"
                      />
                    ))}
                </div>
              ))}
              {cutMode && columnRange && (
                <>
                  {columnCuts.map((y, i) => (
                    <div
                      key={`cut-${i}`}
                      className="seg-cut-line"
                      style={{
                        left: `${(columnRange.x0 / imageSize.width) * 100}%`,
                        width: `${((columnRange.x1 - columnRange.x0) / imageSize.width) * 100}%`,
                        top: `${(y / imageSize.height) * 100}%`
                      }}
                      onPointerDown={(event) =>
                        startDrag(event, { kind: 'boundary', boundaryIndex: i })
                      }
                      role="slider"
                      tabIndex={-1}
                      aria-label={`第 ${i + 1} 条切线`}
                      aria-valuenow={Math.round(y)}
                    />
                  ))}
                  {candidateLines.map((y, i) => (
                    <div
                      key={`candidate-${y}`}
                      className={`seg-cut-candidate${selectedLines.includes(y) ? ' seg-cut-candidate--on' : ''}`}
                      style={{
                        left: `${(columnRange.x0 / imageSize.width) * 100}%`,
                        width: `${((columnRange.x1 - columnRange.x0) / imageSize.width) * 100}%`,
                        top: `${(y / imageSize.height) * 100}%`
                      }}
                    >
                      <span className="seg-cut-candidate__label">{i + 1}</span>
                    </div>
                  ))}
                </>
              )}
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

        {/* 底部条只在有实际内容时出现：切线面板 或 选中框的操作条。
            空态不占位，把高度让给图片；说明统一放在顶部工具提示里，不重复 */}
        {status === 'done' && (cutMode || regionCut || selectedIndex !== null) && (
          <div className="seg-page__foot">
            {cutMode || regionCut ? (
              <div className="seg-cut-panel">
                <div className="seg-cut-panel__head">
                  <span>
                    {regionCut
                      ? `区域切分 · ${barLines.length} 条候选线`
                      : selectedIndex === null
                        ? '分界：先点本列任意一个字框'
                        : `本列 ${columnCuts.length + 1} 字 · ${barLines.length} 条候选线`}
                  </span>
                  <button className="btn btn--text" onClick={exitCutPanel}>
                    退出
                  </button>
                </div>
                {/* 还没选中本列时不显示「找候选线 / 应用」，避免一排灰按钮让人以为坏了 */}
                {(regionCut || columnRange) && (
                  <div className="seg-cut-bar">
                    <button
                      className="btn btn--ghost"
                      onClick={regionCut ? () => analyzeRegion(regionCut.box) : handleFindCandidates}
                      disabled={profilePending}
                    >
                      {profilePending ? '分析中…' : '找候选线'}
                    </button>
                    <div className="seg-cut-chips">
                      {barLines.length === 0 ? (
                        <span className="seg-cut-bar__hint">
                          {regionCut
                            ? '没找到字间空白：换个范围重试，或用「加框」补字'
                            : '先点「找候选线」，再从编号里挑要切的线'}
                        </span>
                      ) : (
                        barLines.map((y, i) => (
                          <button
                            key={y}
                            className={`seg-cut-chip${selectedLines.includes(y) ? ' seg-cut-chip--on' : ''}`}
                            onClick={() => toggleCandidateLine(y)}
                            aria-label={`候选线 ${i + 1}`}
                            aria-pressed={selectedLines.includes(y)}
                          >
                            {i + 1}
                          </button>
                        ))
                      )}
                    </div>
                    <button
                      className="btn btn--primary"
                      onClick={regionCut ? handleApplyRegionCuts : handleApplyCuts}
                      disabled={selectedLines.length === 0}
                    >
                      应用{selectedLines.length > 0 ? ` (${selectedLines.length})` : ''}
                    </button>
                  </div>
                )}
              </div>
            ) : selectedIndex !== null ? (
              <div className="seg-context">
                <span className="seg-context__label">第 {selectedIndex + 1} 个字</span>
                <div className="seg-context__actions">
                  <button
                    className="btn btn--ghost"
                    onClick={() => handlePick(boxes[selectedIndex], selectedIndex)}
                  >
                    <FaPen size={12} />
                    临摹此字
                  </button>
                  <button className="btn btn--ghost" onClick={handleDelete}>
                    <FaTrashAlt size={12} />
                    删除
                  </button>
                  <button className="btn btn--ghost" onClick={handleMerge}>
                    <FaCompress size={12} />
                    合并
                  </button>
                  <button className="btn btn--ghost" onClick={handleSplit}>
                    <FaCut size={12} />
                    拆分
                  </button>
                </div>
              </div>
            ) : null}
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
