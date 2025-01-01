import React, { useState, useRef } from 'react'
import { Magnifier } from 'react-image-magnifiers'
import Tesseract from 'tesseract.js'
import './index.css'

    const App = () => {
      const [image, setImage] = useState(null)
      const [selectedCharacter, setSelectedCharacter] = useState(null)
  const [recognizedText, setRecognizedText] = useState('')
      const imageRef = useRef(null)

      const handleImageUpload = (e) => {
        const file = e.target.files[0]
        if (file) {
          const reader = new FileReader()
          reader.onload = (e) => {
            setImage(e.target.result)
          }
          reader.readAsDataURL(file)
        }
      }

      const handleCharacterClick = async (e) => {
        try {
          if (!image) {
            console.log('No image loaded')
            return
          }

          console.log('Character click event:', e)
          const imgRect = imageRef.current.getBoundingClientRect()
          console.log('Image rect:', imgRect)
          const clickX = e.clientX - imgRect.left
          const clickY = e.clientY - imgRect.top
          console.log('Click coordinates:', {clickX, clickY})

          // Calculate character size based on image dimensions
          const charAspectRatio = 1.1 // height/width ratio
          const charWidth = imgRect.width * 0.25
          const charHeight = charWidth * charAspectRatio
          
          // Adjust click position to center the character
          const x = Math.max(0, (clickX - charWidth/2) / imgRect.width * 100)
          const y = Math.max(0, (clickY - charHeight/2) / imgRect.height * 100)
          const width = (charWidth / imgRect.width) * 100
          const height = (charHeight / imgRect.height) * 100

          // Add some padding around the character
          const padding = 5

          // Create a canvas to crop the selected character
          const canvas = document.createElement('canvas')
          const ctx = canvas.getContext('2d')
          const img = new Image()
          img.onload = () => {
            canvas.width = charWidth
            canvas.height = charHeight
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
            )

            const dataURL = canvas.toDataURL()
            console.log('Cropped character data:', {
              src: dataURL,
              width: charWidth,
              height: charHeight
            })
            setSelectedCharacter({
              src: dataURL,
              width: charWidth,
              height: charHeight
            })

            // 使用Tesseract.js进行文字识别
            Tesseract.recognize(
              dataURL,
              'chi_sim', // 使用简体中文模型
              {
                logger: m => console.log(m)
              }
            ).then(({ data: { text } }) => {
              console.log('Recognized text:', text)
              setRecognizedText(text.trim())
            })
          }
          img.src = image

          // Wait for image to load
          if (!img.complete) {
            console.log('Waiting for image to load...')
            img.onload = () => handleCharacterClick(e)
            return
          }
        } catch (error) {
          console.error('Error handling character click:', error)
        }

        // Create a canvas to crop the selected character
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        const img = new Image()
        img.onload = () => {
          canvas.width = charWidth
          canvas.height = charHeight
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
          )

          const dataURL = canvas.toDataURL()
          console.log('Cropped character data:', {
            src: dataURL,
            width: charWidth,
            height: charHeight
          })
          setSelectedCharacter({
            src: dataURL,
            width: charWidth,
            height: charHeight
          })

          // 使用Tesseract.js进行文字识别
          Tesseract.recognize(
            dataURL,
            'chi_sim', // 使用简体中文模型
            {
              logger: m => console.log(m)
            }
          ).then(({ data: { text } }) => {
            console.log('Recognized text:', text)
            setRecognizedText(text.trim())
          })
        }
        img.src = image

        // Wait for image to load
        if (!img.complete) {
          console.log('Waiting for image to load...')
          img.onload = () => handleCharacterClick(e)
          return
        }
      }

      return (
        <div className="container">
          <h1>Calligraphy App</h1>
          <input type="file" accept="image/*" onChange={handleImageUpload} />
          
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
                  backgroundColor: 'rgba(255,0,0,0.3)'
                }}
                onClick={(e) => {
                  console.log('Overlay click event:', e)
                  handleCharacterClick(e)
                }}
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
                <h3>识别结果：</h3>
                <p style={{ 
                  fontSize: '2em',
                  fontWeight: 'bold',
                  color: '#333',
                  margin: '10px 0'
                }}>
                  {recognizedText}
                </p>
                <button 
                  style={{ marginTop: '10px' }}
                  onClick={() => setSelectedCharacter(null)}
                >
                  返回完整图片
                </button>
              </div>
            </div>
          )}
        </div>
      )
    }

    export default App
