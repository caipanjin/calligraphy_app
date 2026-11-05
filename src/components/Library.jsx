import React from 'react';
import { FaPlus, FaEllipsisH, FaPen, FaFeatherAlt, FaImages, FaLink, FaTimes } from 'react-icons/fa';
import { sumAlbumProgress } from '../utils/albumProgress';
import { MAX_ALBUMS, MAX_PAGES_PER_ALBUM } from '../utils/albumStore';

const formatSize = (bytes) => {
  if (!bytes) return '';
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

/**
 * 字帖库：一本字帖 = 多张页图。
 * 这里只渲染封面缩略图（240px 小图，随字帖元数据一起从 IndexedDB 读出），
 * 完整原图只存在 pages store，打开某本字帖时才单条读取。
 */
const Library = ({
  albums = [],
  lastAlbumId = null,
  progressMap = {},
  notice = '',
  onDismissNotice,
  onOpen,
  onRequestDelete,
  onRequestRename,
  onPickFiles,
  onImport
}) => {
  const totalSize = (album) =>
    (album.pages || []).reduce((sum, page) => sum + (page.size || 0), 0);

  return (
    <>
      {notice && (
        <div className="library-notice">
          <span>{notice}</span>
          <button onClick={onDismissNotice} aria-label="关闭提示">
            <FaTimes size={12} />
          </button>
        </div>
      )}

      {albums.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__seal" aria-hidden="true">帖</div>
          <h2 className="empty-state__title">还没有字帖</h2>
          <p className="empty-state__desc">
            一次选中多张字帖照片，
            <br />
            它们会合成一本可翻页的字帖。
          </p>
          <button className="btn btn--primary" onClick={onPickFiles}>
            <FaPlus />
            新建字帖
          </button>
          <button className="btn btn--ghost" style={{ marginTop: 10 }} onClick={onImport}>
            <FaLink size={13} />
            从公众号导入
          </button>
          <p className="section-head__hint" style={{ marginTop: 14 }}>
            一次最多 {MAX_ALBUMS} 本 / 每本最多 {MAX_PAGES_PER_ALBUM} 页
          </p>
        </div>
      ) : (
        <>
          <div className="section-head">
            <h2 className="section-head__title">字帖</h2>
            <span className="section-head__hint">
              {albums.length} / {MAX_ALBUMS} 本
            </span>
          </div>

          <div className="library-grid">
            {albums.map((album) => {
              const progress = sumAlbumProgress(album, progressMap);
              const pageCount = album.pages ? album.pages.length : 0;
              return (
                <article
                  key={album.id}
                  className={`poster-card${album.id === lastAlbumId ? ' poster-card--current' : ''}`}
                >
                  <button
                    className="poster-card__media"
                    onClick={() => onOpen(album.id)}
                    aria-label={`打开字帖 ${album.title}`}
                  >
                    {album.coverThumb ? (
                      <img src={album.coverThumb} alt="" loading="lazy" decoding="async" />
                    ) : (
                      <span className="poster-card__placeholder" aria-hidden="true">帖</span>
                    )}
                    <span className="poster-card__count">{pageCount} 页</span>
                    {album.id === lastAlbumId && (
                      <span className="poster-card__badge">上次临摹</span>
                    )}
                  </button>
                  <div className="poster-card__meta">
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="poster-card__name">{album.title || '未命名字帖'}</div>
                      <div className="section-head__hint">{formatSize(totalSize(album))}</div>
                      {progress.total > 0 && (
                        <div className="poster-progress">
                          <div className="poster-progress__bar">
                            <span
                              className="poster-progress__fill"
                              style={{
                                width: `${Math.min(100, Math.round((progress.practiced / progress.total) * 100))}%`
                              }}
                            />
                          </div>
                          <span className="poster-progress__text">
                            {progress.practiced}/{progress.total}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="poster-card__actions">
                      <button
                        className="poster-card__more"
                        onClick={() => onRequestRename(album)}
                        aria-label="重命名字帖"
                      >
                        <FaPen size={12} />
                      </button>
                      <button
                        className="poster-card__more"
                        onClick={() => onRequestDelete(album.id)}
                        aria-label="删除字帖"
                      >
                        <FaEllipsisH size={14} />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}

            {albums.length < MAX_ALBUMS && (
              <button className="add-card" onClick={onPickFiles}>
                <FaPlus />
                新建字帖
              </button>
            )}

            <button className="add-card" onClick={onImport}>
              <FaLink size={22} />
              从公众号导入
            </button>
          </div>

          <div className="section-head" style={{ marginTop: 22 }}>
            <h2 className="section-head__title">使用提示</h2>
          </div>
          <div className="settings-card">
            <div className="settings-row">
              <FaFeatherAlt size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <span className="settings-row__label" style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                打开字帖后底部会列出本字帖所有页，左右滑动翻页，也可继续加页。
              </span>
            </div>
            <div className="settings-row">
              <FaImages size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <span className="settings-row__label" style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                不同字帖的页互不关联；返回字帖库会释放当前字帖的所有图片。
              </span>
            </div>
          </div>
        </>
      )}
    </>
  );
};

export default Library;
