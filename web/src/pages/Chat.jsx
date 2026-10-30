import { useCallback, useEffect, useRef, useState } from 'react';
import { api, streamChat } from '../api/client.js';
import { todayISO } from '../lib/format.js';

/** 一条消息气泡 */
function Bubble({ role, content, streaming }) {
  const mine = role === 'user';
  return (
    <div className={`flex gap-2 ${mine ? 'justify-end' : 'justify-start'}`}>
      {!mine ? (
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[11px] font-medium text-emerald-700">
          AI
        </div>
      ) : null}
      <div
        className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
          mine
            ? 'rounded-br-md bg-emerald-600 text-white'
            : 'rounded-bl-md bg-white text-slate-800 shadow-sm ring-1 ring-slate-100'
        }`}
      >
        {content}
        {streaming ? (
          <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-emerald-500 align-middle" />
        ) : null}
      </div>
    </div>
  );
}

function Sheet({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-slate-900/30" onClick={onClose}>
      <div
        className="max-h-[75vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold">{title}</p>
          <button type="button" onClick={onClose} className="text-xs text-slate-400">
            关闭
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function Chat() {
  const [ctx, setCtx] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [convId, setConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showCtx, setShowCtx] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const bottomRef = useRef(null);
  const abortRef = useRef(null);

  const loadContext = useCallback(async () => {
    try {
      const r = await api.chatContext(todayISO());
      setCtx(r.data);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const r = await api.conversations();
      setConversations(r.data.conversations);
      return r.data.conversations;
    } catch (err) {
      setError(err.message);
      return [];
    }
  }, []);

  // 首次进入：拿到「这次会注入什么数据」+ 最近一次会话
  useEffect(() => {
    let alive = true;
    (async () => {
      await loadContext();
      const list = await loadConversations();
      if (!alive) return;
      if (list.length) {
        setConvId(list[0].id);
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadContext, loadConversations]);

  // 切换会话时拉历史消息
  useEffect(() => {
    if (!convId) {
      setMessages([]);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const r = await api.chatMessages(convId);
        if (alive) setMessages(r.data.messages);
      } catch (err) {
        if (alive) setError(err.message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [convId]);

  // 自动滚到底部（新消息、流式增量都会触发）
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, streaming]);

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    // 已经收到的半截内容仍然保留展示，避免用户看到的东西忽然消失
    setStreaming((prev) => {
      if (prev) setMessages((ms) => [...ms, { role: 'assistant', content: `${prev}\n\n（已停止）` }]);
      return '';
    });
  };

  const send = async (text) => {
    const content = (text ?? input).trim();
    if (!content || busy) return;

    setInput('');
    setError('');
    setBusy(true);
    setStreaming('');

    let id = convId;
    try {
      // 第一条消息时才真正创建会话，避免点进来就产生一堆空会话
      if (!id) {
        const r = await api.createConversation();
        id = r.data.conversation.id;
        setConvId(id);
      }

      setMessages((ms) => [...ms, { role: 'user', content }]);

      const controller = new AbortController();
      abortRef.current = controller;

      const result = await streamChat({
        conversationId: id,
        content,
        date: todayISO(),
        signal: controller.signal,
        onDelta: (d) => setStreaming((prev) => prev + d),
      });

      setStreaming('');
      if (result?.message?.content) {
        setMessages((ms) => [...ms, result.message]);
      }
      loadConversations();
    } catch (err) {
      setStreaming('');
      if (err?.name !== 'AbortError') setError(err.message || '回答失败，请重试');
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const newChat = () => {
    stop();
    setConvId(null);
    setMessages([]);
    setError('');
    setShowHistory(false);
  };

  const removeConv = async (id) => {
    try {
      await api.deleteConversation(id);
      const list = await loadConversations();
      if (id === convId) newChat();
      if (!list.some((c) => c.id === convId)) setConvId(list[0]?.id ?? null);
    } catch (err) {
      setError(err.message);
    }
  };

  const suggestions = ctx?.suggestions ?? [];
  const aiReady = ctx?.ai?.configured ?? true;

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col">
      {/* 顶部 */}
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">AI 健康助手</h1>
          <p className="text-[11px] text-slate-400">
            {ctx?.ai?.model ? `模型 ${ctx.ai.model}` : '读取你的记录来回答'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowCtx(true)}
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-600"
          >
            注入的数据
          </button>
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-600"
          >
            历史
          </button>
          <button
            type="button"
            onClick={newChat}
            className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] text-white"
          >
            新对话
          </button>
        </div>
      </div>

      {!aiReady ? (
        <p className="mb-3 rounded-xl bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-700">
          文本模型还没配置。在 <code className="rounded bg-white px-1">health-app/server/.env</code> 里填{' '}
          <code className="rounded bg-white px-1">AI_API_KEY</code> 后重启后端即可（如果已配视觉 Key，同一家厂商会自动复用）。
        </p>
      ) : null}

      {/* 消息区 */}
      <div className="flex-1 space-y-3">
        {messages.length === 0 && !streaming ? (
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
            <p className="text-[13px] font-medium text-slate-800">
              {ctx?.stats?.weight_kg
                ? `你好，我看到了你的记录：${ctx.stats.weight_kg} kg`
                : '你好，先聊聊你的目标吧'}
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-500">
              {ctx?.has_data
                ? '每次提问我都会带上你今天的热量、近 14 天体重围度和最近几天的饮食运动，答案会对着你的数据说。'
                : '现在记录还很少，答案会比较泛；先在「饮食」「运动」「身体」里记几笔，问起来就准了。'}
            </p>

            {suggestions.length ? (
              <div className="mt-3 space-y-2">
                {suggestions.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => send(q)}
                    className="block w-full rounded-xl bg-slate-50 px-3 py-2 text-left text-[12px] leading-relaxed text-slate-700 transition active:bg-slate-100"
                  >
                    {q}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {messages.map((m, i) => (
          <Bubble key={m.id ?? `m${i}`} role={m.role} content={m.content} />
        ))}

        {streaming ? <Bubble role="assistant" content={streaming} streaming /> : null}

        {busy && !streaming ? (
          <div className="flex items-center gap-2 text-[12px] text-slate-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            正在结合你的数据思考…
          </div>
        ) : null}

        {error ? (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-[11px] leading-relaxed text-rose-600">{error}</p>
        ) : null}

        <div ref={bottomRef} />
      </div>

      {/* 输入区 */}
      <div className="sticky bottom-0 mt-3 bg-slate-50/95 pb-1 pt-2 backdrop-blur">
        {busy ? (
          <button
            type="button"
            onClick={stop}
            className="mb-2 w-full rounded-xl border border-slate-300 py-2 text-[12px] text-slate-600"
          >
            停止生成
          </button>
        ) : null}
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            disabled={busy}
            placeholder="问点什么…比如「今晚还能吃多少」"
            className="max-h-28 min-h-[42px] flex-1 resize-none rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-[13px] leading-relaxed outline-none focus:border-emerald-400 disabled:bg-slate-100"
          />
          <button
            type="button"
            onClick={() => send()}
            disabled={busy || !input.trim()}
            className="h-[42px] shrink-0 rounded-2xl bg-emerald-600 px-4 text-[13px] font-medium text-white transition active:bg-emerald-700 disabled:bg-slate-300"
          >
            发送
          </button>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-slate-400">
          AI 建议仅供参考，涉及身体状况请咨询医生
        </p>
      </div>

      {/* 注入数据抽屉 */}
      <Sheet open={showCtx} title="这次注入给 AI 的数据" onClose={() => setShowCtx(false)}>
        <pre className="whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600">
          {ctx?.text || '加载中…'}
        </pre>
        {ctx?.missing?.length ? (
          <p className="mt-2 text-[11px] text-amber-600">还没记录：{ctx.missing.join('、')}</p>
        ) : null}
        <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
          每次提问都会重新读取，刚记完饮食再问也能拿到最新数字。
        </p>
      </Sheet>

      {/* 历史抽屉 */}
      <Sheet open={showHistory} title="历史对话" onClose={() => setShowHistory(false)}>
        {conversations.length === 0 ? (
          <p className="text-[12px] text-slate-400">还没有对话</p>
        ) : (
          <ul className="space-y-2">
            {conversations.map((c) => (
              <li
                key={c.id}
                className={`flex items-center gap-2 rounded-xl px-3 py-2.5 ${
                  c.id === convId ? 'bg-emerald-50' : 'bg-slate-50'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setConvId(c.id);
                    setShowHistory(false);
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-[12px] font-medium text-slate-800">{c.title}</p>
                  <p className="truncate text-[10px] text-slate-400">
                    {c.message_count} 条 · {c.last_message || '空'}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => removeConv(c.id)}
                  className="shrink-0 text-[11px] text-rose-500"
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </div>
  );
}
