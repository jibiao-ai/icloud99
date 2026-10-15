import { Plus, Trash2 } from 'lucide-react';
import FormField from '../FormField';
import DatePicker from '../DatePicker';
import CustomSelect from '../CustomSelect';
import NumInput from './NumInput';
import { money, payableOf } from './billDoc';

const BASIC = [
  ['title', '账单标题', 30], ['subtitle', '副标题', 60], ['company', '公司 / 品牌名称', 30], ['account', '账号', 60],
  ['accountId', '账号 ID', 40], ['exportedBy', '导出账号', 60], ['exportedAt', '导出时间', 30], ['currency', '货币符号', 4],
  ['currencyCn', '货币说明', 30], ['footer', '页脚说明', 80],
];

/** 账单可编辑表单：基本信息 / 月度汇总（含起止日期）/ 产品明细 / 备注。errs 为后端字段级错误。 */
export default function BillEditor({ doc, setDoc, errs = {}, monthOpts }) {
  const set = (k, v) => setDoc((d) => ({ ...d, [k]: v }));
  const setRow = (key, i, patch) => setDoc((d) => ({ ...d, [key]: d[key].map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const monthSel = monthOpts.filter((o) => doc.months.some((m) => m.month === o.value));
  const addItem = () => setDoc((d) => ({ ...d, items: [...d.items, { buyer: d.account, owner: d.account, product: '', goods: '', month: d.months[0]?.month || '', amount: '0' }] }));
  const delItem = (i) => setDoc((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) }));

  return (
    <div className="space-y-6">
      <section aria-label="基本信息">
        <h4 className="text-sm font-semibold text-fg mb-3">基本信息</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {BASIC.map(([k, label, max]) => (
            <FormField key={k} label={label} htmlFor={`bill-${k}`} error={errs[k]} className={k === 'footer' ? 'sm:col-span-2' : ''}>
              <input id={`bill-${k}`} className={`field ${errs[k] ? 'field-error' : ''}`} maxLength={max} value={doc[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
            </FormField>
          ))}
        </div>
      </section>

      <section aria-label="月度费用汇总">
        <h4 className="text-sm font-semibold text-fg mb-1">月度费用汇总</h4>
        <p className="text-xs text-fg-subtle mb-3">每个账单月份可单独修改起止日期、费用总额与优惠金额，应付金额 = 费用总额 - 优惠金额。</p>
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full text-xs min-w-[720px]">
            <thead><tr className="text-left text-fg-muted">
              <th className="py-1.5 pr-2 font-medium">账单月份</th><th className="pr-2 font-medium">开始日期</th><th className="pr-2 font-medium">截止日期</th>
              <th className="pr-2 font-medium text-right">费用总额</th><th className="pr-2 font-medium text-right">优惠金额</th><th className="font-medium text-right">应付金额</th>
            </tr></thead>
            <tbody>
              {doc.months.map((m, i) => (
                <tr key={m.month} className="align-top">
                  <td className="py-1.5 pr-2 pt-3 text-fg">{m.month}</td>
                  <td className="pr-2 py-1.5">
                    <DatePicker size="sm" width={140} value={m.start} aria-label={`${m.month} 开始日期`} invalid={!!errs[`months.${i}.start`]} onChange={(v) => setRow('months', i, { start: v })} />
                    {errs[`months.${i}.start`] && <p className="err-text">{errs[`months.${i}.start`]}</p>}
                  </td>
                  <td className="pr-2 py-1.5"><DatePicker size="sm" width={140} value={m.end} aria-label={`${m.month} 截止日期`} invalid={!!errs[`months.${i}.end`]} onChange={(v) => setRow('months', i, { end: v })} /></td>
                  <td className="pr-2 py-1.5">
                    <NumInput value={m.total} aria-label={`${m.month} 费用总额`} invalid={!!errs[`months.${i}.total`]} onChange={(v) => setRow('months', i, { total: v })} />
                    {errs[`months.${i}.total`] && <p className="err-text">{errs[`months.${i}.total`]}</p>}
                  </td>
                  <td className="pr-2 py-1.5">
                    <NumInput value={m.discount} aria-label={`${m.month} 优惠金额`} invalid={!!errs[`months.${i}.discount`]} onChange={(v) => setRow('months', i, { discount: v })} />
                    {errs[`months.${i}.discount`] && <p className="err-text">{errs[`months.${i}.discount`]}</p>}
                  </td>
                  <td className="py-1.5 pt-3 text-right tabular-nums font-medium text-fg">{money(payableOf(m))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label="产品费用明细">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-fg">产品费用明细</h4>
          <button type="button" className="btn-default btn-sm" onClick={addItem} disabled={doc.items.length >= 200}><Plus size={14} />添加明细行</button>
        </div>
        {errs.items && <p className="err-text mb-2">{errs.items}</p>}
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full text-xs min-w-[860px]">
            <thead><tr className="text-left text-fg-muted">
              <th className="py-1.5 pr-2 font-medium">资源购买账号</th><th className="pr-2 font-medium">资源归属账号</th><th className="pr-2 font-medium">产品名称</th>
              <th className="pr-2 font-medium">商品名称</th><th className="pr-2 font-medium">账单月份</th><th className="pr-2 font-medium text-right">费用金额</th><th className="w-8"><span className="sr-only">操作</span></th>
            </tr></thead>
            <tbody>
              {doc.items.map((it, i) => {
                const e = (f) => errs[`items.${i}.${f}`];
                const txt = (f, label) => (
                  <td className="pr-2 py-1.5">
                    <input className={`field ${e(f) ? 'field-error' : ''}`} aria-label={`第 ${i + 1} 行${label}`} value={it[f] ?? ''} onChange={(ev) => setRow('items', i, { [f]: ev.target.value })} />
                    {e(f) && <p className="err-text">{e(f)}</p>}
                  </td>
                );
                return (
                  <tr key={i} className="align-top">
                    {txt('buyer', '资源购买账号')}{txt('owner', '资源归属账号')}{txt('product', '产品名称')}{txt('goods', '商品名称')}
                    <td className="pr-2 py-1.5">
                      <CustomSelect size="sm" minWidth={120} options={monthSel} value={it.month} aria-label={`第 ${i + 1} 行账单月份`} invalid={!!e('month')} onChange={(v) => setRow('items', i, { month: v })} />
                    </td>
                    <td className="pr-2 py-1.5">
                      <NumInput value={it.amount} aria-label={`第 ${i + 1} 行费用金额`} invalid={!!e('amount')} onChange={(v) => setRow('items', i, { amount: v })} />
                      {e('amount') && <p className="err-text">{e('amount')}</p>}
                    </td>
                    <td className="py-1.5"><button type="button" className="btn-ghost btn-icon !p-1.5 text-danger" aria-label={`删除第 ${i + 1} 行`} onClick={() => delItem(i)}><Trash2 size={14} /></button></td>
                  </tr>
                );
              })}
              {doc.items.length === 0 && <tr><td colSpan={7} className="py-4 text-center text-fg-subtle">暂无明细行，可点击右上角添加</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label="备注">
        <FormField label="账单备注（可选，显示在明细之后）" htmlFor="bill-remark" error={errs.remark}>
          <textarea id="bill-remark" rows={3} maxLength={500} className={`field ${errs.remark ? 'field-error' : ''}`} value={doc.remark ?? ''} onChange={(e) => set('remark', e.target.value)} />
        </FormField>
      </section>
    </div>
  );
}
