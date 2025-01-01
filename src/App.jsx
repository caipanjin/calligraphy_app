import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Magnifier } from 'react-image-magnifiers';
import './index.css';

const App = () => {
  const [image, setImage] = useState(() => {
    const savedImage = localStorage.getItem('recentImage');
    return savedImage ? savedImage : null;
  });
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const [lastClickPosition, setLastClickPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const charHeightRef = useRef(0);
  // 同步recentImages状态和localStorage
  const [recentImages, setRecentImages] = useState(() => {
    try {
      const savedImages = localStorage.getItem('recentImages');
      console.log('Loading recent images from localStorage:', savedImages);
      if (savedImages) {
        const parsedImages = JSON.parse(savedImages);
        console.log('Parsed recent images:', parsedImages);
        return parsedImages;
      }
      return [];
    } catch (error) {
      console.error('Error loading recent images:', error);
      return [];
    }
  });

  useEffect(() => {
    // 当recentImages变化时更新localStorage
    try {
      localStorage.setItem('recentImages', JSON.stringify(recentImages));
    } catch (error) {
      console.error('Error saving recent images:', error);
    }
  }, [recentImages]);
  const [showRecentImages, setShowRecentImages] = useState(false);
  const imageRef = useRef(null);

  const getImageRef = useCallback(() => imageRef.current, []);

  useEffect(() => {
    console.log('Image ref initialized:', getImageRef());
  }, [getImageRef, image, selectedCharacter]);

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (file) {
      // 检查文件类型
      if (!file.type.startsWith('image/')) {
        console.error('Invalid file type:', file.type);
        return;
      }

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          // 将base64数据转换为Blob
          const base64Data = e.target.result.split(',')[1];
          const blob = await fetch(`data:image/jpeg;base64,${base64Data}`)
            .then(res => res.blob());
          
          // 生成临时URL
          const imageUrl = URL.createObjectURL(blob);
          
          // 更新当前图片
          setImage(imageUrl);
          try {
            localStorage.setItem('recentImage', imageUrl);
            console.log('Current image updated in state and localStorage');
          } catch (error) {
            console.error('Error saving to localStorage:', error);
            // 如果localStorage失败，只更新状态
            return;
          }

          // 处理最近图片列表
          const currentRecentImages = recentImages.filter(img => {
            const isDuplicate = img === imageUrl;
            if (isDuplicate) {
              console.log('Found duplicate image, removing:', img);
            }
            return !isDuplicate;
          });
          console.log('Current recent images (after filtering duplicates):', currentRecentImages);
          
          const updatedImages = [imageUrl, ...currentRecentImages].slice(0, 3);
          console.log('Updated recent images list:', updatedImages);

          // 强制更新状态
          setRecentImages(prev => {
            console.log('Previous state:', prev);
            return updatedImages;
          });
          console.log('Recent images state updated');

          // 更新localStorage
          try {
            localStorage.setItem('recentImages', JSON.stringify(updatedImages));
            console.log('Recent images saved to localStorage');
            // 验证存储是否成功
            const storedImages = JSON.parse(localStorage.getItem('recentImages'));
            console.log('Stored images verification:', storedImages);
          } catch (error) {
            console.error('Error saving to localStorage:', error);
          }

          // 强制展开最近图片列表
          setShowRecentImages(true);
          console.log('Recent images list expanded');
        } catch (error) {
          console.error('Error handling image upload:', error);
        }
      };
      reader.onerror = (error) => {
        console.error('Error reading file:', error);
      };
      reader.readAsDataURL(file);
    } else {
      console.log('No file selected');
    }
  };

  const handleCharacterClick = async (e) => {
    try {
      const currentImageRef = getImageRef();
      if (!image || !currentImageRef) {
        console.log('No image loaded or image ref is null');
        return;
      }

      const imgRect = currentImageRef.getBoundingClientRect();
      const clickX = e.clientX - imgRect.left;
      const clickY = e.clientY - imgRect.top;

      // 确保使用有效的图片尺寸
      const naturalWidth = currentImageRef.naturalWidth > 0 ? currentImageRef.naturalWidth : imgRect.width;
      const naturalHeight = currentImageRef.naturalHeight > 0 ? currentImageRef.naturalHeight : imgRect.height;

      // 如果imgRect.height为0，使用naturalHeight
      const effectiveHeight = imgRect.height > 0 ? imgRect.height : naturalHeight;
      const effectiveWidth = imgRect.width > 0 ? imgRect.width : naturalWidth;

      const charAspectRatio = 1.1;
      const charWidth = effectiveWidth * 0.25;
      charHeightRef.current = charWidth * charAspectRatio;
      // 确保字符高度不小于最小高度
      const minCharHeight = effectiveHeight * 0.1;
      if (charHeightRef.current < minCharHeight) {
        charHeightRef.current = minCharHeight;
      }

      // 如果imgRect尺寸无效，直接返回
      if (effectiveWidth === 0 || effectiveHeight === 0) {
        console.error('Invalid image dimensions:', { imgRect, naturalWidth, naturalHeight });
        return;
      }

      const scale = imgRect.width / naturalWidth;

      // 将屏幕坐标转换为原始图片坐标
      if (imgRect.width === 0 || imgRect.height === 0) {
        console.error('Invalid image dimensions:', imgRect);
        return;
      }
      const scaleX = naturalWidth / imgRect.width;
      const scaleY = naturalHeight / imgRect.height;
      const viewBoxX = (clickX - charWidth/2) * scaleX;
      const viewBoxY = (clickY - charHeightRef.current/2) * scaleY;
      const viewBoxWidth = charWidth * scaleX;
      const viewBoxHeight = charHeightRef.current * scaleY;

      // 确保viewBox值有效
      if (isNaN(viewBoxX) || isNaN(viewBoxY) || isNaN(viewBoxWidth) || isNaN(viewBoxHeight)) {
        console.error('Invalid viewBox values:', { viewBoxX, viewBoxY, viewBoxWidth, viewBoxHeight });
        return;
      }

      setSelectedCharacter({
        src: image,
        width: naturalWidth,
        height: naturalHeight,
        viewBox: {
          x: viewBoxX,
          y: viewBoxY,
          width: viewBoxWidth,
          height: viewBoxHeight
        }
      });

      setLastClickPosition({ x: clickX, y: clickY });

    } catch (error) {
      console.error('Error handling character click:', error);
    }
  };

  return (
    <div className="container">
      <h1>Calligraphy App</h1>
      <div style={{ marginBottom: '20px' }}>
        <div style={{ marginBottom: '10px' }}>
          <div 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              cursor: 'pointer',
              marginBottom: showRecentImages ? '10px' : 0
            }}
            onClick={() => setShowRecentImages(!showRecentImages)}
          >
            <h3 style={{ margin: 0 }}>最近打开的图片</h3>
            <span style={{ marginLeft: '10px' }}>
              {showRecentImages ? '▲' : '▼'}
            </span>
          </div>
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
                    onClick={() => setImage(img)}
                  />
                ))}
              </div>
              {recentImages.length === 0 && (
                <div style={{ color: '#666', marginTop: '10px' }}>
                  暂无最近打开的图片
                </div>
              )}
              <div style={{ marginTop: '10px' }}>
                <input type="file" accept="image/*" onChange={handleImageUpload} />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="image-container" style={{ display: image ? 'block' : 'none' }}>
        <div style={{ position: 'relative' }} ref={imageRef}>
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

      {selectedCharacter && (
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
                onClick={(e) => {
                  if (!selectedCharacter) {
                    console.log('selectedCharacter is null');
                    return;
                  }
                  
                  // 直接更新viewBox的y坐标，减少一个字符高度
                  const newViewBoxY = selectedCharacter.viewBox.y - selectedCharacter.viewBox.height;
                  
                  setSelectedCharacter(prev => ({
                    ...prev,
                    viewBox: {
                      ...prev.viewBox,
                      y: newViewBoxY
                    }
                  }));
                  
                  // 更新最后点击位置
                  setLastClickPosition(prev => ({
                    x: prev.x,
                    y: prev.y - charHeightRef.current
                  }));
                }}
              >
                上一个
              </button>
              <button
                style={{ padding: '8px 16px' }}
                onClick={(e) => {
                  if (!selectedCharacter) {
                    console.log('selectedCharacter is null');
                    return;
                  }
                  
                  // 直接更新viewBox的y坐标，增加一个字符高度
                  const newViewBoxY = selectedCharacter.viewBox.y + selectedCharacter.viewBox.height;
                  
                  setSelectedCharacter(prev => ({
                    ...prev,
                    viewBox: {
                      ...prev.viewBox,
                      y: newViewBoxY
                    }
                  }));
                  
                  // 更新最后点击位置
                  setLastClickPosition(prev => ({
                    x: prev.x,
                    y: prev.y + charHeightRef.current
                  }));
                }}
              >
                下一个
              </button>
            </div>
            <button 
              style={{ marginTop: '10px', padding: '8px 16px' }}
              onClick={() => setSelectedCharacter(null)}
            >
              返回完整图片
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
