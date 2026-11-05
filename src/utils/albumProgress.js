/**
 * 字帖库进度汇总
 *
 * 旧版对每张图串行读 8~10 次 IndexedDB（切分缓存 4 变体 × 自动/手动 + 练习记录），
 * 多页字帖下会放大到几千次往返。这里改成两张小表各读一次 getAll，在内存里
 * 按页哈希组装，全程不需要加载任何完整原图。
 */

/** 从切分缓存里取每个图片哈希的「总字数」：手动结果优先于自动结果 */
const buildTotals = (segmentations) => {
  const totals = new Map();
  (segmentations || []).forEach((record) => {
    if (!record || !Array.isArray(record.boxes) || record.boxes.length === 0) return;
    const id = String(record.id || '');
    const hash = id.split(':')[0];
    const manual = id.endsWith(':manual');
    const previous = totals.get(hash) || { count: 0, manual: false };
    if (manual && !previous.manual) {
      totals.set(hash, { count: record.boxes.length, manual: true });
    } else if (manual === previous.manual && record.boxes.length > previous.count) {
      totals.set(hash, { count: record.boxes.length, manual });
    }
  });
  return totals;
};

/** 每个图片哈希练过多少个不同的字（count > 0 记一次） */
const buildPracticed = (practiceRecords) => {
  const counts = new Map();
  (practiceRecords || []).forEach((record) => {
    if (!record || !(record.count > 0) || !record.imageHash) return;
    counts.set(record.imageHash, (counts.get(record.imageHash) || 0) + 1);
  });
  return counts;
};

/**
 * @param {Array<{id,hash}>} pages 所有字帖的页元数据（不含原图）
 * @param {Array} segmentations segmentations store 的 getAll 结果
 * @param {Array} practiceRecords practiceRecords store 的 getAll 结果
 * @returns {Object} { [pageId]: { practiced, total } }
 */
export const buildProgressMap = (pages, segmentations, practiceRecords) => {
  const totals = buildTotals(segmentations);
  const practiced = buildPracticed(practiceRecords);
  const result = {};
  (pages || []).forEach((page) => {
    if (!page || !page.id) return;
    const hash = page.hash || '';
    result[page.id] = {
      practiced: practiced.get(hash) || 0,
      total: (totals.get(hash) || {}).count || 0
    };
  });
  return result;
};

/** 把每本字帖各页进度累加成卡片上的一行数字 */
export const sumAlbumProgress = (album, progressMap) => {
  const pages = album && Array.isArray(album.pages) ? album.pages : [];
  return pages.reduce(
    (acc, page) => {
      const item = progressMap[page.id];
      if (item) {
        acc.practiced += item.practiced || 0;
        acc.total += item.total || 0;
      }
      return acc;
    },
    { practiced: 0, total: 0 }
  );
};
