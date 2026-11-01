import Tesseract from 'tesseract.js';

export const preprocessImage = (imageData) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      const maxSize = 2000;
      const sourceWidth = img.naturalWidth || img.width;
      const sourceHeight = img.naturalHeight || img.height;
      let width = sourceWidth;
      let height = sourceHeight;
      
      if (width > maxSize || height > maxSize) {
        if (width > height) {
          height = Math.round((height / width) * maxSize);
          width = maxSize;
        } else {
          width = Math.round((width / height) * maxSize);
          height = maxSize;
        }
      }
      
      // 预处理图相对原图的缩放比，识别结果的 bbox 需按它回算到原图坐标系
      const scale = sourceWidth > 0 ? width / sourceWidth : 1;
      
      canvas.width = width;
      canvas.height = height;
      
      ctx.drawImage(img, 0, 0, width, height);
      
      const imageDataObj = ctx.getImageData(0, 0, width, height);
      const data = imageDataObj.data;
      
      for (let i = 0; i < data.length; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        data[i] = gray;
        data[i + 1] = gray;
        data[i + 2] = gray;
      }
      
      ctx.putImageData(imageDataObj, 0, 0);
      
      const grayData = ctx.getImageData(0, 0, width, height);
      
      // 逐像素求极值：Math.min(...arr) 在百万级数组上会抛 RangeError（爆栈）
      let minVal = 255;
      let maxVal = 0;
      for (let i = 0; i < grayData.data.length; i += 4) {
        const v = grayData.data[i];
        if (v < minVal) minVal = v;
        if (v > maxVal) maxVal = v;
      }
      
      const range = maxVal - minVal;
      
      if (range > 0) {
        for (let i = 0; i < grayData.data.length; i += 4) {
          const normalized = (grayData.data[i] - minVal) / range;
          const enhanced = Math.pow(normalized, 1.5) * 255;
          grayData.data[i] = enhanced;
          grayData.data[i + 1] = enhanced;
          grayData.data[i + 2] = enhanced;
        }
      }
      
      ctx.putImageData(grayData, 0, 0);
      
      resolve({
        dataUrl: canvas.toDataURL('image/jpeg', 0.9),
        scale,
        width,
        height
      });
    };
    
    img.onerror = () => reject(new Error('图片加载失败，无法进行预处理'));
    img.src = imageData;
  });
};

// 将预处理图坐标系下的 bbox 映射回原图坐标系
export const mapBboxToSource = (bbox, scale) => {
  const ratio = scale > 0 ? 1 / scale : 1;
  return {
    x0: Math.round(bbox.x0 * ratio),
    y0: Math.round(bbox.y0 * ratio),
    x1: Math.round(bbox.x1 * ratio),
    y1: Math.round(bbox.y1 * ratio)
  };
};

export const recognizeText = (imageData, onProgress) => {
  return new Promise((resolve, reject) => {
    Tesseract.recognize(
      imageData,
      'chi_sim+eng',
      {
        logger: m => {
          if (onProgress && m.status === 'recognizing text') {
            onProgress(Math.round(m.progress * 100));
          }
        }
      }
    )
    .then(({ data: { words, text } }) => {
      if (!words || words.length === 0) {
        resolve({ words: [], text: '' });
        return;
      }
      
      const processedWords = words
        .filter(word => word.text.trim().length > 0)
        .map(word => ({
          text: word.text,
          bbox: {
            x0: word.bbox.x0,
            y0: word.bbox.y0,
            x1: word.bbox.x1,
            y1: word.bbox.y1
          },
          confidence: word.confidence
        }));
      
      resolve({
        words: processedWords,
        text: text.trim()
      });
    })
    .catch(reject);
  });
};

export const groupWordsByLine = (words, yThreshold = 20) => {
  const lines = [];
  const sortedWords = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0);
  
  for (const word of sortedWords) {
    let addedToLine = false;
    
    for (const line of lines) {
      const lineY = line.avgY;
      const wordY = word.bbox.y0;
      
      if (Math.abs(lineY - wordY) < yThreshold) {
        line.words.push(word);
        line.avgY = (line.avgY * (line.words.length - 1) + wordY) / line.words.length;
        addedToLine = true;
        break;
      }
    }
    
    if (!addedToLine) {
      lines.push({
        words: [word],
        avgY: word.bbox.y0
      });
    }
  }
  
  return lines.sort((a, b) => a.avgY - b.avgY);
};