import React, { useEffect, useState } from 'react';
import { FaTrashAlt, FaInfoCircle, FaRegLightbulb } from 'react-icons/fa';
import { readPracticeStats } from '../utils/practiceStore';

const THEME_OPTIONS = [
  { value: 'auto', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
];

/** 设置页：外观与数据 */
const SettingsView = ({
  theme,
  onChangeTheme,
  stickerCount,
  maxStickers,
  onClearAll,
  resumePractice = true,
  onChangeResume,
  clipboardWatch = true,
  onChangeClipboardWatch,
  db
}) => {
  const [stats, setStats] = useState({ today: 0, week: 0, total: 0 });

  useEffect(() => {
    let cancelled = false;
    if (!db) return undefined;
    readPracticeStats(db).then((value) => {
      if (!cancelled) setStats(value);
    });
    return () => {
      cancelled = true;
    };
  }, [db]);
  return (
    <>
      <div className="settings-group">
        <h2 className="settings-group__title">外观</h2>
        <div className="settings-card">
          <div className="settings-row">
            <span className="settings-row__label">显示模式</span>
            <div className="settings-segmented">
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className={theme === option.value ? 'is-active' : ''}
                  onClick={() => onChangeTheme(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <h2 className="settings-group__title">练习</h2>
        <div className="settings-card">
          <div className="settings-row">
            <span className="settings-row__label">自动检测剪贴板</span>
            <div className="settings-segmented">
              <button
                className={clipboardWatch ? 'is-active' : ''}
                onClick={() => onChangeClipboardWatch && onChangeClipboardWatch(true)}
              >
                开
              </button>
              <button
                className={!clipboardWatch ? 'is-active' : ''}
                onClick={() => onChangeClipboardWatch && onChangeClipboardWatch(false)}
              >
                关
              </button>
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-row__label">打开字帖时继续上次</span>
            <div className="settings-segmented">
              <button
                className={resumePractice ? 'is-active' : ''}
                onClick={() => onChangeResume && onChangeResume(true)}
              >
                开
              </button>
              <button
                className={!resumePractice ? 'is-active' : ''}
                onClick={() => onChangeResume && onChangeResume(false)}
              >
                关
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <h2 className="settings-group__title">练习统计</h2>
        <div className="settings-card">
          <div className="settings-row">
            <span className="settings-row__label">今日已练</span>
            <span className="settings-row__value">{stats.today} 次</span>
          </div>
          <div className="settings-row">
            <span className="settings-row__label">近 7 天</span>
            <span className="settings-row__value">{stats.week} 次</span>
          </div>
          <div className="settings-row">
            <span className="settings-row__label">累计练过的字</span>
            <span className="settings-row__value">{stats.total} 字</span>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <h2 className="settings-group__title">数据</h2>
        <div className="settings-card">
          <div className="settings-row">
            <span className="settings-row__label">已保存字帖</span>
            <span className="settings-row__value">
              {stickerCount} / {maxStickers}
            </span>
          </div>
          <button className="settings-row" onClick={onClearAll} disabled={stickerCount === 0}>
            <FaTrashAlt size={14} style={{ color: stickerCount === 0 ? 'var(--ink-3)' : 'var(--accent)' }} />
            <span
              className="settings-row__label"
              style={{ color: stickerCount === 0 ? 'var(--ink-3)' : 'var(--accent)' }}
            >
              清空全部字帖
            </span>
          </button>
        </div>
      </div>

      <div className="settings-group">
        <h2 className="settings-group__title">关于</h2>
        <div className="settings-card">
          <div className="settings-row">
            <FaInfoCircle size={14} style={{ color: 'var(--ink-3)' }} />
            <span className="settings-row__label">版本</span>
            <span className="settings-row__value">1.0.0</span>
          </div>
          <div className="settings-row">
            <FaRegLightbulb size={14} style={{ color: 'var(--ink-3)' }} />
            <span className="settings-row__label">自动切字</span>
            <span className="settings-row__value">投影法 · 离线</span>
          </div>
          <div className="settings-row" style={{ alignItems: 'flex-start' }}>
            <span className="settings-row__label" style={{ fontSize: 12.5, lineHeight: 1.7, color: 'var(--ink-3)' }}>
              字帖与设置保存在本机浏览器存储（IndexedDB），不上传服务器。
            </span>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <h2 className="settings-group__title">快捷键（桌面端）</h2>
        <div className="settings-card">
          <div className="settings-row">
            <span className="settings-row__label" style={{ fontSize: 13 }}>方向键</span>
            <span className="settings-row__value">微调单字位置</span>
          </div>
          <div className="settings-row">
            <span className="settings-row__label" style={{ fontSize: 13 }}>+ / −</span>
            <span className="settings-row__value">放大 / 缩小</span>
          </div>
          <div className="settings-row">
            <span className="settings-row__label" style={{ fontSize: 13 }}>PageUp / PageDown</span>
            <span className="settings-row__value">上 / 下一个字</span>
          </div>
          <div className="settings-row">
            <span className="settings-row__label" style={{ fontSize: 13 }}>Esc</span>
            <span className="settings-row__value">返回完整图片</span>
          </div>
        </div>
      </div>
    </>
  );
};

export default SettingsView;
