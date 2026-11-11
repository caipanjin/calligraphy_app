import React, { useCallback, useEffect, useRef, useState } from 'react';
import './index.css';
import Library from './components/Library';
import PracticeView from './components/PracticeView';
import SegmentSheet from './components/SegmentSheet';
import ImportSheet from './components/ImportSheet';
import ClipboardBanner from './components/ClipboardBanner';
import { detectClipboardImport } from './utils/clipboardDetect';
import SettingsView from './components/SettingsView';
import Toast from './components/Toast';
import { App as CapApp } from '@capacitor/app';
import { clearSegmentations } from './utils/segmentCache';
import { pickFirstUrl } from './utils/wechatArticle';
import { clearAllPractice } from './utils/practiceStore';
import { buildThumbnail, clearThumbnailCache } from './utils/thumbnail';
import { buildProgressMap } from './utils/albumProgress';
import {
  upgradeStores,
  readAlbums,
  readAll,
  createAlbum,
  addPages,
  deletePage,
  deleteAlbum,
  renameAlbum,
  readPage,
  readCurrent,
  saveCurrent,
  clearCurrent,
  clearAllAlbums,
  MAX_ALBUMS,
  MAX_PAGES_PER_ALBUM,
  MAX_FILES_PER_IMPORT
} from './utils/albumStore';
import { FaImages, FaCog, FaPlus } from 'react-icons/fa';

const DB_NAME = 'calligraphyImages';
const DB_VERSION = 5;
const THEME_STORAGE_KEY = 'calligraphy:theme';
const TOAST_DURATION = 2200;
const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('读取失败'));
    reader.onabort = () => reject(new Error('读取中止'));
    reader.readAsDataURL(file);
  });

const isValidImageDataUrl = (dataUrl) => {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return false;
  const parts = dataUrl.split(',');
  if (parts.length < 2) return false;
  const base64 = parts[1];
  return Boolean(base64) && base64.length >= 100 && /^[A-Za-z0-9+/=]+$/.test(base64);
};

/** 估算 data URL 的字节大小（base64 长度 × 3/4） */
const estimateDataUrlSize = (dataUrl) => {
  if (typeof dataUrl !== 'string') return 0;
  const commaIndex = dataUrl.indexOf(',');
  const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  return Math.round((base64.length * 3) / 4);
};

const App = () => {
  const [db, setDb] = useState(null);
  // 字帖列表：只有元数据（id / 标题 / 各页 id·hash·size / 封面缩略图），
  // 绝不把完整 base64 放进 React state。
  const [albums, setAlbums] = useState([]);
  // 当前页的完整 dataUrl：整个 App 运行期间最多只有这一份
  const [image, setImage] = useState(null);
  const [activeAlbumId, setActiveAlbumId] = useState(null);
  const [activePageId, setActivePageId] = useState(null);
  // 仅在内存中保存上次练到哪一页的指针（磁盘里另存一份用于重启恢复）
  const [resumePointer, setResumePointer] = useState(null);
  const [switching, setSwitching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState('library');
  const [mode, setMode] = useState('library');
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const [showSegment, setShowSegment] = useState(false);
  const [showImport, setShowImport] = useState(false);
  // 从外部（微信「用其他应用打开」）传入的待导入链接
  const [importUrl, setImportUrl] = useState('');
  const [clipboardHint, setClipboardHint] = useState(null);
  const clipboardSeenRef = useRef('');
  const clipboardLastReadRef = useRef(0);
  // 每页的练习进度：{ [pageId]: { practiced, total } }
  const [progressMap, setProgressMap] = useState({});
  const [gridVersion, setGridVersion] = useState(0);
  // { kind:'album', albumId } 或 { kind:'page', albumId, pageId }
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [toast, setToast] = useState('');
  const [clipboardWatch, setClipboardWatch] = useState(() => {
    try {
      return localStorage.getItem('calligraphy:clipwatch') !== 'off';
    } catch (error) {
      return true;
    }
  });
  const [resumePractice, setResumePractice] = useState(() => {
    try {
      return localStorage.getItem('calligraphy:resume') !== 'off';
    } catch (error) {
      return true;
    }
  });
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY) || 'auto';
    } catch (error) {
      return 'auto';
    }
  });
  const [headerScrolled, setHeaderScrolled] = useState(false);

  const albumsRef = useRef([]);
  const toastTimerRef = useRef(null);
  const fileInputRef = useRef(null);
  // 记录这次选图是「新建字帖」还是「给某本字帖加页」
  const fileTargetRef = useRef(null);
  // 切页/开帖的异步读取令牌，避免快速连点时旧结果覆盖新结果
  const switchTokenRef = useRef(0);

  /* ---------------- 轻提示 ---------------- */

  const showToast = useCallback((message) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(''), TOAST_DURATION);
  }, []);

  /* ---------------- 剪贴板导入提示 ---------------- */

  const checkClipboard = useCallback(async () => {
    if (!clipboardWatch) return;
    const now = Date.now();
    if (now - clipboardLastReadRef.current < 8000) return;
    clipboardLastReadRef.current = now;

    try {
      const detected = await detectClipboardImport();
      if (!detected.kind) return;
      const fingerprint = `${detected.kind}:${detected.payload.slice(0, 64)}`;
      if (clipboardSeenRef.current === fingerprint) return;
      clipboardSeenRef.current = fingerprint;
      setClipboardHint(detected);
    } catch (error) {
      // 剪贴板不可用（无权限 / 无手势）时静默跳过
    }
  }, [clipboardWatch]);

  useEffect(() => {
    if (mode !== 'library' || tab !== 'library') return undefined;
    const timer = setTimeout(checkClipboard, 300);
    return () => clearTimeout(timer);
  }, [mode, tab, checkClipboard]);

  useEffect(() => {
    let listener = null;
    const register = async () => {
      try {
        listener = await CapApp.addListener('appStateChange', (state) => {
          if (state && state.isActive) setTimeout(checkClipboard, 400);
        });
      } catch (error) {
        // Web 环境无该事件
      }
    };
    register();
    return () => {
      if (listener && listener.remove) listener.remove();
    };
  }, [checkClipboard]);

  /* ---------------- 接收外部分享的链接 ---------------- */

  useEffect(() => {
    let listener = null;
    let cancelled = false;

    const handleIncomingUrl = (raw) => {
      if (!raw) return;
      const text = String(raw);
      const picked = pickFirstUrl(text);
      const target = picked || (/^https?:\/\//i.test(text) ? text : '');
      if (!target) return;
      if (!/mp\.weixin\.qq\.com/i.test(target)) {
        showToast('链接不是公众号文章，已忽略');
        return;
      }
      setImportUrl(target);
      setShowImport(true);
    };

    const register = async () => {
      try {
        listener = await CapApp.addListener('appUrlOpen', (event) => {
          handleIncomingUrl(event && event.url);
        });
        const launch = await CapApp.getLaunchUrl();
        if (!cancelled && launch && launch.url) handleIncomingUrl(launch.url);
      } catch (error) {
        // Web 环境没有该插件能力，忽略
      }
    };

    register();
    return () => {
      cancelled = true;
      if (listener && listener.remove) listener.remove();
    };
  }, [showToast]);

  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    []
  );

  /* ---------------- 主题 ---------------- */

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = theme === 'auto' ? (media.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = resolved;
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', resolved === 'dark' ? '#14130f' : '#f4efe6');
    };
    apply();
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (error) {
      /* 忽略隐私模式下的写入失败 */
    }
    if (theme !== 'auto') return undefined;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  /* ---------------- IndexedDB ---------------- */

  useEffect(() => {
    if (!('indexedDB' in window)) {
      showToast('当前浏览器不支持本地存储');
      return undefined;
    }

    let retryTimer = null;
    let legacyCleared = false;

    const handleSuccess = (database) => {
      setDb(database);
      readAlbums(database)
        .then((list) => {
          albumsRef.current = list;
          setAlbums(list);
          if (legacyCleared) {
            setNotice('数据结构已升级为「一本字帖可含多页」，旧字帖已清空，请重新导入');
          }
        })
        .catch(() => {
          /* 读取失败时保持空列表，不阻塞界面 */
        });
      readCurrent(database)
        .then((pointer) => setResumePointer(pointer || null))
        .catch(() => {});
    };

    const wire = (request) => {
      request.onupgradeneeded = (event) => {
        const cleared = upgradeStores(
          event.target.result,
          event.target.transaction,
          event.oldVersion
        );
        if (cleared) legacyCleared = true;
      };
      request.onsuccess = (event) => handleSuccess(event.target.result);
      request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.error);
        if (!retryTimer) {
          retryTimer = setTimeout(() => {
            retryTimer = null;
            wire(indexedDB.open(DB_NAME, DB_VERSION));
          }, 1000);
        }
      };
      request.onblocked = () => console.warn('IndexedDB connection blocked');
    };

    wire(indexedDB.open(DB_NAME, DB_VERSION));
    return () => {
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [showToast]);

  /* ---------------- 列表读取 ---------------- */

  const refreshAlbums = useCallback(async () => {
    if (!db) return;
    const list = await readAlbums(db);
    albumsRef.current = list;
    setAlbums(list);
  }, [db]);

  /** 进度：两张小表各 getAll 一次，全程不加载任何完整原图 */
  const refreshProgress = useCallback(async () => {
    if (!db) return;
    try {
      const [segmentations, practiceRecords] = await Promise.all([
        readAll(db, 'segmentations'),
        readAll(db, 'practiceRecords')
      ]);
      const pages = albumsRef.current.flatMap((album) => album.pages || []);
      setProgressMap(buildProgressMap(pages, segmentations, practiceRecords));
    } catch (error) {
      /* 进度只是展示，读失败不影响使用 */
    }
  }, [db]);

  useEffect(() => {
    if (mode !== 'library' || !db) return;
    refreshProgress();
  }, [mode, db, albums, gridVersion, refreshProgress]);

  /* ---------------- 打开 / 切页 / 关闭 ---------------- */

  const activatePage = useCallback(
    async (albumId, pageId) => {
      if (!db || !albumId || !pageId) return false;
      const token = ++switchTokenRef.current;
      setSwitching(true);
      try {
        const page = await readPage(db, pageId);
        if (token !== switchTokenRef.current) return false;
        if (!page) {
          setSwitching(false);
          showToast('这一页读取失败');
          return false;
        }
        setActiveAlbumId(albumId);
        setActivePageId(pageId);
        setImage(page.dataUrl);
        setSelectedCharacter(null);
        setShowSegment(false);
        setMode('practice');
        setResumePointer({ albumId, pageId });
        saveCurrent(db, { albumId, pageId }).catch(() => {});
        setSwitching(false);
        window.scrollTo({ top: 0 });
        return true;
      } catch (error) {
        if (token === switchTokenRef.current) {
          setSwitching(false);
          showToast('打开字帖失败');
        }
        return false;
      }
    },
    [db, showToast]
  );

  const openAlbum = useCallback(
    async (albumId, preferredPageId) => {
      const album = albumsRef.current.find((item) => item.id === albumId);
      if (!album || !album.pages || album.pages.length === 0) return;
      const hasPreferred =
        preferredPageId && album.pages.some((page) => page.id === preferredPageId);
      const resumed =
        resumePointer &&
        resumePointer.albumId === albumId &&
        album.pages.some((page) => page.id === resumePointer.pageId);
      const pageId = hasPreferred
        ? preferredPageId
        : resumed
          ? resumePointer.pageId
          : album.pages[0].id;
      await activatePage(albumId, pageId);
    },
    [activatePage, resumePointer]
  );

  const handleSwitchPage = useCallback(
    async (pageId) => {
      if (!pageId || pageId === activePageId || !activeAlbumId) return;
      await activatePage(activeAlbumId, pageId);
    },
    [activatePage, activeAlbumId, activePageId]
  );

  /**
   * 关闭字帖 = 返回字帖库。
   * 这里把当前页完整 dataUrl、选中单字（内嵌一份原图）、切分面板、
   * 缩略图缓存全部清掉；磁盘数据与续练指针保留，重开自动回到上次那一页。
   */
  const handleBackToLibrary = useCallback(() => {
    switchTokenRef.current += 1;
    setMode('library');
    setSelectedCharacter(null);
    setShowSegment(false);
    setSwitching(false);
    setImage(null);
    setActiveAlbumId(null);
    setActivePageId(null);
    clearThumbnailCache();
    refreshAlbums().catch(() => {});
  }, [refreshAlbums]);

  /* ---------------- 导入 ---------------- */

  /**
   * 把已解码的图片写进字帖。缩略图逐张串行生成，避免 N 张大图同时驻留。
   * targetAlbumId 为空表示新建一本字帖，否则是给已有字帖加页。
   */
  const importDataUrls = useCallback(
    async (items, targetAlbumId = null, message = '') => {
      if (!db || !items || items.length === 0) return;
      const target = targetAlbumId
        ? albumsRef.current.find((album) => album.id === targetAlbumId)
        : null;

      if (target && target.pages.length + items.length > MAX_PAGES_PER_ALBUM) {
        showToast(`一本字帖最多 ${MAX_PAGES_PER_ALBUM} 页`);
        return;
      }
      if (!target && albumsRef.current.length >= MAX_ALBUMS) {
        showToast(`最多保存 ${MAX_ALBUMS} 本字帖，请先删除一本`);
        return;
      }

      setImporting(true);
      try {
        const pages = [];
        for (const item of items) {
          const thumb = await buildThumbnail(item.dataUrl);
          pages.push({
            dataUrl: item.dataUrl,
            size: item.size || estimateDataUrlSize(item.dataUrl),
            thumb
          });
        }

        if (target) {
          await addPages(db, target.id, pages);
          await refreshAlbums();
          showToast(message || `已添加 ${pages.length} 页`);
        } else {
          const album = await createAlbum(db, { pages });
          await refreshAlbums();
          showToast(message || `已新建字帖，共 ${pages.length} 页`);
          await openAlbum(album.id, album.pages[0].id);
        }
      } catch (error) {
        showToast('导入失败，请重试');
      } finally {
        setImporting(false);
      }
    },
    [db, openAlbum, refreshAlbums, showToast]
  );

  const handleUpload = useCallback(
    async (files, targetAlbumId = null) => {
      if (!files || files.length === 0) return;
      if (files.length > MAX_FILES_PER_IMPORT) {
        showToast(`一次最多选择 ${MAX_FILES_PER_IMPORT} 张`);
        return;
      }
      const valid = files.filter((file) => SUPPORTED_TYPES.includes(file.type));
      if (valid.length === 0) {
        showToast('请选择 JPG / PNG / GIF / WebP 图片');
        return;
      }

      const items = [];
      for (const file of valid) {
        try {
          const dataUrl = await readFileAsDataUrl(file);
          if (!isValidImageDataUrl(dataUrl)) throw new Error('数据无效');
          items.push({ dataUrl, size: file.size });
        } catch (error) {
          showToast(`${file.name} 读取失败`);
        }
      }
      if (items.length === 0) return;
      await importDataUrls(items, targetAlbumId);
    },
    [importDataUrls, showToast]
  );

  // 从公众号导入的图片（已是 data URL）：整批成为一本新字帖
  const handleImportImages = useCallback(
    async (items, options = {}) => {
      if (!items || items.length === 0) return;
      setShowImport(false);
      setImportUrl('');
      const mapped = items.map((item) => ({
        dataUrl: item.url,
        size: estimateDataUrlSize(item.url)
      }));
      const skipped = options && options.skipped ? options.skipped : 0;
      await importDataUrls(
        mapped,
        null,
        skipped > 0 ? `已导入 ${mapped.length} 页，跳过 ${skipped} 张重复/干扰图` : ''
      );
    },
    [importDataUrls]
  );

  const handleClipboardImport = useCallback(async () => {
    if (!clipboardHint) return;
    const { kind, payload } = clipboardHint;
    if (kind === 'wechat' || kind === 'url') {
      setImportUrl(payload);
      setShowImport(true);
      setClipboardHint(null);
      return;
    }
    if (kind === 'image') {
      await importDataUrls(
        [{ dataUrl: payload, size: estimateDataUrlSize(payload) }],
        null,
        '已从剪贴板导入字帖'
      );
      setClipboardHint(null);
    }
  }, [clipboardHint, importDataUrls]);

  const handlePickFiles = useCallback((targetAlbumId = null) => {
    fileTargetRef.current = targetAlbumId;
    if (fileInputRef.current) fileInputRef.current.click();
  }, []);

  const handleFileInputChange = useCallback(
    (event) => {
      const files = Array.from(event.target.files || []);
      const target = fileTargetRef.current;
      fileTargetRef.current = null;
      event.target.value = '';
      if (files.length > 0) handleUpload(files, target);
    },
    [handleUpload]
  );

  /* ---------------- 删除 / 改名 ---------------- */

  const handleConfirmDelete = useCallback(async () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target || !db) return;

    if (target.kind === 'album') {
      await deleteAlbum(db, target.albumId);
      if (resumePointer && resumePointer.albumId === target.albumId) {
        await clearCurrent(db).catch(() => {});
        setResumePointer(null);
      }
      if (activeAlbumId === target.albumId) handleBackToLibrary();
      await refreshAlbums();
      showToast('字帖已删除');
      return;
    }

    if (target.kind === 'page') {
      const album = albumsRef.current.find((item) => item.id === target.albumId);
      if (!album || album.pages.length <= 1) {
        showToast('至少保留一页；若要移除请删除整本字帖');
        return;
      }
      await deletePage(db, target.albumId, target.pageId);
      await refreshAlbums();
      if (activePageId === target.pageId) {
        const updated = albumsRef.current.find((item) => item.id === target.albumId);
        if (updated && updated.pages[0]) {
          await openAlbum(target.albumId, updated.pages[0].id);
        }
      }
      showToast('已删除这一页');
    }
  }, [
    deleteTarget,
    db,
    resumePointer,
    activeAlbumId,
    activePageId,
    handleBackToLibrary,
    refreshAlbums,
    openAlbum,
    showToast
  ]);

  const handleConfirmRename = useCallback(async () => {
    if (!renameTarget || !db) return;
    const value = renameValue.trim();
    if (!value) {
      showToast('名称不能为空');
      return;
    }
    await renameAlbum(db, renameTarget.albumId, value);
    await refreshAlbums();
    setRenameTarget(null);
  }, [renameTarget, renameValue, db, refreshAlbums, showToast]);

  const handleClearAll = useCallback(async () => {
    await clearAllAlbums(db);
    clearSegmentations(db);
    clearAllPractice(db);
    clearThumbnailCache();
    albumsRef.current = [];
    setAlbums([]);
    setProgressMap({});
    setImage(null);
    setActiveAlbumId(null);
    setActivePageId(null);
    setResumePointer(null);
    setSelectedCharacter(null);
    setShowSegment(false);
    setMode('library');
    showToast('已清空全部字帖');
  }, [db, showToast]);

  /* ---------------- 派生状态 ---------------- */

  const activeAlbum = albums.find((album) => album.id === activeAlbumId) || null;
  const pageList = activeAlbum && Array.isArray(activeAlbum.pages) ? activeAlbum.pages : [];
  const pageIndex = pageList.findIndex((page) => page.id === activePageId);
  const totalPages = albums.reduce((sum, album) => sum + (album.pages ? album.pages.length : 0), 0);

  /* ---------------- 渲染 ---------------- */

  return (
    <div className="app">
      <input
        ref={fileInputRef}
        type="file"
        accept={SUPPORTED_TYPES.join(',')}
        multiple
        className="visually-hidden"
        onChange={handleFileInputChange}
      />

      {mode === 'practice' && image && activeAlbumId ? (
        <PracticeView
          key={activePageId}
          image={image}
          title={activeAlbum ? activeAlbum.title : '临摹'}
          selectedCharacter={selectedCharacter}
          setSelectedCharacter={setSelectedCharacter}
          onBack={handleBackToLibrary}
          onOpenSegment={() => setShowSegment(true)}
          pages={pageList}
          activePageId={activePageId}
          pageIndex={pageIndex}
          onSwitchPage={handleSwitchPage}
          onAddPages={() => handlePickFiles(activeAlbumId)}
          onRequestDeletePage={(pageId) =>
            setDeleteTarget({ kind: 'page', albumId: activeAlbumId, pageId })
          }
          db={db}
          gridVersion={gridVersion}
          resumePractice={resumePractice}
        />
      ) : (
        <>
          <header className={`app-header${headerScrolled ? ' app-header--scrolled' : ''}`}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="app-header__title">{tab === 'settings' ? '设置' : '书法临摹'}</h1>
              <span className="app-header__sub">
                {tab === 'settings' ? '外观与数据' : '点选单字，逐字临摹'}
              </span>
            </div>
            {tab === 'library' && (
              <button className="icon-btn icon-btn--accent" onClick={() => handlePickFiles(null)} aria-label="新建字帖">
                <FaPlus size={15} />
              </button>
            )}
          </header>

          <main className="app-main">
            {tab === 'settings' ? (
              <SettingsView
                theme={theme}
                onChangeTheme={setTheme}
                albumCount={albums.length}
                pageCount={totalPages}
                maxAlbums={MAX_ALBUMS}
                onClearAll={handleClearAll}
                db={db}
                clipboardWatch={clipboardWatch}
                onChangeClipboardWatch={(value) => {
                  setClipboardWatch(value);
                  try { localStorage.setItem('calligraphy:clipwatch', value ? 'on' : 'off'); } catch (error) { /* 忽略 */ }
                  if (!value) setClipboardHint(null);
                }}
                resumePractice={resumePractice}
                onChangeResume={(value) => {
                  setResumePractice(value);
                  try { localStorage.setItem('calligraphy:resume', value ? 'on' : 'off'); } catch (error) { /* 忽略 */ }
                }}
              />
            ) : (
              <>
                {clipboardHint && (
                  <ClipboardBanner
                    kind={clipboardHint.kind}
                    onImport={handleClipboardImport}
                    onDismiss={() => setClipboardHint(null)}
                  />
                )}

                <Library
                  albums={albums}
                  lastAlbumId={resumePointer ? resumePointer.albumId : null}
                  progressMap={progressMap}
                  notice={notice}
                  onDismissNotice={() => setNotice('')}
                  onOpen={openAlbum}
                  onRequestDelete={(albumId) => setDeleteTarget({ kind: 'album', albumId })}
                  onRequestRename={(album) => {
                    setRenameValue(album.title || '');
                    setRenameTarget({ albumId: album.id, title: album.title });
                  }}
                  onPickFiles={() => handlePickFiles(null)}
                  onImport={() => setShowImport(true)}
                />
              </>
            )}
          </main>

          <nav className="tabbar">
            <button
              className={`tabbar__item${tab === 'library' ? ' tabbar__item--active' : ''}`}
              onClick={() => setTab('library')}
            >
              <FaImages />
              <span>字帖</span>
            </button>
            <button
              className={`tabbar__item${tab === 'settings' ? ' tabbar__item--active' : ''}`}
              onClick={() => setTab('settings')}
            >
              <FaCog />
              <span>设置</span>
            </button>
          </nav>
        </>
      )}

      {(switching || importing) && (
        <div className="page-loading" role="status">
          {importing ? '正在处理图片…' : '载入中…'}
        </div>
      )}

      {showSegment && image && (
        <SegmentSheet
          key={activePageId}
          db={db}
          image={image}
          onSelectCharacter={(character) => {
            setSelectedCharacter(character);
            setShowSegment(false);
            // 编辑器里可能改过字框，回到临摹页必须重读网格，
            // 否则点「临摹此字」后上一字/下一字仍按编辑前的旧框跳
            setGridVersion((value) => value + 1);
          }}
          onClose={() => {
            setShowSegment(false);
            setGridVersion((value) => value + 1);
          }}
        />
      )}

      {showImport && (
        <ImportSheet
          initialUrl={importUrl}
          onImport={handleImportImages}
          onClose={() => {
            setShowImport(false);
            setImportUrl('');
          }}
        />
      )}

      {deleteTarget && (
        <div className="modal-backdrop" onClick={() => setDeleteTarget(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3 className="modal__title">
              {deleteTarget.kind === 'album' ? '删除这本字帖？' : '删除这一页？'}
            </h3>
            <p className="modal__desc">
              {deleteTarget.kind === 'album'
                ? '字帖内所有页都会从本机移除，需重新导入。'
                : '只移除当前字帖里的这一页，其他页不受影响。'}
            </p>
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => setDeleteTarget(null)}>
                取消
              </button>
              <button className="btn btn--danger" onClick={handleConfirmDelete}>
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      {renameTarget && (
        <div className="modal-backdrop" onClick={() => setRenameTarget(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3 className="modal__title">重命名字帖</h3>
            <input
              className="modal__input"
              value={renameValue}
              maxLength={40}
              autoFocus
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleConfirmRename();
              }}
              aria-label="字帖名称"
            />
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => setRenameTarget(null)}>
                取消
              </button>
              <button className="btn btn--primary" onClick={handleConfirmRename}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast message={toast} />
    </div>
  );
};

export default App;
