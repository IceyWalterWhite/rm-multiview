import React from 'react';
import ReactDOM from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import App from './App';
import './theme.css';

// /_vercel/* 端点只在 Vercel 托管的域名下存在；rmlive.cn（EdgeOne Pages）、
// IP 直连、本机上都会白打 404，一律不挂
const onVercel = location.hostname.endsWith('.vercel.app');

const root = ReactDOM.createRoot(document.getElementById('root')!);
const params = new URLSearchParams(location.search);
// ?demo=… → 人气助威条预览（假数据，不出网）。旧的全量假直播演示已废弃。
const demoParam = params.get('demo');
// ?stagedemo → 用假名单驱动完整舞台，没有直播时也能调布局。
// import.meta.env.DEV 守卫：生产构建里这支连同 StageDemo 一起被 DCE
const stageDemo = import.meta.env.DEV && params.has('stagedemo');

if (stageDemo) {
  void import('./demo/StageDemo').then(({ default: StageDemo }) => {
    root.render(
      <React.StrictMode>
        <StageDemo />
      </React.StrictMode>
    );
  });
} else if (demoParam !== null) {
  void import('./demo/DemoApp').then(({ default: DemoApp }) => {
    root.render(
      <React.StrictMode>
        <DemoApp state={demoParam} />
      </React.StrictMode>
    );
  });
} else {
  root.render(
    <React.StrictMode>
      <App />
      {onVercel && <Analytics />}
      {onVercel && <SpeedInsights />}
    </React.StrictMode>
  );
}
