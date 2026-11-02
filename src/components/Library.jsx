import React from 'react';
import { FaPlus, FaEllipsisH, FaFeatherAlt, FaImages } from 'react-icons/fa';

/** 最近图片列表上限 */
export const MAX_STICKERS = 5;

const formatDate = (timestamp) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
};

const formatSize = (bytes) => {
  if (!bytes) return '';
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

/**
 * 字帖库：网格卡片 + 添加入口 + 空状态
 */
const Library = ({ images, currentImage, onOpen, onRequestDelete, onPickFiles, progressMap = {} }) => {
  return (
    <>
      {images.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__seal" aria-hidden="true">
            帖
          </div>
          <h2 className="empty-state__title">还没有字帖</h2>
          <p className="empty-state__desc">
            上传一张字帖照片或扫描件，
            <br />
            点选任意单字即可放大临摹。
          </p>
          <button className="btn btn--primary" onClick={onPickFiles}>
            <FaPlus />
            上传字帖
          </button>
          <p className="section-head__hint" style={{ marginTop: 14 }}>
            支持 JPG / PNG / WebP，单次最多 {MAX_STICKERS} 张
          </p>
        </div>
      ) : (
        <>
          <div className="section-head">
            <h2 className="section-head__title">字帖</h2>
            <span className="section-head__hint">
              {images.length} / {MAX_STICKERS}
            </span>
          </div>

          <div className="library-grid">
            {images.map((item, index) => {
              const isCurrent = item.url === currentImage;
              const date = formatDate(item.addedAt);
              const progress = progressMap[item.url];
              return (
                <article
                  key={`${item.url.slice(-24)}-${index}`}
                  className={`poster-card${isCurrent ? ' poster-card--current' : ''}`}
                >
                  <button
                    className="poster-card__media"
                    onClick={() => onOpen(index)}
                    aria-label={`打开第 ${index + 1} 张字帖`}
                  >
                    <img src={item.url} alt="" />
                    {isCurrent && <span className="poster-card__badge">临摹中</span>}
                  </button>
                  <div className="poster-card__meta">
                    <div style={{ minWidth: 0 }}>
                      <div className="poster-card__name">
                        {date ? `${date} 上传` : `字帖 ${String(index + 1).padStart(2, '0')}`}
                      </div>
                      <div className="section-head__hint">{formatSize(item.size)}</div>
                      {progress && progress.total > 0 && (
                        <div className="poster-progress">
                          <div className="poster-progress__bar">
                            <span
                              className="poster-progress__fill"
                              style={{ width: `${Math.round((progress.practiced / progress.total) * 100)}%` }}
                            />
                          </div>
                          <span className="poster-progress__text">
                            {progress.practiced}/{progress.total}
                          </span>
                        </div>
                      )}
                    </div>
                    <button
                      className="poster-card__more"
                      onClick={() => onRequestDelete(index)}
                      aria-label="删除这张字帖"
                    >
                      <FaEllipsisH size={14} />
                    </button>
                  </div>
                </article>
              );
            })}

            {images.length < MAX_STICKERS && (
              <button className="add-card" onClick={onPickFiles}>
                <FaPlus />
                添加字帖
              </button>
            )}
          </div>

          <div className="section-head" style={{ marginTop: 22 }}>
            <h2 className="section-head__title">使用提示</h2>
          </div>
          <div className="settings-card">
            <div className="settings-row">
              <FaFeatherAlt size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <span className="settings-row__label" style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                打开字帖后可点「自动切字」整页切成单字，也可轻触任意位置手动选字。
              </span>
            </div>
            <div className="settings-row">
              <FaImages size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <span className="settings-row__label" style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                字帖保存在本机，最多保留 {MAX_STICKERS} 张，长按或点击卡片右下角可删除。
              </span>
            </div>
          </div>
        </>
      )}
    </>
  );
};

export default Library;
