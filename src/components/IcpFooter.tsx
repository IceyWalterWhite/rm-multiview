// 工信部令第 33 号：备案号悬挂于网站底部并链接至工信部备案系统。
// 广东省管局要求挂主体备案号（不带 -1 序号）。
const ICP_NUMBER = '粤ICP备2026081048号';

// 备案号只属于备案域名：Vercel 预览域（*.vercel.app）、IP 直连、本机开发都不悬挂
export function IcpFooter({ hostname = location.hostname }: { hostname?: string }) {
  if (!/(^|\.)rmlive\.cn$/.test(hostname)) return null;
  return (
    <footer className="icp-footer">
      <a href="https://beian.miit.gov.cn" target="_blank" rel="noopener noreferrer">{ICP_NUMBER}</a>
    </footer>
  );
}
