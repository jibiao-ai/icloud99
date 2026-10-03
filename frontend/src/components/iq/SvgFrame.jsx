import { useMemo } from 'react';

/**
 * 把模型生成的 SVG 放进 sandbox iframe 渲染：
 *  - 脚本被禁用（sandbox 不含 allow-scripts）→ 无法执行模型输出的任何 JS；
 *  - inert：卡片预览时让点击穿透到外层卡片（否则 iframe 会吞掉点击，导致无法打开详情）
 *  - 样式与 id 天然隔离，不会污染页面，也无需手工做 CSS 作用域改写。
 */
export default function SvgFrame({ svg, title = '鹈鹕骑行 SVG 动画', className = '', inert = false }) {
  const doc = useMemo(
    () => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden}svg{max-width:100%;max-height:100%;width:100%;height:100%}</style></head><body>${svg}</body></html>`,
    [svg],
  );
  return <iframe title={title} sandbox="" srcDoc={doc} className={`w-full h-full border-0 bg-muted ${inert ? 'pointer-events-none' : ''} ${className}`} loading="lazy" tabIndex={inert ? -1 : undefined} />;
}
