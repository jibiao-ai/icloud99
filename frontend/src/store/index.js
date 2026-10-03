// 唯一的 zustand store：认证、主题、门户信息、列表筛选（刷新/切页保留）。
import { create } from 'zustand';
import { authApi, bindAuth } from '../services/api';
import { applyPrimary } from '../utils/color';

const TOKEN_KEY = 'yq_token';
const THEME_KEY = 'yq_theme';

const initialTheme = () => localStorage.getItem(THEME_KEY) || 'light';

export const useStore = create((set, get) => ({
  token: localStorage.getItem(TOKEN_KEY) || '',
  user: null,
  perms: [],
  ready: false,
  theme: initialTheme(),
  portal: {},
  sidebarOpen: typeof window !== 'undefined' ? window.innerWidth > 900 : true,
  queries: {}, // useListQuery 的筛选/分页状态，按 key 保存

  setTheme(theme) {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.setAttribute('data-theme', theme);
    set({ theme });
    const c = get().portal['site.primary_color'];
    if (c) applyPrimary(c);
  },
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebar: (v) => set({ sidebarOpen: v }),

  setPortal(portal) {
    set({ portal });
    if (portal['site.primary_color']) applyPrimary(portal['site.primary_color']);
    if (portal['site.name']) document.title = `${portal['site.name']}可视化`;
  },

  async loadPortal() {
    try { get().setPortal(await authApi.portalInfo()); } catch { /* 门户信息失败不阻塞 */ }
  },

  async bootstrap() {
    document.documentElement.setAttribute('data-theme', get().theme);
    await get().loadPortal();
    try {
      const me = await authApi.me();
      set({ user: me.user, perms: me.perms });
    } catch {
      get().clearAuth();
    }
    set({ ready: true });
  },

  async login(username, password) {
    const r = await authApi.login(username, password);
    localStorage.setItem(TOKEN_KEY, r.token);
    set({ token: r.token, user: r.user, perms: r.perms });
  },

  clearAuth() {
    localStorage.removeItem(TOKEN_KEY);
    set({ token: '', user: null, perms: [] });
    authApi.me().then((me) => set({ perms: me.perms })).catch(() => {});
  },

  setQuery: (key, patch) => set((s) => ({ queries: { ...s.queries, [key]: { ...(s.queries[key] || {}), ...patch } } })),
}));

bindAuth(() => useStore.getState().token, () => useStore.getState().clearAuth());
