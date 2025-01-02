// 导入 React 核心库和常用钩子
import React, { useState, useRef, useEffect, useCallback } from 'react';
// 导入图片放大组件
import { Magnifier } from 'react-image-magnifiers';
// 导入样式文件
import './index.css';
// 导入自定义组件
import RecentImages from './components/RecentImages';
import ImageViewer from './components/ImageViewer';
import CharacterSelector from './components/CharacterSelector';

const App = () => {
  // 当前显示的图片数据URL，从localStorage初始化
  const [image, setImage] = useState(() => {
    const savedImage = localStorage.getItem('recentImage');
    return savedImage ? savedImage : null;
  });
  
  // 当前选中的字符信息
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  
  // 最后一次点击的位置坐标
  const [lastClickPosition, setLastClickPosition] = useState({ x: 0, y: 0 });
  
  // 是否正在拖动
  const [isDragging, setIsDragging] = useState(false);
  
  // 拖动开始的位置
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  
  // 字符高度引用，用于跨组件共享
  const charHeightRef = useRef(0);
  
  // 最近查看的图片列表，从localStorage初始化
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

  // 当recentImages变化时，自动保存到localStorage
  useEffect(() => {
    try {
      localStorage.setItem('recentImages', JSON.stringify(recentImages));
    } catch (error) {}
  }, [recentImages]);
  
  // 是否显示最近图片列表
  const [showRecentImages, setShowRecentImages] = useState(false);
  
  // 图片元素的引用
  const imageRef = useRef(null);
  
  // 获取图片引用的回调函数
  const getImageRef = useCallback(() => imageRef.current, []);

  // 处理图片上传
  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (file) {
      // 检查文件类型是否为图片
      if (!file.type.startsWith('image/')) {
        return;
      }

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          // 将图片转换为base64格式
          const base64Data = e.target.result.split(',')[1];
          const imageData = `data:image/jpeg;base64,${base64Data}`;
          setImage(imageData);
          
          // 保存当前图片到localStorage
          try {
            localStorage.setItem('recentImage', imageData);
          } catch (error) {
            return;
          }

          // 更新最近图片列表，保留最多3张
          const currentRecentImages = recentImages.filter(img => img !== imageData);
          const updatedImages = [imageData, ...currentRecentImages].slice(0, 3);
          setRecentImages(updatedImages);
          
          // 保存更新后的最近图片列表到localStorage
          try {
            localStorage.setItem('recentImages', JSON.stringify(updatedImages));
          } catch (error) {}

          // 显示最近图片列表
          setShowRecentImages(true);
        } catch (error) {}
      };
      reader.onerror = () => {};
      reader.readAsDataURL(file);
    }
  };

  // 处理图片点击事件，用于选择字符
  const handleCharacterClick = async (e) => {
    try {
      const currentImageRef = getImageRef();
      if (!image || !currentImageRef) {
        return;
      }

      // 获取点击位置相对于图片的坐标
      const imgRect = currentImageRef.getBoundingClientRect();
      const clickX = e.clientX - imgRect.left;
      const clickY = e.clientY - imgRect.top;

      // 计算图片的实际尺寸
      const naturalWidth = currentImageRef.naturalWidth > 0 ? currentImageRef.naturalWidth : imgRect.width;
      const naturalHeight = currentImageRef.naturalHeight > 0 ? currentImageRef.naturalHeight : imgRect.height;
      const effectiveHeight = imgRect.height > 0 ? imgRect.height : naturalHeight;
      const effectiveWidth = imgRect.width > 0 ? imgRect.width : naturalWidth;

      // 计算字符选择框的尺寸
      const charAspectRatio = 1.1;
      const charWidth = effectiveWidth * 0.25;
      charHeightRef.current = charWidth * charAspectRatio;
      const minCharHeight = effectiveHeight * 0.1;
      if (charHeightRef.current < minCharHeight) {
        charHeightRef.current = minCharHeight;
      }

      // 检查图片尺寸是否有效
      if (effectiveWidth === 0 || effectiveHeight === 0) {
        return;
      }

      // 计算缩放比例
      const scaleX = naturalWidth / imgRect.width;
      const scaleY = naturalHeight / imgRect.height;
      
      // 计算字符选择框的视图坐标
      const viewBoxX = (clickX - charWidth/2) * scaleX;
      const viewBoxY = (clickY - charHeightRef.current/2) * scaleY;
      const viewBoxWidth = charWidth * scaleX;
      const viewBoxHeight = charHeightRef.current * scaleY;

      // 检查计算结果是否有效
      if (isNaN(viewBoxX) || isNaN(viewBoxY) || isNaN(viewBoxWidth) || isNaN(viewBoxHeight)) {
        return;
      }

      // 设置选中的字符信息
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

      // 保存点击位置
      setLastClickPosition({ x: clickX, y: clickY });
    } catch (error) {}
  };

  return (
    <div className="container">
      <h2>书法临摹助手</h2>
      
      {/* 最近图片列表组件 */}
      <RecentImages 
        recentImages={recentImages}
        image={image}
        setImage={setImage}
        handleImageUpload={handleImageUpload}
        setSelectedCharacter={setSelectedCharacter}
      />

      {/* 图片查看器组件 */}
      <ImageViewer 
        image={image}
        handleCharacterClick={handleCharacterClick}
        imageRef={imageRef}
        selectedCharacter={selectedCharacter}
      />

      {/* 字符选择器组件 */}
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
