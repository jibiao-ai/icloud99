import { useMemo } from 'react';
import { useStore } from '../store';
import { cssVar } from '../utils/color';

/** 图表颜色只能来自这里（铁律3）；主题/主色变化时重新读取。 */
export function useChartPalette() {
  const theme = useStore((s) => s.theme);
  const primary = useStore((s) => s.portal['site.primary_color']);
  return useMemo(() => ({
    primary: cssVar('primary'),
    ok: cssVar('success'),
    warn: cssVar('warning'),
    bad: cssVar('danger'),
    info: cssVar('info'),
    grid: cssVar('chart-grid'),
    text: cssVar('fg-muted'),
    card: cssVar('bg-card'),
    line: cssVar('line'),
    series: [cssVar('primary'), cssVar('info'), cssVar('success'), cssVar('warning'), cssVar('danger'), cssVar('fg-muted')],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [theme, primary]);
}
