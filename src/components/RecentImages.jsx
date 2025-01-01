import React, { useState } from 'react';

const RecentImages = ({ recentImages, image, setImage, handleImageUpload, setSelectedCharacter }) => {
  const [showRecentImages, setShowRecentImages] = useState(false);

  return (
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
                  onClick={() => {
                    setImage(img);
                    setSelectedCharacter(null);
                  }}
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
  );
};

export default RecentImages;
