/** 表单项：label + 控件 + 提示/错误。error 为字段级校验信息。 */
export default function FormField({ label, htmlFor, error, hint, required, children, className = '' }) {
  return (
    <div className={className}>
      {label && (
        <label htmlFor={htmlFor} className="label">
          {label}{required && <span className="text-danger ml-0.5">*</span>}
        </label>
      )}
      {children}
      {error ? <p className="err-text" role="alert">{error}</p> : hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}
