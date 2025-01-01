import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Magnifier } from 'react-image-magnifiers';
import './index.css';
import RecentImages from './components/RecentImages';
import ImageViewer from './components/ImageViewer';
import CharacterSelector from './components/CharacterSelector';

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
          const imageData = `data:image/jpeg;base64,${base64Data}`;
          setImage(imageData);
          
          try {
            localStorage.setItem('recentImage', imageData);
          } catch (error) {
            return;
          }

          const currentRecentImages = recentImages.filter(img => img !== imageData);
          const updatedImages = [imageData, ...currentRecentImages].slice(0, 3);
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
      <RecentImages 
        recentImages={recentImages}
        image={image}
        setImage={setImage}
        handleImageUpload={handleImageUpload}
        setSelectedCharacter={setSelectedCharacter}
      />

      <ImageViewer 
        image={image}
        handleCharacterClick={handleCharacterClick}
        imageRef={imageRef}
        selectedCharacter={selectedCharacter}
      />

      {selectedCharacter && (
        <CharacterSelector
          selectedCharacter={selectedCharacter}
          setSelectedCharacter={setSelectedCharacter}
          charHeightRef={charHeightRef}
        />
      )}
    </div>
  );
};

export default App;
