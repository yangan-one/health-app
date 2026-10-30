/**
 * 冒烟脚本共用的登录引导。
 *
 * 加了 APP_PASSWORD 之后，所有接口都要 Cookie。测试脚本不想重复处理这件事，
 * 所以这里做一次登录，然后把 Cookie 粘到后续所有 fetch 请求上（包装全局 fetch，
 * 调用方代码一行都不用改）。
 */
export async function installTestAuth(baseUrl = 'http://127.0.0.1:3001') {
  const status = await fetch(`${baseUrl}/api/auth/status`)
    .then((r) => r.json())
    .catch(() => null);

  if (!status?.data?.required) return { required: false };

  const password = process.env.APP_PASSWORD;
  if (!password) {
    throw new Error(
      '服务器开启了登录（APP_PASSWORD），但测试脚本读不到口令。请用 npm run smoke（会自动带 --env-file-if-exists=.env），或在命令里显式传 APP_PASSWORD。'
    );
  }

  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`测试脚本登录失败：${json.message || res.status}`);

  const cookie = (res.headers.getSetCookie?.() || [])
    .map((c) => c.split(';')[0])
    .join('; ');
  if (!cookie) throw new Error('测试脚本登录成功但没有拿到 Cookie');

  const rawFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) =>
    rawFetch(input, {
      ...init,
      headers: { ...(init.headers || {}), cookie },
    });

  return { required: true };
}
