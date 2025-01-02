// 导入 React 核心库
import React from 'react';
// 导入图片放大组件
import { Magnifier } from 'react-image-magnifiers';

/**
 * 图片查看器组件
 * @param {string} image - 当前显示的图片URL
 * @param {function} handleCharacterClick - 处理图片点击事件的回调函数
 * @param {React.RefObject} imageRef - 图片元素的引用
 * @param {Object} selectedCharacter - 当前选中的字符信息
 */
const ImageViewer = ({ image, handleCharacterClick, imageRef, selectedCharacter }) => {
  return (
    <div className="image-container" style={{ display: image ? 'block' : 'none' }}>
      {/* 图片容器 */}
      <div style={{ position: 'relative' }} ref={imageRef}>
        {/* 当有图片且未选中字符时显示放大镜组件 */}
        {image && !selectedCharacter && (
          <Magnifier
            imageSrc={image}
            largeImageSrc={image}
            imageAlt="Calligraphy"
            style={{ 
              width: '100%', 
              height: 'auto'
            }}
          />
        )}
      </div>
      
      {/* 透明点击层，用于捕获点击事件 */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          cursor: 'crosshair',
          backgroundColor: 'rgba(255,255,255,0)',
          zIndex: 1
        }}
        onClick={handleCharacterClick}
      />
    </div>
  );
};

export default ImageViewer;
