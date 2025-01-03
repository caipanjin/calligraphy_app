// 导入 React 核心库和状态钩子
import React, { useState } from 'react';
import { FaSearchPlus, FaSearchMinus, FaChevronUp, FaChevronDown, FaChevronLeft } from 'react-icons/fa';

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

  
  /**
   * 计算下n个字符的位置
   * @param {number} currentX - 当前字符的x坐标
   * @param {number} currentY - 当前字符的y坐标 
   * @param {number} step - 要跳过的字符数，默认为1
   * @returns {Object} 下n个字符的坐标 {x, y}
   */
  const getNextCharacterPosition = (currentX, currentY, step = 1) => {
    if (step <= 0) {
      return { x: currentX, y: currentY };
    }
    
    const charWidth = selectedCharacter.viewBox.width;
    const charHeight = selectedCharacter.viewBox.height;
    const imageWidth = selectedCharacter.width;
    const imageHeight = selectedCharacter.height;
    
    let newY = currentY + charHeight;
    let newX = currentX;
    
    // 如果超出底部，切换到左边一列
    if (newY >= imageHeight) {
      newX -= charWidth;
      newY = 0;
    }
    
    // 检查是否超出图片范围
    if (newX >= 0 && newY < imageHeight) {
      // 如果目标字符不足显示，切换到上一列的最后一个字符
      if (imageWidth - newX < charWidth / 2 ||
          imageHeight - newY < charHeight / 2) {
        newX -= charWidth;
        newY = 0;
        // 检查下一列的第一个字符是否满足条件
        if (newX >= 0 &&
            imageWidth - newX >= charWidth / 2 &&
            imageHeight - newY >= charHeight / 2) {
          return getNextCharacterPosition(newX, newY, step - 1);
        }
      } else {
        return getNextCharacterPosition(newX, newY, step - 1);
      }
    }
    
    // 如果超出范围，返回特殊值表示不显示
    return { x: -1, y: -1 };
  };

  /**
   * 计算上n个字符的位置
   * @param {number} currentX - 当前字符的x坐标
   * @param {number} currentY - 当前字符的y坐标 
   * @param {number} step - 要跳过的字符数，默认为1
   * @returns {Object} 上n个字符的坐标 {x, y}
   */
  const getPreviousCharacterPosition = (currentX, currentY, step = 1) => {
    if (step <= 0) {
      return { x: currentX, y: currentY };
    }
    
    const charWidth = selectedCharacter.viewBox.width;
    const charHeight = selectedCharacter.viewBox.height;
    const imageWidth = selectedCharacter.width;
    const imageHeight = selectedCharacter.height;
    
    let newY = currentY - charHeight;
    let newX = currentX;
    
    // 如果超出顶部，切换到右边一列
    if (newY < 0) {
      newX += charWidth;
      newY = imageHeight - charHeight;
    }
    
    // 检查是否超出图片范围
    if (newX < imageWidth && newY >= 0) {
      // 如果目标字符不足显示，切换到下一列的第一个字符
      if (imageWidth - newX < charWidth / 2 ||
          imageHeight - newY < charHeight / 2) {
        newX += charWidth;
        newY = 0;
        // 检查下一列的第一个字符是否满足条件
        if (newX < imageWidth &&
            imageWidth - newX >= charWidth / 2 &&
            imageHeight - newY >= charHeight / 2) {
          return getPreviousCharacterPosition(newX, newY, step - 1);
        }
      } else {
        return getPreviousCharacterPosition(newX, newY, step - 1);
      }
    }
    
    // 如果超出范围，返回特殊值表示不显示
    return { x: -1, y: -1 };
  };

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
        {/* 按钮容器 */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
          <button
            style={{ padding: '10px 20px', display: 'flex', alignItems: 'center', background: 'transparent', border: 'none' }}
            onClick={() => {
              if (!selectedCharacter) {
                return;
              }
              
              const prevPos = getPreviousCharacterPosition(
                selectedCharacter.viewBox.x,
                selectedCharacter.viewBox.y,
                1 // 默认跳转1个字符
              );
              
              if (prevPos.x !== -1 && prevPos.y !== -1) {
                setSelectedCharacter(prev => ({
                  ...prev,
                  viewBox: {
                    ...prev.viewBox,
                    x: prevPos.x,
                    y: prevPos.y
                  }
                }));
              }
            }}
          >
            <FaChevronUp size={20} />
          </button>
          <button
            style={{ padding: '10px 20px', display: 'flex', alignItems: 'center', background: 'transparent', border: 'none' }}
            onClick={() => {
              if (!selectedCharacter) {
                return;
              }
              
              const nextPos = getNextCharacterPosition(
                selectedCharacter.viewBox.x,
                selectedCharacter.viewBox.y,
                1 // 默认跳转1个字符
              );
              
              if (nextPos.x !== -1 && nextPos.y !== -1) {
                setSelectedCharacter(prev => ({
                  ...prev,
                  viewBox: {
                    ...prev.viewBox,
                    x: nextPos.x,
                    y: nextPos.y
                  }
                }));
              }
            }}
          >
            <FaChevronDown size={20} />
          </button>
          <button
            style={{ padding: '10px 20px', display: 'flex', alignItems: 'center', background: 'transparent', border: 'none' }}
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
              <FaSearchPlus size={20} />
            </button>
            <button
              style={{ padding: '10px 20px', display: 'flex', alignItems: 'center', background: 'transparent', border: 'none' }}
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
              <FaSearchMinus size={20} />
            </button>
        </div>
        
        {/* 字符预览缩略图 */}
        <div style={{ 
          display: 'flex', 
          gap: '10px', 
          justifyContent: 'center', 
          margin: '10px 0',
          alignItems: 'center'
        }}>
            {[
              getPreviousCharacterPosition(
                selectedCharacter.viewBox.x,
                selectedCharacter.viewBox.y,
                2
              ),
              getPreviousCharacterPosition(
                selectedCharacter.viewBox.x,
                selectedCharacter.viewBox.y,
                1
              ),
              {x: selectedCharacter.viewBox.x, y: selectedCharacter.viewBox.y},
              getNextCharacterPosition(
                selectedCharacter.viewBox.x,
                selectedCharacter.viewBox.y,
                1
              ),
              getNextCharacterPosition(
                selectedCharacter.viewBox.x,
                selectedCharacter.viewBox.y,
                2
              )
            ]
            .map((pos, index) => {
              const charHeight = selectedCharacter.viewBox.height;
              const isVisible = pos.x !== -1 && pos.y !== -1;
              return (
                <div 
                  key={index} 
                  style={{ 
                    width: '50px', 
                    height: '50px', 
                    border: isVisible && pos.y === selectedCharacter.viewBox.y ? '2px solid blue' : '1px solid #ccc', 
                    borderRadius: '4px',
                    overflow: 'hidden',
                    cursor: isVisible ? 'pointer' : 'default',
                    visibility: isVisible ? 'visible' : 'hidden',
                    boxSizing: 'border-box',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  onClick={() => {
                    if (isVisible) {
                      setSelectedCharacter(prev => ({
                        ...prev,
                        viewBox: {
                          ...prev.viewBox,
                          x: pos.x,
                          y: pos.y
                        }
                      }));
                    }
                  }}
                >
                    <svg
                    viewBox={`${pos.x} ${pos.y} ${selectedCharacter.viewBox.width} ${selectedCharacter.viewBox.height}`}
                    preserveAspectRatio="xMidYMid meet"
                    style={{ 
                      width: '100%', 
                      height: '100%',
                      objectFit: 'contain'
                    }}
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
          style={{ 
            marginTop: '10px', 
            padding: '8px 16px', 
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            background: 'transparent'
          }}
          onClick={() => setSelectedCharacter(null)}
        >
          <FaChevronLeft style={{ marginRight: '8px' }} />
          返回完整图片
        </button>
      </div>
    </div>
  );
};

export default CharacterSelector;
