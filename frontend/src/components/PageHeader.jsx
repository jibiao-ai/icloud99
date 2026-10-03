/** 页头：title / description / actions；actions 靠右，描述过长自动换行不挤压操作区。 */
export default function PageHeader({ title, description, actions, icon: Icon }) {
  return (
    <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-5">
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-semibold text-fg flex items-center gap-2">
          {Icon && <Icon size={20} className="text-primary shrink-0" />}
          <span className="truncate">{title}</span>
        </h2>
        {description && <p className="text-xs text-fg-muted mt-1 break-words">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
    </header>
  );
}
