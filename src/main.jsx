// 导入 React 核心库
import React from 'react'
// 导入 ReactDOM 客户端渲染库
import ReactDOM from 'react-dom/client'
// 导入主应用组件
import App from './App.jsx'
// 导入全局样式
import './index.css'

// 创建 React 根节点并渲染应用
ReactDOM.createRoot(document.getElementById('root')).render(
  // 使用严格模式帮助发现潜在问题
  <React.StrictMode>
    {/* 渲染主应用组件 */}
    <App />
  </React.StrictMode>
)
