export function NumberField({
  label,
  unit,
  value,
  onChange,
  placeholder,
  min,
  step = '0.1',
  highlight = false,
  hint,
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between gap-1 text-xs text-slate-500">
        <span className="truncate">{label}</span>
        {hint ? (
          <span
            className={`shrink-0 rounded px-1 py-0.5 text-[10px] leading-none ${
              highlight ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
            }`}
          >
            {hint}
          </span>
        ) : unit ? (
          <span className="shrink-0 text-slate-400">{unit}</span>
        ) : null}
      </span>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        placeholder={placeholder ?? '未记录'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-xl border px-3 py-2.5 text-[15px] text-slate-900 tabular outline-none transition placeholder:text-slate-300 focus:bg-white focus:ring-2 ${
          highlight
            ? 'border-emerald-400 bg-emerald-50/50 ring-2 ring-emerald-100 focus:border-emerald-500 focus:ring-emerald-200'
            : 'border-slate-200 bg-slate-50/60 focus:border-emerald-400 focus:ring-emerald-100'
        }`}
      />
    </label>
  );
}

export function TextArea({ label, value, onChange, placeholder, rows = 3 }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-slate-500">{label}</span>
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-[15px] text-slate-900 outline-none transition placeholder:text-slate-300 focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-100"
      />
    </label>
  );
}
