import { AlertTriangle } from 'lucide-react';
import Modal from './Modal';
import LoadingButton from './LoadingButton';

/** 确认弹窗（替代 window.confirm）。danger 时默认聚焦「取消」；impactList 列影响范围，targets 列目标资源。 */
export default function ConfirmModal({ open, title = '请确认', message, danger, impactList = [], targets = [], confirmText = '确定', loading, onConfirm, onCancel }) {
  return (
    <Modal open={open} title={title} onClose={onCancel} width="max-w-md"
      footer={(
        <>
          <button type="button" autoFocus={danger} className="btn-default" onClick={onCancel} disabled={loading}>取消</button>
          <LoadingButton className={danger ? 'btn-danger' : 'btn-primary'} loading={loading} onClick={onConfirm}>{confirmText}</LoadingButton>
        </>
      )}
    >
      <div className="flex gap-3">
        {danger && <span className="w-9 h-9 rounded-full bg-danger-soft text-danger flex items-center justify-center shrink-0"><AlertTriangle size={18} /></span>}
        <div className="min-w-0 text-sm text-fg">
          {message && <p className="break-words">{message}</p>}
          {targets.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">{targets.map((t) => <li key={t} className="tag-default font-mono">{t}</li>)}</ul>
          )}
          {impactList.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-fg-muted mb-1">影响范围</p>
              <ul className="list-disc pl-4 space-y-0.5 text-xs text-fg-muted">{impactList.map((t) => <li key={t}>{t}</li>)}</ul>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
