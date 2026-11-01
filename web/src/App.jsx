import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import BottomNav from './components/BottomNav.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Diet from './pages/Diet.jsx';
import BodyMetrics from './pages/BodyMetrics.jsx';
import Exercise from './pages/Exercise.jsx';
import Profile from './pages/Profile.jsx';
import Chat from './pages/Chat.jsx';
import Login from './pages/Login.jsx';
import { api } from './api/client.js';

export default function App() {
  // loading：正在问后端要不要登录；required：后端设了 APP_PASSWORD；authed：Cookie 还有效
  const [auth, setAuth] = useState({
    loading: true,
    required: false,
    authed: true,
    registerCodeRequired: false,
    user: null,
  });

  const check = useCallback(async () => {
    try {
      const { data } = await api.authStatus();
      setAuth({
        loading: false,
        required: !!data.required,
        authed: !!data.authed,
        registerCodeRequired: !!data.register_code_required,
        user: data.user || null,
      });
    } catch {
      // 后端没启动时不要卡在登录页，让各页面自己显示「无法连接后端」
      setAuth({ loading: false, required: false, authed: true, registerCodeRequired: false, user: null });
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  // 任何接口返回 401（Cookie 过期 / 口令被改）→ 立刻回登录页
  useEffect(() => {
    const onExpired = () =>
      setAuth((prev) => ({ ...prev, loading: false, required: true, authed: false, user: null }));
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  if (auth.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-600" />
          <p className="text-xs text-slate-400">加载中…</p>
        </div>
      </div>
    );
  }

  if (auth.required && !auth.authed) {
    return (
      <div className="min-h-full bg-slate-50 text-slate-900">
        <Login onSuccess={check} registerCodeRequired={auth.registerCodeRequired} />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      <main className="mx-auto w-full max-w-md px-4 pb-28 pt-5">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/diet" element={<Diet />} />
          <Route path="/body" element={<BodyMetrics />} />
          <Route path="/exercise" element={<Exercise />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/me" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <BottomNav />
    </div>
  );
}
