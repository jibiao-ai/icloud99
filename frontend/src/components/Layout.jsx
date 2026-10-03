import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Brain, Crosshair, Headset, LineChart, Menu, Moon, Radio, Settings, ShieldCheck, Sun, Users, X } from 'lucide-react';
import { useStore } from '../store';

const ICONS = { LineChart, Radio, Crosshair, Brain, Users, Headset, Settings };

// 菜单与权限码一一对应，前端不判断角色（铁律8）。perm 为空表示所有人可见。
const MENU = [
  { key: 'token-usage', label: '用量查询', path: '/token-usage', icon: 'LineChart', perm: 'token:query' },
  { key: 'channel-status', label: '渠道状态', path: '/channels', icon: 'Radio', perm: 'channel:view' },
  { key: 'iq-radar', label: 'GPT智商雷达', path: '/radar', icon: 'Crosshair', perm: 'radar:view' },
  { key: 'iq-test', label: '智力检测', path: '/iq', icon: 'Brain', perm: 'iq:view' },
  { key: 'usage-stats', label: '用量统计', path: '/usage', icon: 'Users', perm: 'usage:view' },
  { key: 'contact', label: '联系我们', path: '/contact', icon: 'Headset', perm: 'contact:view' },
  { key: 'settings', label: '管理设置', path: '/settings', icon: 'Settings', perm: '' },
];

export default function Layout() {
  const { theme, setTheme, sidebarOpen, toggleSidebar, setSidebar, user, perms, portal } = useStore();
  const loc = useLocation();
  const mobile = typeof window !== 'undefined' && window.innerWidth <= 900;

  useEffect(() => { if (window.innerWidth <= 900) setSidebar(false); }, [loc.pathname, setSidebar]);

  const items = MENU.filter((m) => !m.perm || perms.includes(m.perm));
  const cur = MENU.find((m) => loc.pathname.startsWith(m.path));
  const siteName = portal['site.name'] || '元擎智算';

  return (
    <div className="flex h-screen bg-page">
      {mobile && sidebarOpen && <div className="fixed inset-0 z-40 bg-fg/50" onClick={() => setSidebar(false)} aria-hidden="true" />}
      <aside
        aria-label="主导航"
        className={`${mobile ? 'fixed inset-y-0 left-0 z-50' : 'relative'} bg-card border-r border-line flex flex-col shrink-0 transition-all duration-200 overflow-hidden ${sidebarOpen ? 'w-56' : 'w-0 border-r-0'} ${mobile && sidebarOpen ? 'shadow-pop' : ''}`}
      >
        <div className="p-4 flex items-center gap-3 border-b border-line min-w-56">
          <img src="/logo.png" alt={siteName} className="w-9 h-9 rounded-xl object-cover" />
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-bold text-fg truncate">{siteName}</h1>
            <p className="text-[10px] text-fg-subtle whitespace-nowrap">AI Monitoring Platform</p>
          </div>
          {mobile && <button className="btn-ghost btn-icon !p-1.5" aria-label="关闭菜单" onClick={() => setSidebar(false)}><X size={16} /></button>}
        </div>
        <nav className="flex-1 p-2.5 space-y-1 overflow-y-auto scroll-thin min-w-56">
          {items.map((m) => {
            const Icon = ICONS[m.icon];
            return (
              <NavLink
                key={m.key} to={m.path}
                className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${isActive ? 'bg-primary-soft text-primary font-medium' : 'text-fg-muted hover:bg-hover hover:text-fg'}`}
              >
                <Icon size={17} />{m.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="p-3 border-t border-line min-w-56 flex items-center gap-2 text-[10px] text-fg-subtle"><ShieldCheck size={12} />New API · v3.0</div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 flex items-center justify-between px-3 md:px-4 border-b border-line bg-card shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <button className="btn-ghost btn-icon" aria-label="切换菜单" onClick={toggleSidebar}><Menu size={18} /></button>
            <span className="text-sm font-medium text-fg truncate">{cur?.label || ''}</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-ghost btn-icon" aria-label={theme === 'dark' ? '切换为浅色' : '切换为深色'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            {user && <span className="tag-default" title="已登录"><ShieldCheck size={12} />{user.username}</span>}
          </div>
        </header>
        <div className="flex-1 overflow-y-auto scroll-thin p-3 sm:p-4 md:p-6"><Outlet /></div>
      </main>
    </div>
  );
}
