import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

window.addEventListener('unhandledrejection', (event) => {
  console.warn('Prevented unhandled promise rejection from reloading page:', event.reason);
  event.preventDefault();
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
