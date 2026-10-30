/**
 * 轻量 Toast：固定底部居中，2~3 秒自动消失。
 * 不引入任何弹窗库，也不用 alert()。
 */
export default function Toast({ toast }) {
  if (!toast) return null;
  const isError = toast.tone === 'error';

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-30 flex justify-center px-4">
      <div
        className={`toast-enter flex items-center gap-1.5 rounded-full px-4 py-2.5 text-sm text-white shadow-lg ${
          isError ? 'bg-rose-600' : 'bg-emerald-600'
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {isError ? (
            <>
              <path d="M12 8v5" />
              <path d="M12 16.5v.01" />
              <circle cx="12" cy="12" r="9" />
            </>
          ) : (
            <>
              <path d="m5 12.5 4.5 4.5L19 7" />
            </>
          )}
        </svg>
        <span>{toast.text}</span>
      </div>
    </div>
  );
}
