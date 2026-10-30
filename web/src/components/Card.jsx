export default function Card({ children, className = '' }) {
  return (
    <section
      className={`rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}
    >
      {children}
    </section>
  );
}

export function CardTitle({ children, extra }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-2">
      <h2 className="text-sm font-semibold text-slate-800">{children}</h2>
      {extra ? <span className="text-xs text-slate-400">{extra}</span> : null}
    </div>
  );
}
