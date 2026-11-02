import React, { useCallback, useEffect, useRef, useState } from 'react';
import './index.css';
import Library, { MAX_STICKERS } from './components/Library';
import PracticeView from './components/PracticeView';
import SegmentSheet from './components/SegmentSheet';
import SettingsView from './components/SettingsView';
import Toast from './components/Toast';
import { hashImageData } from './utils/imageHash';
import { deleteSegmentationByPrefix, clearSegmentations } from './utils/segmentCache';
import { deleteImagePractice, clearAllPractice } from './utils/practiceStore';
import { FaImages, FaCog, FaPlus } from 'react-icons/fa';

const DB_NAME = 'calligraphyImages';
const DB_VERSION = 4;
const STORE_NAME = 'images';
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

/** 把某张字帖提到列表最前，并裁剪到上限 */
const promoteRecent = (list, item) => {
  const rest = list.filter((entry) => entry.url !== item.url);
  return [item, ...rest].slice(0, MAX_STICKERS);
};

const App = () => {
  const [db, setDb] = useState(null);
  const [image, setImage] = useState(null);
  const [recentImages, setRecentImages] = useState([]);
  const [tab, setTab] = useState('library');
  const [mode, setMode] = useState('library');
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const [showSegment, setShowSegment] = useState(false);
  // 切分结果变更的版本号：切分面板改动后，临摹页据此重新读取已存网格
  const [gridVersion, setGridVersion] = useState(0);
  const [deleteIndex, setDeleteIndex] = useState(null);
  const [toast, setToast] = useState('');
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY) || 'auto';
    } catch (error) {
      return 'auto';
    }
  });
  const [headerScrolled, setHeaderScrolled] = useState(false);

  const recentRef = useRef([]);
  const toastTimerRef = useRef(null);
  const fileInputRef = useRef(null);

  /* ---------------- 轻提示 ---------------- */

  const showToast = useCallback((message) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(''), TOAST_DURATION);
  }, []);

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

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      // 切分结果缓存（按图片哈希存储，避免每次重新计算）
      if (!database.objectStoreNames.contains('segmentations')) {
        database.createObjectStore('segmentations', { keyPath: 'id' });
      }
      // 每张字帖的用户设置（版面模式 / 是否带格子线）
      if (!database.objectStoreNames.contains('segmentationSettings')) {
        database.createObjectStore('segmentationSettings', { keyPath: 'id' });
      }
      // 练习记录：每个字练过几次（键 = 图片哈希:字索引）
      if (!database.objectStoreNames.contains('practiceRecords')) {
        database.createObjectStore('practiceRecords', { keyPath: 'id' });
      }
      // 每日练习汇总（键 = YYYY-MM-DD）
      if (!database.objectStoreNames.contains('practiceDaily')) {
        database.createObjectStore('practiceDaily', { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => setDb(event.target.result);

    request.onerror = (event) => {
      console.error('IndexedDB error:', event.target.error);
      retryTimer = setTimeout(() => {
        const retry = indexedDB.open(DB_NAME, DB_VERSION);
        retry.onsuccess = (e) => setDb(e.target.result);
      }, 1000);
    };

    request.onblocked = () => console.warn('IndexedDB connection blocked');

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [showToast]);

  useEffect(() => {
    if (!db) return;
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    const currentRequest = store.get('current');
    currentRequest.onsuccess = () => {
      if (currentRequest.result) setImage(currentRequest.result.url);
    };

    const listRequest = store.getAll();
    listRequest.onsuccess = () => {
      const items = listRequest.result
        .filter((item) => item && item.id !== 'current' && item.url)
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        .map((item) => ({ url: item.url, addedAt: item.addedAt, size: item.size }));
      recentRef.current = items;
      setRecentImages(items);
    };
  }, [db]);

  /* ---------------- 列表持久化 ---------------- */

  const updateRecent = useCallback(
    (next) => {
      recentRef.current = next;
      setRecentImages(next);

      if (!db) return;
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const keysRequest = store.getAllKeys();
      keysRequest.onsuccess = () => {
        keysRequest.result
          .filter((key) => String(key).startsWith('recent_'))
          .forEach((key) => store.delete(key));
        next.forEach((item, index) => {
          store.put({
            id: `recent_${index}`,
            url: item.url,
            addedAt: item.addedAt,
            size: item.size
          });
        });
      };
    },
    [db]
  );

  const persistCurrent = useCallback(
    (url) => {
      if (!db) return;
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      if (url) store.put({ id: 'current', url });
      else store.delete('current');
    },
    [db]
  );

  /* ---------------- 交互 ---------------- */

  const openPractice = useCallback(
    (url) => {
      setImage(url);
      setSelectedCharacter(null);
      setShowSegment(false);
      setMode('practice');
      persistCurrent(url);
      window.scrollTo({ top: 0 });
    },
    [persistCurrent]
  );

  const handleOpenSticker = useCallback(
    (index) => {
      const item = recentRef.current[index];
      if (!item) return;
      updateRecent(promoteRecent(recentRef.current, item));
      openPractice(item.url);
    },
    [openPractice, updateRecent]
  );

  const handleUpload = useCallback(
    async (files) => {
      if (!files || files.length === 0) return;

      if (files.length > MAX_STICKERS) {
        showToast(`一次最多上传 ${MAX_STICKERS} 张`);
        return;
      }

      const valid = files.filter((file) => SUPPORTED_TYPES.includes(file.type));
      if (valid.length === 0) {
        showToast('请选择 JPG / PNG / GIF / WebP 图片');
        return;
      }

      const loaded = [];
      for (const file of valid) {
        try {
          const dataUrl = await readFileAsDataUrl(file);
          if (!isValidImageDataUrl(dataUrl)) throw new Error('数据无效');
          loaded.push({ url: dataUrl, addedAt: Date.now(), size: file.size });
        } catch (error) {
          showToast(`${file.name} 读取失败`);
        }
      }

      if (loaded.length === 0) return;

      let next = recentRef.current;
      loaded.forEach((item) => {
        next = promoteRecent(next, item);
      });
      updateRecent(next);

      if (valid.length < files.length) {
        showToast(`已跳过 ${files.length - valid.length} 个不支持的文件`);
      } else {
        showToast(loaded.length > 1 ? `已添加 ${loaded.length} 张字帖` : '字帖已添加');
      }

      openPractice(loaded[0].url);
    },
    [openPractice, showToast, updateRecent]
  );

  const handlePickFiles = useCallback(() => {
    if (fileInputRef.current) fileInputRef.current.click();
  }, []);

  const handleFileInputChange = useCallback(
    (event) => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      if (files.length > 0) handleUpload(files);
    },
    [handleUpload]
  );

  const handleConfirmDelete = useCallback(() => {
    const index = deleteIndex;
    if (index === null) return;
    const target = recentRef.current[index];
    const next = recentRef.current.filter((_, itemIndex) => itemIndex !== index);
    updateRecent(next);
    setDeleteIndex(null);

    if (target) {
      const imageHash = hashImageData(target.url);
      deleteSegmentationByPrefix(db, imageHash);
      deleteImagePractice(db, imageHash);
    }

    if (target && target.url === image) {
      setImage(null);
      setSelectedCharacter(null);
      setMode('library');
      persistCurrent(null);
    }
    showToast('已删除');
  }, [deleteIndex, image, persistCurrent, showToast, updateRecent]);

  const handleClearAll = useCallback(() => {
    clearSegmentations(db);
    clearAllPractice(db);
    updateRecent([]);
    setImage(null);
    setSelectedCharacter(null);
    setMode('library');
    persistCurrent(null);
    showToast('已清空全部字帖');
  }, [db, persistCurrent, showToast, updateRecent]);

  const handleSwitchImage = useCallback(
    (url) => {
      if (!url || url === image) return;
      setImage(url);
      setSelectedCharacter(null);
      persistCurrent(url);
    },
    [image, persistCurrent]
  );

  const handleBackToLibrary = useCallback(() => {
    setMode('library');
    setSelectedCharacter(null);
    setShowSegment(false);
  }, []);

  const currentIndex = recentImages.findIndex((item) => item.url === image);
  const practiceTitle =
    currentIndex >= 0 ? `字帖 ${String(currentIndex + 1).padStart(2, '0')}` : '临摹';

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

      {mode === 'practice' && image ? (
        <PracticeView
          image={image}
          title={practiceTitle}
          selectedCharacter={selectedCharacter}
          setSelectedCharacter={setSelectedCharacter}
          onBack={handleBackToLibrary}
          onOpenSegment={() => setShowSegment(true)}
          recentImages={recentImages}
          onSwitchImage={handleSwitchImage}
          db={db}
          gridVersion={gridVersion}
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
              <button className="icon-btn icon-btn--accent" onClick={handlePickFiles} aria-label="上传字帖">
                <FaPlus size={15} />
              </button>
            )}
          </header>

          <main className="app-main">
            {tab === 'settings' ? (
              <SettingsView
                theme={theme}
                onChangeTheme={setTheme}
                stickerCount={recentImages.length}
                maxStickers={MAX_STICKERS}
                onClearAll={handleClearAll}
              />
            ) : (
              <Library
                images={recentImages}
                currentImage={image}
                onOpen={handleOpenSticker}
                onRequestDelete={setDeleteIndex}
                onPickFiles={handlePickFiles}
              />
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

      {showSegment && image && (
        <SegmentSheet
          db={db}
          image={image}
          onSelectCharacter={(character) => {
            setSelectedCharacter(character);
            setShowSegment(false);
          }}
          onClose={() => {
            setShowSegment(false);
            setGridVersion((value) => value + 1);
          }}
        />
      )}

      {deleteIndex !== null && (
        <div className="modal-backdrop" onClick={() => setDeleteIndex(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3 className="modal__title">删除这张字帖？</h3>
            <p className="modal__desc">删除后需重新上传，本机不会保留副本。</p>
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => setDeleteIndex(null)}>
                取消
              </button>
              <button className="btn btn--danger" onClick={handleConfirmDelete}>
                删除
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
