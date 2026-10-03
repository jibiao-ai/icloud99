import { useState } from 'react';
import { Eraser, Database, KeyRound, LogOut, ScrollText, Server, Settings, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { channelApi } from '../services/api';
import { useStore } from '../store';
import { useCan } from '../hooks/useCan';
import PageHeader from '../components/PageHeader';
import Tabs from '../components/Tabs';
import LoginForm from '../components/LoginForm';
import ConfirmModal from '../components/ConfirmModal';
import LoadingButton from '../components/LoadingButton';
import { useToast } from '../components/Toast';
import SystemTab from '../components/settings/SystemTab';
import KeysTab from '../components/settings/KeysTab';
import NewApiTab from '../components/settings/NewApiTab';
import AuditTab from '../components/settings/AuditTab';
import SecurityTab from '../components/settings/SecurityTab';

const TABS = [
  { key: 'keys', label: 'API 密钥', icon: KeyRound },
  { key: 'system', label: '系统参数', icon: SlidersHorizontal },
  { key: 'newapi', label: 'New API', icon: Server },
  { key: 'audit', label: '审计日志', icon: ScrollText },
  { key: 'security', label: '安全', icon: ShieldCheck },
];

export default function SettingsPage() {
  const user = useStore((s) => s.user);
  const clearAuth = useStore((s) => s.clearAuth);
  const canEdit = useCan('settings:edit');
  const canManage = useCan('channel:manage');
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const tab = TABS.some((t) => t.key === sp.get('tab')) ? sp.get('tab') : 'keys';
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  if (!user) return <LoginForm />;

  const act = async () => {
    setBusy(true);
    try {
      if (confirm === 'seed') { const r = await channelApi.seed(); toast.success(r.added ? `已补齐 ${r.added} 个渠道` : '渠道目录已是最新，无需补齐'); }
      else { const r = await channelApi.cleanup(); toast.success(`已清理 ${r.removed} 个无效渠道`); }
      setConfirm('');
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="fade-in">
      <PageHeader
        icon={Settings} title="管理设置" description="API 密钥、系统参数、New API 连接、审计日志与账号安全"
        actions={(
          <>
            {canManage && <button className="btn-default btn-sm" onClick={() => setConfirm('cleanup')}><Eraser size={14} />清理无效渠道</button>}
            {canManage && <button className="btn-default btn-sm" onClick={() => setConfirm('seed')}><Database size={14} />初始化渠道</button>}
            <button className="btn-default btn-sm" onClick={clearAuth}><LogOut size={14} />退出登录</button>
          </>
        )}
      />
      <Tabs items={TABS} value={tab} onChange={(k) => setSp({ tab: k }, { replace: true })} idPrefix="settings" />
      <div id="settings-panel" role="tabpanel">
        {tab === 'keys' && canEdit && <KeysTab />}
        {tab === 'system' && canEdit && <SystemTab />}
        {tab === 'newapi' && canEdit && <NewApiTab />}
        {tab === 'audit' && <AuditTab />}
        {tab === 'security' && <SecurityTab />}
      </div>
      <ConfirmModal
        open={!!confirm} danger={confirm === 'cleanup'} loading={busy} onCancel={() => setConfirm('')} onConfirm={act}
        title={confirm === 'seed' ? '初始化渠道目录' : '清理无效渠道'}
        message={confirm === 'seed' ? '将补齐缺失的渠道（Lite / Standard / Ultra × 8 个模型），已有渠道与历史检测数据保持不变，不会写入任何密钥。' : '将删除模型为 gpt-image-2 的全部渠道及其检测记录。'}
        impactList={confirm === 'cleanup' ? ['被删除渠道的历史检测记录无法恢复'] : []} confirmText="确定"
      />
    </div>
  );
}
