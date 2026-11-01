import React from 'react';

/** 轻提示：替代 alert，自动消失 */
const Toast = ({ message }) => {
  if (!message) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      {message}
    </div>
  );
};

export default Toast;
