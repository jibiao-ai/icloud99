import { Bolt, Boxes, Headset, LineChart, Server, ShieldCheck } from 'lucide-react';
import { useStore } from '../store';
import PageHeader from '../components/PageHeader';

const FEATURES = [
  { icon: Bolt, tone: 'text-success bg-success-soft', title: '低延迟', desc: '全球边缘加速' },
  { icon: ShieldCheck, tone: 'text-info bg-info-soft', title: '高可用', desc: '多线路智能切换' },
  { icon: Boxes, tone: 'text-primary bg-primary-soft', title: '全模型', desc: '支持主流AI模型' },
  { icon: LineChart, tone: 'text-warning bg-warning-soft', title: '实时监控', desc: '渠道状态透明可查' },
];

export default function ContactPage() {
  const site = useStore((s) => s.portal['site.name']) || '元擎智算';
  const api = useStore((s) => s.portal['site.token_base_url']);
  return (
    <div className="max-w-4xl mx-auto fade-in">
      <PageHeader icon={Headset} title="联系我们" description={`${site} Token 工厂 · 一站式 AI API 服务平台`} />

      <section className="card p-6 mb-5">
        <div className="flex items-start gap-4 mb-5">
          <img src="/logo.png" alt={site} className="w-14 h-14 rounded-xl object-cover border border-line" />
          <div>
            <h3 className="text-base font-bold text-fg">{site} · Token 工厂</h3>
            <p className="text-sm text-fg-muted leading-relaxed mt-1">
              {site} Token 工厂是一站式 AI API 中转服务平台，提供 OpenAI、Anthropic 等主流模型的 API 接入服务。我们致力于为开发者提供稳定、高效、低延迟的 AI 能力调用。
            </p>
          </div>
        </div>
        <ul className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {FEATURES.map((f) => (
            <li key={f.title} className="bg-muted rounded-xl p-3.5 text-center">
              <span className={`w-10 h-10 rounded-lg flex items-center justify-center mx-auto mb-2 ${f.tone}`}><f.icon size={18} /></span>
              <h4 className="text-xs font-semibold text-fg">{f.title}</h4>
              <p className="text-[11px] text-fg-subtle mt-0.5">{f.desc}</p>
            </li>
          ))}
        </ul>
        <div className="bg-primary-soft rounded-xl p-4">
          <h4 className="text-sm font-semibold text-fg flex items-center gap-2 mb-3"><Server size={15} className="text-primary" />服务信息</h4>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div className="flex items-center gap-2"><dt className="text-xs text-fg-muted w-16">API 域名</dt><dd><code className="tag-default font-mono">{api ? api.replace(/^https?:\/\//, '') : '未配置'}</code></dd></div>
            <div className="flex items-center gap-2"><dt className="text-xs text-fg-muted w-16">监控面板</dt><dd><code className="tag-default font-mono">obs.icloud99.cn</code></dd></div>
            <div className="flex items-center gap-2"><dt className="text-xs text-fg-muted w-16">支持协议</dt><dd className="text-xs text-fg">OpenAI 兼容格式 (Chat Completions API)</dd></div>
            <div className="flex items-center gap-2"><dt className="text-xs text-fg-muted w-16">分组类型</dt><dd className="text-xs text-fg">Lite / Standard / Ultra 三档分组</dd></div>
          </dl>
        </div>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {[{ name: 'QQ', img: '/qr-qq.png', tip: '扫码添加 QQ 咨询' }, { name: '微信', img: '/qr-wechat.png', tip: '扫码添加微信咨询' }].map((q) => (
          <section key={q.name} className="card p-5 text-center">
            <h3 className="text-sm font-bold text-fg mb-3">{q.name}</h3>
            <img src={q.img} alt={`${q.name} 二维码`} className="w-48 h-48 sm:w-52 sm:h-52 object-contain mx-auto" loading="lazy" />
            <p className="text-xs text-fg-muted mt-3">{q.tip}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
