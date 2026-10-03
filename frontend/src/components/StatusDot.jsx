const COLORS = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger', info: 'bg-info', default: 'bg-fg-subtle' };

export default function StatusDot({ tone = 'default', pulse }) {
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${COLORS[tone]} ${pulse ? 'pulse-dot' : ''}`} />;
}
