import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

/**
 * 登录页：只有后端配了 APP_PASSWORD 才会出现。
 * 输了正确口令后，后端发一个 7 天有效的签名 Cookie，之后刷新都不用再输。
 */
export default function Login({ onSuccess }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = '登录 · 健康管理';
  }, []);

  async function submit(e) {
    e?.preventDefault();
    if (!password.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.login(password.trim());
      onSuccess?.();
    } catch (err) {
      setError(err.message || '登录失败');
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 pb-16">
      <div className="mb-8">
        <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-white">
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12h4l2.5-6 4 12L16 12h5" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">我的健康档案</h1>
        <p className="mt-1 text-sm text-slate-500">输入口令后进入（7 天内不用再输）</p>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="口令"
          autoFocus
          autoComplete="current-password"
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-[15px] outline-none placeholder:text-slate-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
        />
        {error ? <p className="px-1 text-sm text-rose-600">{error}</p> : null}
        <button
          type="submit"
          disabled={busy || !password.trim()}
          className="w-full rounded-2xl bg-emerald-600 py-3.5 text-[15px] font-semibold text-white transition disabled:bg-slate-200 disabled:text-slate-400"
        >
          {busy ? '验证中…' : '进入'}
        </button>
      </form>

      <p className="mt-6 text-center text-[11px] leading-relaxed text-slate-400">
        口令在服务器的 <span className="tabular">server/.env</span> 里的 <span className="tabular">APP_PASSWORD</span>
        <br />
        本机开发时留空即关闭登录
      </p>
    </div>
  );
}
