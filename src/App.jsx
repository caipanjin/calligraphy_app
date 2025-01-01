import React, { useState, useRef, useEffect, useCallback } from 'react';
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
  const [recentImages, setRecentImages] = useState(() => {
    try {
      const savedImages = localStorage.getItem('recentImages');
      if (savedImages) {
        return JSON.parse(savedImages);
      }
      return [];
    } catch (error) {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('recentImages', JSON.stringify(recentImages));
    } catch (error) {}
  }, [recentImages]);
  
  const [showRecentImages, setShowRecentImages] = useState(false);
  const imageRef = useRef(null);
  const getImageRef = useCallback(() => imageRef.current, []);

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        return;
      }

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const base64Data = e.target.result.split(',')[1];
          const blob = await fetch(`data:image/jpeg;base64,${base64Data}`)
            .then(res => res.blob());
          
          const imageUrl = URL.createObjectURL(blob);
          setImage(imageUrl);
          
          try {
            localStorage.setItem('recentImage', imageUrl);
          } catch (error) {
            return;
          }

          const currentRecentImages = recentImages.filter(img => img !== imageUrl);
          const updatedImages = [imageUrl, ...currentRecentImages].slice(0, 3);
          setRecentImages(updatedImages);
          
          try {
            localStorage.setItem('recentImages', JSON.stringify(updatedImages));
          } catch (error) {}

          setShowRecentImages(true);
        } catch (error) {}
      };
      reader.onerror = () => {};
      reader.readAsDataURL(file);
    }
  };

  const handleCharacterClick = async (e) => {
    try {
      const currentImageRef = getImageRef();
      if (!image || !currentImageRef) {
        return;
      }

      const imgRect = currentImageRef.getBoundingClientRect();
      const clickX = e.clientX - imgRect.left;
      const clickY = e.clientY - imgRect.top;

      const naturalWidth = currentImageRef.naturalWidth > 0 ? currentImageRef.naturalWidth : imgRect.width;
      const naturalHeight = currentImageRef.naturalHeight > 0 ? currentImageRef.naturalHeight : imgRect.height;
      const effectiveHeight = imgRect.height > 0 ? imgRect.height : naturalHeight;
      const effectiveWidth = imgRect.width > 0 ? imgRect.width : naturalWidth;

      const charAspectRatio = 1.1;
      const charWidth = effectiveWidth * 0.25;
      charHeightRef.current = charWidth * charAspectRatio;
      const minCharHeight = effectiveHeight * 0.1;
      if (charHeightRef.current < minCharHeight) {
        charHeightRef.current = minCharHeight;
      }

      if (effectiveWidth === 0 || effectiveHeight === 0) {
        return;
      }

      const scaleX = naturalWidth / imgRect.width;
      const scaleY = naturalHeight / imgRect.height;
      const viewBoxX = (clickX - charWidth/2) * scaleX;
      const viewBoxY = (clickY - charHeightRef.current/2) * scaleY;
      const viewBoxWidth = charWidth * scaleX;
      const viewBoxHeight = charHeightRef.current * scaleY;

      if (isNaN(viewBoxX) || isNaN(viewBoxY) || isNaN(viewBoxWidth) || isNaN(viewBoxHeight)) {
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
    } catch (error) {}
  };

  return (
    <div className="container">
      <h2>书法临摹助手</h2>
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
            <h3 style={{ margin: 0 }}>最近图片</h3>
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
                    return;
                  }
                  
                  const newViewBoxY = selectedCharacter.viewBox.y - selectedCharacter.viewBox.height;
                  setSelectedCharacter(prev => ({
                    ...prev,
                    viewBox: {
                      ...prev.viewBox,
                      y: newViewBoxY
                    }
                  }));
                  
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
                    return;
                  }
                  
                  const newViewBoxY = selectedCharacter.viewBox.y + selectedCharacter.viewBox.height;
                  setSelectedCharacter(prev => ({
                    ...prev,
                    viewBox: {
                      ...prev.viewBox,
                      y: newViewBoxY
                    }
                  }));
                  
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
