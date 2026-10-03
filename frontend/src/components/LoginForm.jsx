import { useState } from 'react';
import { LogIn, Lock, User } from 'lucide-react';
import { useStore } from '../store';
import FormField from './FormField';
import LoadingButton from './LoadingButton';
import { useToast } from './Toast';

/** 登录表单（管理设置页未登录时展示）。字段级错误来自后端 data.fields。 */
export default function LoginForm({ onDone }) {
  const login = useStore((s) => s.login);
  const toast = useToast();
  const [f, setF] = useState({ username: '', password: '' });
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const local = {};
    if (!f.username.trim()) local.username = '请输入用户名';
    if (!f.password) local.password = '请输入密码';
    setErrs(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      await login(f.username.trim(), f.password);
      toast.success('登录成功');
      onDone?.();
    } catch (er) {
      if (er.fields) setErrs(er.fields); else toast.error(er.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-sm mx-auto mt-10 fade-in">
      <div className="text-center mb-6">
        <div className="w-14 h-14 rounded-2xl bg-primary-soft text-primary flex items-center justify-center mx-auto mb-3"><Lock size={24} /></div>
        <h2 className="text-lg font-bold text-fg">管理员登录</h2>
        <p className="text-xs text-fg-muted mt-1">登录后可进行渠道检测、用量统计与系统配置</p>
      </div>
      <form className="card p-5 space-y-4" onSubmit={submit} noValidate>
        <FormField label="用户名" htmlFor="login-user" error={errs.username}>
          <div className="relative">
            <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <input id="login-user" className={`field pl-9 ${errs.username ? 'field-error' : ''}`} autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
          </div>
        </FormField>
        <FormField label="密码" htmlFor="login-pass" error={errs.password}>
          <div className="relative">
            <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <input id="login-pass" type="password" className={`field pl-9 ${errs.password ? 'field-error' : ''}`} autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </div>
        </FormField>
        <LoadingButton className="btn-primary w-full" loading={busy} icon={LogIn} type="submit" onClick={undefined}>登录</LoadingButton>
      </form>
    </div>
  );
}
