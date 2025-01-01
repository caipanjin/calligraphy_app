import React, { useState, useRef } from 'react';
import { Magnifier } from 'react-image-magnifiers';
import Tesseract from 'tesseract.js';
import './index.css';

const App = () => {
  const [image, setImage] = useState(() => {
    const savedImage = localStorage.getItem('recentImage');
    return savedImage ? savedImage : null;
  });
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const [characters, setCharacters] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [recentImages, setRecentImages] = useState(() => {
    const savedImages = localStorage.getItem('recentImages');
    return savedImages ? JSON.parse(savedImages) : [];
  });
  const [showRecentImages, setShowRecentImages] = useState(false);
  const imageRef = useRef(null);

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const imageData = e.target.result;
        setImage(imageData);
        localStorage.setItem('recentImage', imageData);
        const updatedImages = [imageData, ...recentImages.filter(img => img !== imageData)].slice(0, 5);
        setRecentImages(updatedImages);
        localStorage.setItem('recentImages', JSON.stringify(updatedImages));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCharacterClick = async (e) => {
    try {
      if (!image) {
        console.log('No image loaded');
        return;
      }

      const imgRect = imageRef.current.getBoundingClientRect();
      const clickX = e.clientX - imgRect.left;
      const clickY = e.clientY - imgRect.top;

      const charAspectRatio = 1.1;
      const charWidth = imgRect.width * 0.25;
      const charHeight = charWidth * charAspectRatio;

      const x = Math.max(0, (clickX - charWidth/2) / imgRect.width * 100);
      const y = Math.max(0, (clickY - charHeight/2) / imgRect.height * 100);
      const width = (charWidth / imgRect.width) * 100;
      const height = (charHeight / imgRect.height) * 100;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.onload = () => {
        canvas.width = charWidth;
        canvas.height = charHeight;
        ctx.drawImage(
          img,
          (x / 100) * img.width,
          (y / 100) * img.height,
          (width / 100) * img.width,
          (height / 100) * img.height,
          0,
          0,
          charWidth,
          charHeight
        );

        const dataURL = canvas.toDataURL();
        setSelectedCharacter({
          src: dataURL,
          width: charWidth,
          height: charHeight
        });

        Tesseract.recognize(
          dataURL,
          'chi_sim',
          {
            logger: m => console.log(m)
          }
        ).then(({ data: { text } }) => {
          console.log('Recognized text:', text);
          setCharacters(prev => [...prev, {
            src: dataURL,
            width: charWidth,
            height: charHeight,
            text: text
          }]);
          setCurrentIndex(characters.length);
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
        {recentImages.length > 0 && (
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
            )}
          </div>
        )}
        <input type="file" accept="image/*" onChange={handleImageUpload} />
      </div>

      {image && !selectedCharacter && (
        <div className="image-container">
          <div ref={imageRef}>
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
          <h2>Selected Character</h2>
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
                onClick={() => {
                  if (currentIndex > 0) {
                    setCurrentIndex(prev => prev - 1);
                    setSelectedCharacter(characters[currentIndex - 1]);
                  }
                }}
              >
                上一个
              </button>
              <button
                style={{ padding: '8px 16px' }}
                onClick={() => {
                  if (currentIndex < characters.length - 1) {
                    setCurrentIndex(prev => prev + 1);
                    setSelectedCharacter(characters[currentIndex + 1]);
                  }
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
