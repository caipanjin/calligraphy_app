import React from 'react';
import { Magnifier } from 'react-image-magnifiers';

const ImageViewer = ({ image, handleCharacterClick, imageRef, selectedCharacter }) => {
  return (
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
  );
};

export default ImageViewer;
