import { useStore } from '../store';

/** 权限判断（铁律8）：useCan('module:action')。 */
export function useCan(code) {
  const perms = useStore((s) => s.perms);
  return perms.includes(code);
}

export function useIsLoggedIn() {
  return useStore((s) => !!s.user);
}
