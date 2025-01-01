import React, { useState } from 'react';

const CharacterSelector = ({ 
  selectedCharacter, 
  setSelectedCharacter,
  charHeightRef
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  return (
    <div style={{ marginTop: '20px' }}>
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
          <image
            href={selectedCharacter.src}
            width={selectedCharacter.width}
            height={selectedCharacter.height}
          />
        </svg>
      </div>
      <div style={{ marginTop: '20px', textAlign: 'center' }}>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
          <button
            style={{ padding: '8px 16px' }}
            onClick={() => {
              if (!selectedCharacter) {
                return;
              }
              
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
        </div>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', margin: '10px 0' }}>
          {[selectedCharacter.viewBox.y - charHeightRef.current * 3,
            selectedCharacter.viewBox.y - charHeightRef.current * 2,
            selectedCharacter.viewBox.y - charHeightRef.current,
            selectedCharacter.viewBox.y,
            selectedCharacter.viewBox.y + charHeightRef.current,
            selectedCharacter.viewBox.y + charHeightRef.current * 2,
            selectedCharacter.viewBox.y + charHeightRef.current * 3]
            .map((y, index) => {
              const isVisible = y >= 0 && y < selectedCharacter.height;
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
