import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { authApi } from '../../services/api';
import { useToast } from '../Toast';
import FormField from '../FormField';
import LoadingButton from '../LoadingButton';
import { useStore } from '../../store';

export default function SecurityTab() {
  const toast = useToast();
  const clearAuth = useStore((s) => s.clearAuth);
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setErrs({ ...errs, [k]: '' }); };

  const submit = async (e) => {
    e.preventDefault();
    const local = {};
    if (!f.currentPassword) local.currentPassword = '请输入当前密码';
    if (f.newPassword.length < 8) local.newPassword = '新密码至少 8 位';
    if (f.confirm !== f.newPassword) local.confirm = '两次输入的新密码不一致';
    setErrs(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      await authApi.changePassword({ currentPassword: f.currentPassword, newPassword: f.newPassword });
      toast.success('密码已修改，请使用新密码重新登录');
      setTimeout(clearAuth, 1200);
    } catch (er) {
      if (er.fields) setErrs(er.fields); else toast.error(er.message);
    } finally { setBusy(false); }
  };

  return (
    <form className="card p-5 max-w-md space-y-4" onSubmit={submit} noValidate>
      <p className="text-xs text-fg-muted">修改后需要重新登录。建议使用 8 位以上的强密码。</p>
      <FormField label="当前密码" htmlFor="pw-cur" error={errs.currentPassword}><input id="pw-cur" type="password" autoComplete="current-password" className={`field ${errs.currentPassword ? 'field-error' : ''}`} value={f.currentPassword} onChange={set('currentPassword')} /></FormField>
      <FormField label="新密码" htmlFor="pw-new" error={errs.newPassword}><input id="pw-new" type="password" autoComplete="new-password" className={`field ${errs.newPassword ? 'field-error' : ''}`} value={f.newPassword} onChange={set('newPassword')} /></FormField>
      <FormField label="确认新密码" htmlFor="pw-cfm" error={errs.confirm}><input id="pw-cfm" type="password" autoComplete="new-password" className={`field ${errs.confirm ? 'field-error' : ''}`} value={f.confirm} onChange={set('confirm')} /></FormField>
      <LoadingButton type="submit" loading={busy} icon={KeyRound} onClick={undefined}>修改密码</LoadingButton>
    </form>
  );
}
