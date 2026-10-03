#!/usr/bin/env node
/**
 * 铁律扫描（npm run lint:rules）：违反即退出码 1，构建失败。
 * 新增规则时：1) 在 rules 加正则；2) 需豁免的文件写入 allow；3) 同步 README「铁律」章节；4) 提供替代组件。
 *
 *  1 原生 <select>                         → CustomSelect
 *  2 原生 date/datetime-local/time/month/week → DatePicker
 *  3 window.confirm/alert/prompt           → ConfirmModal / Toast
 *  4 原生 checkbox / radio                 → Checkbox / Radio
 *  5 硬编码色值 / Tailwind 调色板类 / dark: → CSS 变量语义类
 *  6 毛玻璃 glass / backdrop-blur           → .surface / .card-pop
 *  7 聚焦彩色高亮 focus:ring / focus:border-primary → .field
 *  8 页面直接 fetch/axios                   → services/api.js
 *  9 role === 'admin' 硬编码                → useCan('module:action')
 * 10 emoji 当图标                           → lucide-react
 * 11 *Page.jsx 超过 400 行                  → 拆到 components/<module>/
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('../src/', import.meta.url).pathname;
const palette = '(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)';

const rules = [
  { id: 'native-select', re: /<select[\s>]/, msg: '禁止原生 <select>，请用 CustomSelect', allow: ['components/CustomSelect.jsx'] },
  { id: 'native-date', re: /type\s*=\s*["'{`]+\s*(?:date|datetime-local|time|month|week)\b/, msg: '禁止原生日期/时间输入，请用 DatePicker' },
  { id: 'native-dialog', re: /\b(?:window\.)?(?:confirm|alert|prompt)\s*\(/, msg: '禁止 window.confirm/alert/prompt，请用 ConfirmModal / Toast', ignoreMember: true },
  { id: 'native-check', re: /type\s*=\s*["'{`]+\s*(?:checkbox|radio)\b/, msg: '禁止原生 checkbox/radio，请用 Checkbox / Radio', allow: ['components/Checkbox.jsx', 'components/Radio.jsx'] },
  { id: 'hex-color', re: /#[0-9a-fA-F]{3,8}\b(?![0-9a-zA-Z_-])/, msg: '禁止硬编码色值，请用 CSS 变量语义类 / useChartPalette()', allow: ['utils/color.js'], stripUrlHash: true },
  { id: 'palette-class', re: new RegExp(`\\b(?:bg|text|border|ring|from|to|via|fill|stroke|divide|outline|shadow|accent|decoration)-(?:white|black|${palette}-\\d{2,3})\\b`), msg: '禁止 Tailwind 调色板类，请用语义类 (bg-card/text-fg/border-line/bg-primary…)' },
  { id: 'dark-prefix', re: /\bdark:/, msg: '禁止 dark: 前缀，变量随 [data-theme=dark] 自动切换' },
  { id: 'glass', re: /\b(?:glass|backdrop-blur|backdrop-filter)\b/, msg: '禁止毛玻璃，请用实色 .surface / .card-pop' },
  { id: 'focus-color', re: /\b(?:focus(?:-visible|-within)?:(?:ring|border-primary|outline-primary)|outline-primary)\b/, msg: '输入聚焦不得使用彩色高亮，请统一使用 .field' },
  { id: 'direct-http', re: /\b(?:fetch|axios)\s*(?:\.|\()/, msg: '页面不得直接 fetch/axios，请经 services/api.js', allow: ['services/api.js', 'services/http.js'] },
  { id: 'role-admin', re: /role\s*={2,3}\s*['"]admin['"]/, msg: "禁止 role === 'admin'，请用 useCan('module:action')" },
  { id: 'emoji-icon', re: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2B55}\u{FE0F}]/u, msg: '禁止 emoji 当图标，请用 lucide-react' },
];

const MAX_PAGE_LINES = 400;
const files = [];
(function walk(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(jsx?|css)$/.test(n)) files.push(p);
  }
})(ROOT);

const problems = [];
for (const f of files) {
  const rel = relative(ROOT, f).split(sep).join('/');
  const text = readFileSync(f, 'utf8');
  const isCss = rel.endsWith('.css');
  const lines = text.split('\n');
  let inBlock = false;

  if (/Page\.jsx$/.test(rel) && lines.length > MAX_PAGE_LINES) {
    problems.push(`${rel}: 页面 ${lines.length} 行，超过 ${MAX_PAGE_LINES} 行，请拆到 components/<module>/`);
  }
  // 样式文件是颜色变量的唯一出处，只检查结构类规则
  const skipColor = isCss && rel === 'styles/index.css';

  lines.forEach((raw, i) => {
    let line = raw;
    if (inBlock) {
      if (line.includes('*/')) { inBlock = false; line = line.slice(line.indexOf('*/') + 2); } else return;
    }
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*')) return;
    if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; return; }
    line = line.replace(/\/\*.*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/, '$1');

    for (const r of rules) {
      if (r.allow?.includes(rel)) continue;
      if (skipColor && (r.id === 'hex-color' || r.id === 'palette-class')) continue;
      if (isCss && !['hex-color', 'glass', 'focus-color', 'dark-prefix'].includes(r.id)) continue;
      let m = r.re.exec(line);
      if (!m) continue;
      if (r.ignoreMember) {
        // 排除 xxx.confirm( 这类成员方法（如 modal.confirm、onConfirm）
        const before = line.slice(0, m.index);
        if (/[\w$]\.$/.test(before) && !/window\.$/.test(before)) continue;
        if (/[\w$]$/.test(before)) continue;
      }
      if (r.id === 'hex-color') {
        // 忽略 URL 片段 / svg 引用 / 十六进制数字字面量（0x..）
        const ctx = line.slice(Math.max(0, m.index - 12), m.index);
        if (/(?:url\(|href=["']?|to=["']?|\/)[^'"]*$/.test(ctx) && !/['"`]\s*$/.test(ctx)) continue;
      }
      problems.push(`${rel}:${i + 1}: ${r.msg}  →  ${t.slice(0, 90)}`);
    }
  });
}

if (problems.length) {
  console.error(`\n✖ 铁律检查失败，共 ${problems.length} 处：\n`);
  problems.forEach((p) => console.error('  ' + p));
  console.error('');
  process.exit(1);
}
console.log(`✔ 铁律检查通过（${files.length} 个文件）`);
