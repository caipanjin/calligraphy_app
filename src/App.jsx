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
  // 初始化IndexedDB
  const [db, setDb] = useState(null);

  useEffect(() => {
    // 检查IndexedDB是否可用
    if (!('indexedDB' in window)) {
      console.error('IndexedDB is not supported');
      return;
    }

    const request = indexedDB.open('calligraphyImages', 1);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      try {
        if (!db.objectStoreNames.contains('images')) {
          db.createObjectStore('images', { keyPath: 'id' });
        }
      } catch (error) {
        console.error('IndexedDB upgrade error:', error);
      }
    };

    request.onsuccess = (event) => {
      try {
        setDb(event.target.result);
      } catch (error) {
        console.error('IndexedDB connection error:', error);
      }
    };

    request.onerror = (event) => {
      console.error('IndexedDB error:', event.target.error);
      // 尝试重新连接
      setTimeout(() => {
        const retryRequest = indexedDB.open('calligraphyImages', 1);
        retryRequest.onsuccess = (e) => setDb(e.target.result);
      }, 1000);
    };

    // 处理数据库关闭
    request.onblocked = () => {
      console.warn('IndexedDB connection blocked');
    };
  }, []);

  // 当前显示的图片数据URL，从IndexedDB初始化
  const [image, setImage] = useState(null);

  useEffect(() => {
    if (db) {
      const transaction = db.transaction('images', 'readonly');
      const store = transaction.objectStore('images');
      const request = store.get('current');
      
      request.onsuccess = () => {
        if (request.result) {
          setImage(request.result.url);
          // 更新最近图片列表
          const recentRequest = store.getAll();
          recentRequest.onsuccess = () => {
            const images = recentRequest.result
              .filter(img => img.id !== 'current')
              .map(img => img.url);
            setRecentImages(images);
          };
        }
      };
    }
  }, [db]);

  // 删除图片
  const deleteImage = async (index) => {
    // 先更新UI状态
    const newImages = [...recentImages];
    newImages.splice(index, 1);
    // 确保数组中没有undefined或null值
    const filteredImages = newImages.filter(img => img);
    setRecentImages(filteredImages);

    if (db) {
      const transaction = db.transaction('images', 'readwrite');
      const store = transaction.objectStore('images');
      
      // 删除对应的图片记录
      store.delete(`recent_${index}`);
      
      // 如果还有图片，重新索引
      if (filteredImages.length > 0) {
        // 删除所有旧的recent_*记录
        const clearRequest = store.getAllKeys();
        clearRequest.onsuccess = () => {
          clearRequest.result
            .filter(key => key.startsWith('recent_'))
            .forEach(key => store.delete(key));
            
          // 重新保存更新后的图片列表
          filteredImages.forEach((url, newIndex) => {
            if (url) { // 确保url存在
              store.put({ id: `recent_${newIndex}`, url });
            }
          });
        };
      } else {
        // 如果没有图片了，清除所有recent_*记录
        const clearRequest = store.getAllKeys();
        clearRequest.onsuccess = () => {
          clearRequest.result
            .filter(key => key.startsWith('recent_'))
            .forEach(key => store.delete(key));
        };
      }
    }
  };

  // 自定义setImage，在设置图片时更新最近图片列表
  const setImageWithRecent = async (imageData) => {
    setImage(imageData);
    
    if (db) {
      const transaction = db.transaction('images', 'readwrite');
      const store = transaction.objectStore('images');
      
      // 保存当前图片
      store.put({ id: 'current', url: imageData });
      
      // 更新最近图片列表
      const recentRequest = store.getAll();
      recentRequest.onsuccess = () => {
        const images = recentRequest.result
          .filter(img => img.id !== 'current')
          .map(img => img.url);
        
        // 如果图片已存在，保持原有顺序；如果不存在，添加到开头
        const existingIndex = images.indexOf(imageData);
        const updatedImages = existingIndex >= 0 ? images : [imageData, ...images].slice(0, 5);
        setRecentImages(updatedImages);
        
        // 保存最近图片列表
        updatedImages.forEach((url, index) => {
          store.put({ id: `recent_${index}`, url });
        });
      };
    }

    // 显示最近图片列表
    setShowRecentImages(true);
  };
  
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
  
  // 最近查看的图片列表
  const [recentImages, setRecentImages] = useState([]);
  
  // 是否显示最近图片列表
  const [showRecentImages, setShowRecentImages] = useState(false);
  
  // 图片元素的引用
  const imageRef = useRef(null);
  
  // 获取图片引用的回调函数
  const getImageRef = useCallback(() => imageRef.current, []);

  // 处理图片上传
  const handleImageUpload = async (e) => {
    try {
      const files = Array.from(e.target.files);
      if (files.length === 0) return;

      if (files.length > 5) {
        alert('一次最多只能上传5个文件');
        return;
      }

      // 检查文件类型是否为支持的图片格式
      const supportedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      const validFiles = files.filter(file => supportedTypes.includes(file.type));
      
      if (validFiles.length === 0) {
        alert('请选择支持的图片格式（JPEG、PNG、GIF或WebP）');
        return;
      }

      // 批量处理所有有效文件
      const uploadPromises = validFiles.map(file => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          
          reader.onload = async (e) => {
            try {
              const base64Data = e.target.result.split(',')[1];
              const imageData = `data:${file.type};base64,${base64Data}`;
              
              if (!base64Data || base64Data.length < 100) {
                throw new Error('Invalid image data');
              }
              
              await setImageWithRecent(imageData);
              resolve(imageData);
            } catch (error) {
              console.error(`${file.name} 处理失败:`, error);
              reject(error);
            }
          };

          reader.onerror = (error) => {
            console.error(`${file.name} 读取错误:`, error);
            reject(error);
          };

          reader.onabort = () => {
            console.warn(`${file.name} 读取中止`);
            reject(new Error('读取中止'));
          };

          reader.readAsDataURL(file);
        });
      });

      // 等待所有文件上传完成
      const results = await Promise.allSettled(uploadPromises);
      
      setSelectedCharacter(null);
    } catch (error) {
      console.error('文件上传错误:', error);
      alert('文件上传失败，请检查文件后重试');
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
      const charAspectRatio = 1;
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
        setImage={setImageWithRecent}
        handleImageUpload={handleImageUpload}
        setSelectedCharacter={setSelectedCharacter}
        deleteImage={deleteImage}
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
