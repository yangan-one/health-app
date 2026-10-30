/**
 * 第五步（AI 智能问答）端到端冒烟。
 * 需要先启动后端：cd health-app/server && npm start
 *
 * 会真实调用大模型 1-2 次（消耗少量 token，约 1000-2000 tokens/次），
 * 想只看链路不烧 token，可以只跑「上下文 / 会话 CRUD」那几项（见 --no-ai）。
 */
import { installTestAuth } from './lib/test-auth.js';

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3001/api';
// 服务端配了 APP_PASSWORD 时自动登录（否则接口全 401）
await installTestAuth(BASE.replace(/\/api$/, ''));
const NO_AI = process.argv.includes('--no-ai');

let pass = 0;
let fail = 0;

function ok(name) {
  pass++;
  console.log(`  ✓ ${name}`);
}
function bad(name, detail) {
  fail++;
  console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`);
}
async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}
function assert(cond, name, detail) {
  if (cond) ok(name);
  else bad(name, detail);
}

const created = [];

async function main() {
  console.log('\n【1】注入的上下文');
  const ctx = await call('GET', '/chat/context');
  assert(ctx.status === 200 && ctx.json.ok, 'GET /chat/context 正常');
  const text = ctx.json.data?.text ?? '';
  assert(text.includes('热量目标'), '上下文包含热量目标行');
  assert(text.includes('今日还可摄入'), '上下文包含「今日还可摄入」（预算口径）');
  assert(Array.isArray(ctx.json.data?.suggestions) && ctx.json.data.suggestions.length > 0, '有推荐问题');
  assert(Boolean(ctx.json.data?.ai?.model), `文本模型已确定（${ctx.json.data?.ai?.model}）`);
  console.log(`     上下文 ${text.length} 字，缺失项：${(ctx.json.data?.missing ?? []).join('、') || '无'}`);

  console.log('\n【2】会话 CRUD');
  const created1 = await call('POST', '/chat/conversations');
  assert(created1.status === 201 && created1.json.data?.conversation?.id, '新建会话');
  const convId = created1.json.data.conversation.id;
  created.push(convId);

  const list = await call('GET', '/chat/conversations');
  assert(
    list.json.data?.conversations?.some((c) => c.id === convId),
    '会话出现在列表里'
  );

  const renamed = await call('PATCH', `/chat/conversations/${convId}`, { title: '冒烟测试会话' });
  assert(renamed.json.data?.title === '冒烟测试会话', '改标题生效');

  const emptyTitle = await call('PATCH', `/chat/conversations/${convId}`, { title: '   ' });
  assert(emptyTitle.status === 400, '空标题被拒绝 (400)');

  const notFound = await call('GET', '/chat/conversations/999999/messages');
  assert(notFound.status === 404, '不存在的会话返回 404');

  console.log('\n【3】提问校验（不花 token）');
  const empty = await call('POST', `/chat/conversations/${convId}/messages`, { content: '' });
  assert(empty.status === 400, '空问题被拒绝 (400)');

  const tooLong = await call('POST', `/chat/conversations/${convId}/messages`, {
    content: 'x'.repeat(2100),
  });
  assert(tooLong.status === 400, '超长问题被拒绝 (400)');

  if (NO_AI) {
    console.log('\n（--no-ai：跳过真实模型调用）');
  } else {
    console.log('\n【4】真实提问（非流式）');
    const t0 = Date.now();
    const ask = await call('POST', `/chat/conversations/${convId}/messages`, {
      content: '用一句话说我今天还能吃多少热量。',
    });
    const ms = Date.now() - t0;
    const answer = ask.json.data?.message?.content ?? '';
    if (ask.json.ok) {
      ok(`模型回答成功（${ms}ms，${answer.length} 字）`);
      assert(/kcal|卡|热/.test(answer), '回答里提到了热量数字');
      assert(ask.json.data?.meta?.context_chars > 200, '回答了注入上下文长度');
      console.log(`     回答：${answer.replace(/\s+/g, ' ').slice(0, 100)}…`);
    } else {
      bad('模型回答成功', JSON.stringify(ask.json).slice(0, 200));
    }

    const msgs = await call('GET', `/chat/conversations/${convId}/messages`);
    const rows = msgs.json.data?.messages ?? [];
    assert(rows.length >= 2, `提问与回答都已落库（${rows.length} 条）`);
    assert(
      rows.some((m) => m.role === 'user') && rows.some((m) => m.role === 'assistant'),
      'user/assistant 两种角色都在'
    );

    console.log('\n【5】流式提问（SSE）');
    const res = await fetch(`${BASE}/chat/conversations/${convId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '只回复两个字：收到', stream: true }),
    });
    assert(
      (res.headers.get('content-type') || '').includes('text/event-stream'),
      'Content-Type 是 text/event-stream'
    );
    const raw = await res.text();
    const deltas = raw.split('\n\n').filter((l) => l.includes('"type":"delta"')).length;
    assert(deltas > 0, `收到 ${deltas} 个 delta 事件`);
    assert(raw.includes('"type":"done"'), '收到 done 事件');
  }

  console.log('\n【6】删除会话（消息级联）');
  const del = await call('DELETE', `/chat/conversations/${convId}`);
  assert(del.status === 200 && del.json.ok, '删除会话');
  const after = await call('GET', `/chat/conversations/${convId}/messages`);
  assert(after.status === 404, '删除后访问返回 404');

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('\n冒烟脚本异常：', err);
  process.exitCode = 1;
});
