// 导入 React 核心库和状态钩子
import React, { useState } from 'react';
import { FaSearchPlus, FaSearchMinus } from 'react-icons/fa';

/**
 * 字符选择器组件
 * @param {Object} selectedCharacter - 当前选中的字符信息
 * @param {function} setSelectedCharacter - 设置选中字符的回调函数
 * @param {React.RefObject} charHeightRef - 字符高度的引用
 */
const CharacterSelector = ({ 
  selectedCharacter, 
  setSelectedCharacter,
  charHeightRef
}) => {
  // 是否正在拖动视图
  const [isDragging, setIsDragging] = useState(false);
  // 拖动开始的位置
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  return (
    <div style={{ marginTop: '20px' }}>
      {/* 字符查看容器 */}
      <div 
        style={{ 
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '300px',
          width: '300px',
          margin: '0 auto',
          border: '1px solid #ccc',
          borderRadius: '8px',
          overflow: 'hidden'
        }}
      >
        {/* SVG 视图，支持拖动操作 */}
        <svg
          viewBox={`${selectedCharacter.viewBox.x} ${selectedCharacter.viewBox.y} ${selectedCharacter.viewBox.width} ${selectedCharacter.viewBox.height}`}
          preserveAspectRatio="xMidYMid meet"
          style={{
            width: '100%',
            height: '100%',
            cursor: isDragging ? 'grabbing' : 'grab'
          }}
          onMouseDown={(e) => {
            setIsDragging(true);
            setDragStart({
              x: e.clientX,
              y: e.clientY
            });
          }}
          onMouseMove={(e) => {
            if (isDragging) {
              // 计算拖动距离并更新视图位置
              const dx = (e.clientX - dragStart.x) * (selectedCharacter.viewBox.width / 300);
              const dy = (e.clientY - dragStart.y) * (selectedCharacter.viewBox.height / 300);
              
              setSelectedCharacter(prev => ({
                ...prev,
                viewBox: {
                  ...prev.viewBox,
                  x: prev.viewBox.x - dx,
                  y: prev.viewBox.y - dy
                }
              }));
              
              setDragStart({
                x: e.clientX,
                y: e.clientY
              });
            }
          }}
          onMouseUp={() => setIsDragging(false)}
          onMouseLeave={() => setIsDragging(false)}
          onTouchStart={(e) => {
            const touch = e.touches[0];
            setIsDragging(true);
            setDragStart({
              x: touch.clientX,
              y: touch.clientY
            });
          }}
          onTouchMove={(e) => {
            if (isDragging) {
              const touch = e.touches[0];
              const dx = (touch.clientX - dragStart.x) * (selectedCharacter.viewBox.width / 300);
              const dy = (touch.clientY - dragStart.y) * (selectedCharacter.viewBox.height / 300);
              
              setSelectedCharacter(prev => ({
                ...prev,
                viewBox: {
                  ...prev.viewBox,
                  x: prev.viewBox.x - dx,
                  y: prev.viewBox.y - dy
                }
              }));
              
              setDragStart({
                x: touch.clientX,
                y: touch.clientY
              });
            }
          }}
          onTouchEnd={() => setIsDragging(false)}
        >
          {/* 显示选中的字符图片 */}
          <image
            href={selectedCharacter.src}
            width={selectedCharacter.width}
            height={selectedCharacter.height}
          />
        </svg>
      </div>
      {/* 导航和控制区域 */}
      <div style={{ marginTop: '20px', textAlign: 'center' }}>
        {/* 上一个/下一个按钮 */}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
          <button
            style={{ padding: '8px 16px' }}
            onClick={() => {
              if (!selectedCharacter) {
                return;
              }
              
              // 计算上一个字符的位置
              let newViewBoxY = selectedCharacter.viewBox.y - selectedCharacter.viewBox.height;
              let newViewBoxX = selectedCharacter.viewBox.x;
              
              // 如果超出顶部，切换到右边一列
              if (newViewBoxY < 0) {
                newViewBoxX += selectedCharacter.viewBox.width;
                newViewBoxY = selectedCharacter.height - selectedCharacter.viewBox.height;
              }
              
              // 检查是否超出图片范围
              if (newViewBoxX < selectedCharacter.width && newViewBoxY >= 0) {
                setSelectedCharacter(prev => ({
                  ...prev,
                  viewBox: {
                    ...prev.viewBox,
                    x: newViewBoxX,
                    y: newViewBoxY
                  }
                }));
              }
            }}
          >
            上一个
          </button>
          <button
            style={{ padding: '8px 16px' }}
            onClick={() => {
              if (!selectedCharacter) {
                return;
              }
              
              // 计算下一个字符的位置
              let newViewBoxY = selectedCharacter.viewBox.y + selectedCharacter.viewBox.height;
              let newViewBoxX = selectedCharacter.viewBox.x;
              
              // 如果超出底部，切换到左边一列
              if (newViewBoxY >= selectedCharacter.height) {
                newViewBoxX -= selectedCharacter.viewBox.width;
                newViewBoxY = 0;
              }
              
              // 检查是否超出图片范围
              if (newViewBoxX >= 0 && newViewBoxY < selectedCharacter.height) {
                setSelectedCharacter(prev => ({
                  ...prev,
                  viewBox: {
                    ...prev.viewBox,
                    x: newViewBoxX,
                    y: newViewBoxY
                  }
                }));
              }
            }}
          >
            下一个
          </button>
          <button
            style={{ padding: '8px', display: 'flex', alignItems: 'center' }}
            onClick={() => {
              if (!selectedCharacter) return;
              setSelectedCharacter(prev => {
                const scaleFactor = 1.1;
                const newWidth = prev.viewBox.width / scaleFactor;
                const newHeight = prev.viewBox.height / scaleFactor;
                
                // 计算字符在图片中的实际中心位置
                const charCenterX = prev.viewBox.x + (prev.viewBox.width / 2);
                const charCenterY = prev.viewBox.y + (prev.viewBox.height / 2);
                
                // 计算新的viewBox位置，使字符中心点保持不变
                const newX = charCenterX - (newWidth / 2);
                const newY = charCenterY - (newHeight / 2);
                
                return {
                  ...prev,
                  viewBox: {
                    ...prev.viewBox,
                    x: newX,
                    y: newY,
                    width: newWidth,
                    height: newHeight
                  }
                };
              });
            }}
          >
            <FaSearchPlus />
          </button>
          <button
            style={{ padding: '8px', display: 'flex', alignItems: 'center' }}
            onClick={() => {
              if (!selectedCharacter) return;
              setSelectedCharacter(prev => {
                const scaleFactor = 1.1;
                const newWidth = prev.viewBox.width * scaleFactor;
                const newHeight = prev.viewBox.height * scaleFactor;
                
                // 计算字符在图片中的实际中心位置
                const charCenterX = prev.viewBox.x + (prev.viewBox.width / 2);
                const charCenterY = prev.viewBox.y + (prev.viewBox.height / 2);
                
                // 计算新的viewBox位置，使字符中心点保持不变
                const newX = charCenterX - (newWidth / 2);
                const newY = charCenterY - (newHeight / 2);
                
                return {
                  ...prev,
                  viewBox: {
                    ...prev.viewBox,
                    x: newX,
                    y: newY,
                    width: newWidth,
                    height: newHeight
                  }
                };
              });
            }}
          >
            <FaSearchMinus />
          </button>
        </div>
        
        {/* 字符预览缩略图 */}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', margin: '10px 0' }}>
            {[selectedCharacter.viewBox.y - selectedCharacter.viewBox.height * 3,
            selectedCharacter.viewBox.y - selectedCharacter.viewBox.height * 2,
            selectedCharacter.viewBox.y - selectedCharacter.viewBox.height,
            selectedCharacter.viewBox.y,
            selectedCharacter.viewBox.y + selectedCharacter.viewBox.height,
            selectedCharacter.viewBox.y + selectedCharacter.viewBox.height * 2,
            selectedCharacter.viewBox.y + selectedCharacter.viewBox.height * 3]
            .map((y, index) => {
              const charHeight = selectedCharacter.viewBox.height;
              const isVisible = y >= 0 && y < selectedCharacter.height && 
                (selectedCharacter.height - y) >= charHeight / 2;
              return (
                <div 
                  key={index} 
                  style={{ 
                    width: '50px', 
                    height: '50px', 
                    border: isVisible && y === selectedCharacter.viewBox.y ? '2px solid blue' : '1px solid #ccc', 
                    overflow: 'hidden',
                    cursor: isVisible ? 'pointer' : 'default',
                    visibility: isVisible ? 'visible' : 'hidden'
                  }}
                  onClick={() => {
                    if (isVisible) {
                      setSelectedCharacter(prev => ({
                        ...prev,
                        viewBox: {
                          ...prev.viewBox,
                          y: y
                        }
                      }));
                    }
                  }}
                >
                  <svg
                    viewBox={`${selectedCharacter.viewBox.x} ${y} ${selectedCharacter.viewBox.width} ${selectedCharacter.viewBox.height}`}
                    preserveAspectRatio="xMidYMid meet"
                    style={{ width: '100%', height: '100%' }}
                  >
                    <image
                      href={selectedCharacter.src}
                      width={selectedCharacter.width}
                      height={selectedCharacter.height}
                    />
                  </svg>
                </div>
              );
            })}
        </div>
        
        {/* 返回完整图片按钮 */}
        <button 
          style={{ marginTop: '10px', padding: '8px 16px' }}
          onClick={() => setSelectedCharacter(null)}
        >
          返回完整图片
        </button>
      </div>
    </div>
  );
};

export default CharacterSelector;
