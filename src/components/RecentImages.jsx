// 导入 React 核心库和状态钩子
import React, { useState } from 'react';

/**
 * 最近图片组件
 * @param {Array} recentImages - 最近查看的图片列表
 * @param {string} image - 当前显示的图片URL
 * @param {function} setImage - 设置当前图片的回调函数
 * @param {function} handleImageUpload - 处理图片上传的回调函数
 * @param {function} setSelectedCharacter - 设置选中字符的回调函数
 */
const RecentImages = ({ recentImages, image, setImage, handleImageUpload, setSelectedCharacter }) => {
  // 控制是否显示最近图片列表
  const [showRecentImages, setShowRecentImages] = useState(false);

  return (
    <div style={{ marginBottom: '20px' }}>
      <div style={{ marginBottom: '10px' }}>
        {/* 最近图片标题和切换按钮 */}
        <div 
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            cursor: 'pointer',
            marginBottom: showRecentImages ? '10px' : 0
          }}
          onClick={() => setShowRecentImages(!showRecentImages)}
        >
          <h3 style={{ margin: 0 }}>最近图片</h3>
          <span style={{ marginLeft: '10px' }}>
            {showRecentImages ? '▲' : '▼'}
          </span>
        </div>
        
        {/* 最近图片列表 */}
        {showRecentImages && (
          <>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {recentImages.map((img, index) => (
                <img
                  key={index}
                  src={img}
                  alt={`最近图片 ${index + 1}`}
                  style={{
                    width: '100px',
                    height: '100px',
                    objectFit: 'cover',
                    cursor: 'pointer',
                    border: image === img ? '2px solid blue' : '1px solid #ccc',
                    borderRadius: '4px'
                  }}
                  onClick={() => {
                    setImage(img);
                    setSelectedCharacter(null);
                  }}
                />
              ))}
            </div>
            
            {/* 当没有最近图片时的提示 */}
            {recentImages.length === 0 && (
              <div style={{ color: '#666', marginTop: '10px' }}>
                暂无最近打开的图片
              </div>
            )}
            
            {/* 图片上传输入框 */}
            <div style={{ marginTop: '10px' }}>
              <input type="file" accept="image/*" onChange={handleImageUpload} />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default RecentImages;
