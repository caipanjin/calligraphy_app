import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Magnifier } from 'react-image-magnifiers';
import Tesseract from 'tesseract.js';
import './index.css';

const App = () => {
  const [image, setImage] = useState(() => {
    const savedImage = localStorage.getItem('recentImage');
    return savedImage ? savedImage : null;
  });
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const [lastClickPosition, setLastClickPosition] = useState({ x: 0, y: 0 });
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

      const charAspectRatio = 1.1;
      const charWidth = imgRect.width * 0.25;
      charHeightRef.current = charWidth * charAspectRatio;

      const x = Math.max(0, (clickX - charWidth/2) / imgRect.width * 100);
      const y = Math.max(0, (clickY - charHeightRef.current/2) / imgRect.height * 100);
      const width = (charWidth / imgRect.width) * 100;
      const height = (charHeightRef.current / imgRect.height) * 100;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.onload = () => {
        canvas.width = charWidth;
        canvas.height = charHeightRef.current;
        ctx.drawImage(
          img,
          (x / 100) * img.width,
          (y / 100) * img.height,
          (width / 100) * img.width,
          (height / 100) * img.height,
          0,
          0,
          charWidth,
          charHeightRef.current
        );

        const dataURL = canvas.toDataURL();
        setSelectedCharacter({
          src: dataURL,
          width: charWidth,
          height: charHeightRef.current
        });

        Tesseract.recognize(
          dataURL,
          'chi_sim',
          {
            logger: m => console.log(m)
          }
        ).then(({ data: { text } }) => {
          console.log('Recognized text:', text);
          setLastClickPosition({ x: clickX, y: clickY });
        });
      };
      img.src = image;

      if (!img.complete) {
        img.onload = () => handleCharacterClick(e);
        return;
      }
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

      {image && !selectedCharacter && (
        <div className="image-container">
          <div style={{ position: 'relative' }} ref={imageRef}>
            <Magnifier
              imageSrc={image}
              largeImageSrc={image}
              imageAlt="Calligraphy"
              style={{ width: '100%', height: 'auto' }}
            />
          </div>
          
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              cursor: 'crosshair',
              backgroundColor: 'rgba(255,255,255,0)'
            }}
            onClick={handleCharacterClick}
          />
        </div>
      )}

      {selectedCharacter && (
        <div style={{ marginTop: '20px' }}>
          <div style={{ 
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '300px',
            width: '300px',
            margin: '0 auto',
            border: '1px solid #ccc',
            borderRadius: '8px',
            overflow: 'hidden'
          }}>
            <img
              src={selectedCharacter.src}
              alt="Selected Character"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain'
              }}
            />
          </div>
          <div style={{ marginTop: '20px', textAlign: 'center' }}>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                style={{ padding: '8px 16px' }}
                onClick={(e) => {
                  const currentImageRef = getImageRef();
                  if (!currentImageRef) {
                    console.log('imageRef is null');
                    return;
                  }
                  if (!selectedCharacter) {
                    console.log('selectedCharacter is null');
                    return;
                  }
                  const rect = currentImageRef.getBoundingClientRect();
                  console.log('Last click position:', lastClickPosition);
                  console.log('Character height:', charHeightRef.current);
                  const newY = lastClickPosition.y - charHeightRef.current;
                  console.log('New click position:', {
                    x: lastClickPosition.x + rect.left,
                    y: newY + rect.top
                  });
                  handleCharacterClick({
                    ...e,
                    clientX: lastClickPosition.x + rect.left,
                    clientY: newY + rect.top
                  });
                }}
              >
                上一个
              </button>
              <button
                style={{ padding: '8px 16px' }}
                onClick={(e) => {
                  const currentImageRef = getImageRef();
                  if (!currentImageRef) {
                    console.log('imageRef is null');
                    return;
                  }
                  if (!selectedCharacter) {
                    console.log('selectedCharacter is null');
                    return;
                  }
                  const rect = currentImageRef.getBoundingClientRect();
                  console.log('Last click position:', lastClickPosition);
                  console.log('Character height:', charHeightRef.current);
                  const newY = lastClickPosition.y + charHeightRef.current;
                  console.log('New click position:', {
                    x: lastClickPosition.x + rect.left,
                    y: newY + rect.top
                  });
                  handleCharacterClick({
                    ...e,
                    clientX: lastClickPosition.x + rect.left,
                    clientY: newY + rect.top
                  });
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
