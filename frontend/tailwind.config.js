/** 颜色只走 CSS 变量（铁律2）：语义类全部映射到 styles/index.css 中的变量。 */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        page: v('bg-page'),
        card: v('bg-card'),
        muted: v('bg-muted'),
        hover: v('bg-hover'),
        fg: v('fg'),
        'fg-muted': v('fg-muted'),
        'fg-subtle': v('fg-subtle'),
        line: v('line'),
        primary: v('primary'),
        'primary-hover': v('primary-hover'),
        'primary-soft': v('primary-soft'),
        'primary-text': v('primary-text'),
        success: v('success'),
        'success-soft': v('success-soft'),
        warning: v('warning'),
        'warning-soft': v('warning-soft'),
        danger: v('danger'),
        'danger-soft': v('danger-soft'),
        info: v('info'),
        'info-soft': v('info-soft'),
      },
      boxShadow: { pop: '0 8px 28px rgb(0 0 0 / 0.16)' },
    },
  },
  plugins: [],
};
