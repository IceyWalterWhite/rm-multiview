import React from 'react';
import ReactDOM from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import App from './App';
import './theme.css';

// /_vercel/* 端点只在 Vercel 托管的域名下存在；rmlive.cn（EdgeOne Pages）、
// IP 直连、本机上都会白打 404，一律不挂
const onVercel = location.hostname.endsWith('.vercel.app');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    {onVercel && <Analytics />}
    {onVercel && <SpeedInsights />}
  </React.StrictMode>
);
