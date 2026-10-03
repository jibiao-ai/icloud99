// 渠道展示元数据（颜色一律走语义类）。
export const PROVIDERS = {
  anthropic: { label: 'Anthropic' },
  openai: { label: 'OpenAI' },
};

export const TIER_LABEL = { lite: 'Lite', standard: 'Standard', ultra: 'Ultra' };
export const TIER_TAG = { lite: 'tag-info', standard: 'tag-primary', ultra: 'tag-warning' };

// 速度评级 → 文案 / 标签样式 / 圆点色
export const SPEED = {
  fast: { label: '极速', tag: 'tag-success', dot: 'success', bar: 'bg-success' },
  slow: { label: '较慢', tag: 'tag-warning', dot: 'warning', bar: 'bg-warning' },
  jam: { label: '拥堵', tag: 'tag-danger', dot: 'danger', bar: 'bg-danger' },
  unknown: { label: '未知', tag: 'tag-default', dot: 'default', bar: 'bg-fg-subtle' },
};

export const barClass = (h) => (h.success ? (SPEED[h.speed] || SPEED.unknown).bar : 'bg-danger');
export const barHeight = (h) => (h.success ? Math.max(4, Math.min(32, Math.round(h.responseTime / 100))) : 2);
export const rateTone = (r) => (r >= 95 ? 'text-success' : r >= 80 ? 'text-warning' : 'text-danger');
