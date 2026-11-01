import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

/**
 * 登录 / 注册页。
 *
 * 多账号模式：每个人用自己的用户名 + 密码登录，数据互不可见。
 * 登录成功后后端发一个 30 天有效的签名 Cookie，之后刷新都不用再输。
 * 如果服务器设了 REGISTER_CODE，注册时要填邀请码，防止陌生人乱注册。
 */
export default function Login({ onSuccess, registerCodeRequired = false }) {
  const [mode, setMode] = useState('login'); // login | register
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = mode === 'login' ? '登录 · 健康管理' : '注册 · 健康管理';
  }, [mode]);

  function switchMode(next) {
    if (busy || next === mode) return;
    setMode(next);
    setError('');
    setPassword('');
  }

  async function submit(e) {
    e?.preventDefault();
    const name = username.trim();
    if (!name || !password || busy) return;
    setBusy(true);
    setError('');
    try {
      if (mode === 'register') {
        await api.register(name, password, code.trim());
      } else {
        await api.login(name, password);
      }
      onSuccess?.();
    } catch (err) {
      setError(err.message || (mode === 'register' ? '注册失败' : '登录失败'));
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-[15px] outline-none placeholder:text-slate-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100';

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 pb-16">
      <div className="mb-7">
        <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-white">
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12h4l2.5-6 4 12L16 12h5" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">我的健康档案</h1>
        <p className="mt-1 text-sm text-slate-500">
          {mode === 'login' ? '登录后进入自己的记录（30 天内免登录）' : '新账号从零开始记录，数据与别人互不可见'}
        </p>
      </div>

      {/* 登录 / 注册 切换 */}
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
        {[
          ['login', '登录'],
          ['register', '注册'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => switchMode(key)}
            className={
              'rounded-xl py-2 text-sm font-medium transition ' +
              (mode === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')
            }
          >
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-3">
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="用户名"
          autoFocus
          autoComplete="username"
          className={inputClass}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === 'register' ? '密码（至少 6 位）' : '密码'}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          className={inputClass}
        />
        {mode === 'register' && registerCodeRequired ? (
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="邀请码"
            className={inputClass}
          />
        ) : null}

        {error ? <p className="px-1 text-sm text-rose-600">{error}</p> : null}

        <button
          type="submit"
          disabled={busy || !username.trim() || !password}
          className="w-full rounded-2xl bg-emerald-600 py-3.5 text-[15px] font-semibold text-white transition disabled:bg-slate-200 disabled:text-slate-400"
        >
          {busy ? (mode === 'register' ? '创建中…' : '验证中…') : mode === 'register' ? '创建账号' : '进入'}
        </button>
      </form>

      <p className="mt-6 text-center text-[11px] leading-relaxed text-slate-400">
        你自己的记录只有登录后才能看到
        <br />
        同一台服务器上的其他账号各自独立
      </p>
    </div>
  );
}
