import React from 'react';
import { FaLink, FaImage, FaTimes } from 'react-icons/fa';

/**
 * 剪贴板导入提示条
 *
 * 出现在页面顶部，提示用户「检测到剪贴板里有可导入的内容」。
 * 不自动导入，由用户点「导入」确认 —— 避免误操作。
 */
const ClipboardBanner = ({ kind, onImport, onDismiss }) => {
  if (!kind) return null;

  const isWechat = kind === 'wechat';
  const isImage = kind === 'image';

  const label = isWechat
    ? '检测到公众号链接'
    : isImage
      ? '检测到剪贴板图片'
      : '检测到网页链接';

  const action = isWechat ? '导入文章图片' : isImage ? '导入这张图' : '打开导入';

  return (
    <div className="clip-banner" role="status">
      <span className="clip-banner__icon">
        {isImage ? <FaImage size={13} /> : <FaLink size={13} />}
      </span>
      <span className="clip-banner__text">{label}</span>
      <button className="clip-banner__action" onClick={onImport}>
        {action}
      </button>
      <button className="clip-banner__close" onClick={onDismiss} aria-label="忽略">
        <FaTimes size={12} />
      </button>
    </div>
  );
};

export default ClipboardBanner;
