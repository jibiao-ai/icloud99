// 颜色工具：从 CSS 变量读取通道值，供图表与主色设置使用（唯一允许处理色值的文件）。

const hexToRgbChannels = (hex) => {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};

// 按亮度压暗，生成 hover 色
const shade = (channels, ratio) => channels.split(' ').map((v) => Math.max(0, Math.min(255, Math.round(Number(v) * ratio)))).join(' ');

// 柔和底色：主色混入页面底色
const soften = (channels, base, amount) => {
  const a = channels.split(' ').map(Number);
  const b = base.split(' ').map(Number);
  return a.map((v, i) => Math.round(b[i] + (v - b[i]) * amount)).join(' ');
};

/** 应用主色（#RRGGBB）到 CSS 变量；非法值忽略。 */
export function applyPrimary(hex) {
  const ch = hexToRgbChannels(hex);
  if (!ch) return;
  const root = document.documentElement;
  const dark = root.getAttribute('data-theme') === 'dark';
  root.style.setProperty('--primary', ch);
  root.style.setProperty('--primary-hover', shade(ch, dark ? 1.15 : 0.82));
  root.style.setProperty('--primary-soft', soften(ch, dark ? '24 28 41' : '255 255 255', dark ? 0.25 : 0.12));
}

/** 读取 CSS 变量为 rgb() 字符串，供 recharts 使用。 */
export function cssVar(name) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  return v ? `rgb(${v.split(' ').join(',')})` : 'currentColor';
}
