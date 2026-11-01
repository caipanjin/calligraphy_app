import React, { useState, useEffect } from 'react';
import { preprocessImage, recognizeText, groupWordsByLine, mapBboxToSource } from '../utils/ocr';

const OCRResults = ({ image, onSelectCharacter, onClose }) => {
  const [ocrResult, setOcrResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!image) return;

    let isCancelled = false;

    const runOCR = async () => {
      try {
        setLoading(true);
        setError(null);
        setProgress(0);

        const img = new Image();
        img.src = image;
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () => reject(new Error('图片加载失败'));
        });

        if (!isCancelled) {
          setImageSize({
            width: img.naturalWidth || img.width,
            height: img.naturalHeight || img.height
          });
        }

        const { dataUrl, scale } = await preprocessImage(image);
        
        if (isCancelled) return;

        const result = await recognizeText(dataUrl, (p) => {
          if (!isCancelled) setProgress(p);
        });

        if (isCancelled) return;

        if (result.words && result.words.length > 0) {
          // 识别是在缩放后的预处理图上做的，bbox 需要回算到原图坐标系
          const words = result.words.map((word) => ({
            ...word,
            bbox: mapBboxToSource(word.bbox, scale)
          }));
          const lines = groupWordsByLine(words, scale > 0 ? 20 / scale : 20);
          setOcrResult({ words, lines, text: result.text });
        } else {
          setError('未识别到文字，请手动选择字符');
        }
      } catch (err) {
        if (!isCancelled) {
          setError('识别失败，请手动选择字符');
          console.error('OCR Error:', err);
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    runOCR();

    return () => {
      isCancelled = true;
    };
  }, [image]);

  const handleWordClick = (word) => {
    const { bbox } = word;
    const padding = 10;
    const imageWidth = imageSize.width;
    const imageHeight = imageSize.height;

    const x = Math.max(0, bbox.x0 - padding);
    const y = Math.max(0, bbox.y0 - padding);

    onSelectCharacter({
      src: image,
      width: imageWidth,
      height: imageHeight,
      viewBox: {
        x,
        y,
        width: Math.min(imageWidth - x, bbox.x1 - bbox.x0 + padding * 2),
        height: Math.min(imageHeight - y, bbox.y1 - bbox.y0 + padding * 2)
      }
    });
  };

  if (loading) {
    return (
      <div className="ocr-results">
        <div className="ocr-header">
          <h3>文字识别中...</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="ocr-loading">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }}></div>
          </div>
          <p>{progress}%</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ocr-results">
        <div className="ocr-header">
          <h3>文字识别</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="ocr-error">
          <p>{error}</p>
          <button className="manual-btn" onClick={onClose}>
            手动选择字符
          </button>
        </div>
      </div>
    );
  }

  if (!ocrResult) return null;

  return (
    <div className="ocr-results">
      <div className="ocr-header">
        <h3>识别结果 ({ocrResult.words.length} 个文字)</h3>
        <button className="close-btn" onClick={onClose}>×</button>
      </div>
      
      <div className="ocr-content">
        <div className="ocr-preview">
          <img src={image} alt="OCR Preview" />
          {ocrResult.words.map((word, index) => (
            <div
              key={index}
              className="ocr-bounding-box"
              style={{
                left: `${(word.bbox.x0 / imageSize.width) * 100}%`,
                top: `${(word.bbox.y0 / imageSize.height) * 100}%`,
                width: `${((word.bbox.x1 - word.bbox.x0) / imageSize.width) * 100}%`,
                height: `${((word.bbox.y1 - word.bbox.y0) / imageSize.height) * 100}%`
              }}
              onClick={() => handleWordClick(word)}
              title={word.text}
            >
              <span className="ocr-word-label">{word.text}</span>
            </div>
          ))}
        </div>
        
        <div className="ocr-words-list">
          {ocrResult.lines.map((line, lineIndex) => (
            <div key={lineIndex} className="ocr-line">
              {line.words.map((word, wordIndex) => (
                <span
                  key={wordIndex}
                  className="ocr-word"
                  onClick={() => handleWordClick(word)}
                >
                  {word.text}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default OCRResults;