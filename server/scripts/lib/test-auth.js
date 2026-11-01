/**
 * 冒烟脚本共用的登录引导。
 *
 * 多账号模式下所有接口都要 Cookie。测试脚本不想重复处理这件事，
 * 所以这里用「老板账号」登录一次，然后把 Cookie 粘到后续所有 fetch 请求上
 * （包装全局 fetch，调用方代码一行都不用改）。
 *
 * 用户名/口令来源（按优先级）：
 *   TEST_USERNAME / OWNER_USERNAME / 'me'
 *   TEST_PASSWORD / OWNER_PASSWORD / APP_PASSWORD
 * 用 npm run smoke 时会自动带 --env-file-if-exists=.env，所以一般不用手动传。
 */
export async function installTestAuth(baseUrl = 'http://127.0.0.1:3001') {
  const status = await fetch(`${baseUrl}/api/auth/status`)
    .then((r) => r.json())
    .catch(() => null);

  if (!status?.data?.required) return { required: false };
  // 已经登录过（本机浏览器带着 Cookie）就不用再登
  if (status.data.authed) return { required: true, already: true };

  const username = process.env.TEST_USERNAME || process.env.OWNER_USERNAME || 'me';
  const password =
    process.env.TEST_PASSWORD || process.env.OWNER_PASSWORD || process.env.APP_PASSWORD;
  if (!password) {
    throw new Error(
      '服务器开启了登录，但测试脚本读不到口令。请用 npm run smoke（会自动带 --env-file-if-exists=.env），或在命令里显式传 OWNER_PASSWORD / APP_PASSWORD。'
    );
  }

  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`测试脚本登录失败（用户名 ${username}）：${json.message || res.status}`);
  }

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

  return { required: true, username };
}
