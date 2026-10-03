import { Crosshair, ExternalLink } from 'lucide-react';
import { useStore } from '../store';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import { useCan } from '../hooks/useCan';
import { Link } from 'react-router-dom';

/** GPT 智商雷达：嵌入外部页面，地址由「系统参数」配置（不写死在代码里）。 */
export default function RadarPage() {
  const url = useStore((s) => s.portal['radar.url']);
  const theme = useStore((s) => s.theme);
  const canEdit = useCan('settings:edit');

  let src = '';
  if (url) {
    try {
      const u = new URL(url);
      u.searchParams.set('theme', theme);
      u.searchParams.set('lang', 'zh');
      u.searchParams.set('ui_mode', 'embedded');
      src = u.toString();
    } catch { src = url; }
  }

  return (
    <div className="fade-in">
      <PageHeader
        icon={Crosshair} title="GPT 智商雷达" description="第三方雷达服务，实时展示模型智力水平"
        actions={src && <a className="btn-default btn-sm" href={src} target="_blank" rel="noreferrer"><ExternalLink size={14} />新窗口打开</a>}
      />
      {src ? (
        <div className="card overflow-hidden" style={{ height: 'calc(100vh - 190px)', minHeight: 420 }}>
          <iframe title="GPT 智商雷达" src={src} className="w-full h-full border-0" allow="fullscreen" loading="lazy" />
        </div>
      ) : (
        <div className="card">
          <EmptyState icon={Crosshair} title="尚未配置雷达地址" description="请管理员在「管理设置 → 系统参数」中填写雷达页面地址。"
            action={canEdit ? <Link className="btn-primary" to="/settings?tab=system">去配置</Link> : <Link className="btn-default" to="/settings">管理员登录</Link>} />
        </div>
      )}
    </div>
  );
}
