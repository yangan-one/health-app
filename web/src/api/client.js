const BASE = import.meta.env.VITE_API_BASE || '/api';

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', // 带上登录 Cookie
      ...options,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new Error('无法连接后端服务，请确认 server 已启动（端口 3001）');
  }

  const json = await res.json().catch(() => ({}));

  // 登录态失效（Cookie 过期/换了口令）→ 通知外层回到登录页
  if (res.status === 401 && json.code === 'AUTH_REQUIRED') {
    window.dispatchEvent(new Event('auth:expired'));
  }

  if (!res.ok || json.ok === false) {
    const detail = Array.isArray(json.details) ? `：${json.details.join('；')}` : '';
    throw new Error(json.message ? `${json.message}${detail}` : `请求失败（HTTP ${res.status}）`);
  }
  return json;
}

export const api = {
  // 登录（配了 APP_PASSWORD 才需要）
  authStatus: () => request('/auth/status'),
  login: (password) => request('/auth/login', { method: 'POST', body: { password } }),
  logout: () => request('/auth/logout', { method: 'POST' }),

  health: () => request('/health'),

  profile: () => request('/profile'),

  // 身体数据
  bodyFields: () => request('/body-metrics/fields'),
  latestMetric: () => request('/body-metrics/latest'),
  saveMetric: (data) => request('/body-metrics', { method: 'POST', body: data }),
  trend: (days = 30) => request(`/body-metrics/trend?days=${days}`),

  // 运动
  exerciseTypes: () => request('/exercise-types'),
  calcExercise: (data) => request('/exercises/calc', { method: 'POST', body: data }),
  addExercise: (data) => request('/exercises', { method: 'POST', body: data }),
  todayExercises: (date) => request(`/exercises?date=${date}`),
  deleteExercise: (id) => request(`/exercises/${id}`, { method: 'DELETE' }),

  // 看板
  dashboard: (date) => request(`/dashboard?date=${date}`),

  // 饮食（拍照识别 + 记录）
  mealTypes: () => request('/diet/meal-types'),
  foods: (q = '') => request(`/diet/foods${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  analyzeDiet: (data) => request('/diet/analyze', { method: 'POST', body: data }),
  saveDiet: (data) => request('/diet/records', { method: 'POST', body: data }),
  dietRecords: (date) => request(`/diet/records?date=${date}`),
  deleteDiet: (id) => request(`/diet/records/${id}`, { method: 'DELETE' }),

  // 我的：资料 / 目标
  saveProfile: (data) => request('/profile', { method: 'PUT', body: data }),

  // 我的：AI 配置（Key 只存本地库，接口返回一律脱敏）
  settings: () => request('/settings'),
  saveAiSettings: (data) => request('/settings/ai', { method: 'PUT', body: data }),
  testAi: (data = {}) => request('/settings/ai/test', { method: 'POST', body: data }),

  // 我的：数据导出（直接给浏览器下载链接，不走 fetch）
  exportSummary: () => request('/export/summary'),
  exportUrl: (format, table) =>
    `${BASE}/export?format=${format}${table ? `&table=${table}` : ''}`,

  // 我的：从备份导入（payload 就是导出的 JSON 对象）
  importData: (payload, replace = false) =>
    request('/admin/import', { method: 'POST', body: { replace, payload } }),

  // AI 问答：会话与消息
  chatContext: (date) => request(`/chat/context${date ? `?date=${date}` : ''}`),
  conversations: () => request('/chat/conversations'),
  createConversation: (title) =>
    request('/chat/conversations', { method: 'POST', body: title ? { title } : {} }),
  deleteConversation: (id) => request(`/chat/conversations/${id}`, { method: 'DELETE' }),
  chatMessages: (id) => request(`/chat/conversations/${id}/messages`),
};

/**
 * 流式提问：后端用 SSE 逐字下发，这里手工解析。
 * 为什么不用 EventSource：EventSource 只能 GET，而提问必须 POST 带 body。
 *
 * onDelta(text) 会被高频调用；onDone(savedMessage, meta) 在流结束时调一次；
 * 出错时抛异常，由调用方决定怎么提示。
 */
export async function streamChat({
  conversationId,
  content,
  date,
  onDelta = () => {},
  signal,
}) {
  let res;
  try {
    res = await fetch(`${BASE}/chat/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      credentials: 'same-origin',
      body: JSON.stringify({ content, stream: true, date }),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new Error('无法连接后端服务，请确认 server 已启动（端口 3001）');
  }

  if (!res.ok || !res.body) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.message || `请求失败（HTTP ${res.status}）`);
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';
  let doneInfo = null;

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 2);
      if (!raw.startsWith('data:')) continue;
      let event = null;
      try {
        event = JSON.parse(raw.slice(5).trim());
      } catch {
        continue;
      }
      if (event.type === 'delta' && event.delta) {
        answer += event.delta;
        onDelta(event.delta);
      } else if (event.type === 'done') {
        doneInfo = event;
      } else if (event.type === 'error') {
        throw new Error(event.message || 'AI 回答失败');
      }
    }
  }

  if (doneInfo?.message) return doneInfo;
  return { message: { role: 'assistant', content: answer }, meta: null };
}
