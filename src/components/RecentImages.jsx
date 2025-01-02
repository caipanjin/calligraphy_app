// 导入 React 核心库和状态钩子
import React, { useState, useRef } from 'react';

/**
 * 最近图片组件
 * @param {Array} recentImages - 最近查看的图片列表
 * @param {string} image - 当前显示的图片URL
 * @param {function} setImage - 设置当前图片的回调函数
 * @param {function} handleImageUpload - 处理图片上传的回调函数
 * @param {function} setSelectedCharacter - 设置选中字符的回调函数
 */
const RecentImages = ({ recentImages, image, setImage, handleImageUpload, setSelectedCharacter, deleteImage }) => {
  // 控制是否显示最近图片列表
  const [showRecentImages, setShowRecentImages] = useState(false);
  // 控制删除确认弹窗
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  // 当前要删除的图片索引
  const [deleteIndex, setDeleteIndex] = useState(null);
  // 长按计时器
  const longPressTimer = useRef(null);

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
              {recentImages.filter(img => img).map((img, index) => (
                <img
                  key={index}
                  src={img}
                  alt={`最近图片 ${index + 1}`}
                  style={{
                    width: '55px',
                    height: '55px',
                    objectFit: 'cover',
                    cursor: 'pointer',
                    border: image === img ? '2px solid blue' : '1px solid #ccc',
                    borderRadius: '4px',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    MozUserSelect: 'none',
                    msUserSelect: 'none'
                  }}
                  onClick={() => {
                    setImage(img);
                    setSelectedCharacter(null);
                  }}
                  onTouchStart={() => {
                    longPressTimer.current = setTimeout(() => {
                      setDeleteIndex(index);
                      setShowDeleteModal(true);
                    }, 500); // 长按0.5秒触发
                  }}
                  onTouchEnd={() => {
                    clearTimeout(longPressTimer.current);
                  }}
                  onTouchMove={() => {
                    clearTimeout(longPressTimer.current);
                  }}
                />
              ))}
            </div>

            {/* 删除确认弹窗 */}
            {showDeleteModal && (
              <div style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.5)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 1000
              }}>
                <div style={{
                  backgroundColor: 'white',
                  padding: '20px',
                  borderRadius: '8px',
                  textAlign: 'center'
                }}>
                  <p>确定要删除这张图片吗？</p>
                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                    <button
                      style={{
                        padding: '8px 16px',
                        backgroundColor: '#ff4d4f',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                      onClick={() => {
                        // 获取原始索引
                      const originalIndex = recentImages.indexOf(recentImages.filter(img => img)[deleteIndex]);
                      deleteImage(originalIndex).then(() => {
                          setImage(null);
                          setShowDeleteModal(false);
                        });
                      }}
                    >
                      删除
                    </button>
                    <button
                      style={{
                        padding: '8px 16px',
                        backgroundColor: '#f0f0f0',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                      onClick={() => setShowDeleteModal(false)}
                    >
                      取消
                    </button>
                  </div>
                </div>
              </div>
            )}
            
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
