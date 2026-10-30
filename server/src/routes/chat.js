import { Router } from 'express';
import { db, DEFAULT_USER_ID } from '../db.js';
import { ApiError, parseDate, requireObject, todayLocal } from '../lib/util.js';
import { buildHealthContext } from '../lib/healthContext.js';
import { buildChatMessages, suggestQuestions } from '../lib/chatPrompt.js';
import { chatStream, publicAiConfig } from '../lib/ai.js';

const router = Router();

const MAX_QUESTION = 2000;

/** 取会话并校验归属（单用户，校验用户即可） */
function getConversation(id) {
  const convId = Number(id);
  if (!Number.isInteger(convId) || convId <= 0) throw new ApiError(400, '会话 id 不合法');
  const row = db
    .prepare('SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?')
    .get(convId, DEFAULT_USER_ID);
  if (!row) throw new ApiError(404, '会话不存在');
  return row;
}

function listMessages(convId, limit = 200) {
  return db
    .prepare(
      `SELECT id, role, content, tokens, created_at
       FROM ai_messages WHERE conversation_id = ?
       ORDER BY id ASC LIMIT ?`
    )
    .all(convId, limit);
}

function touchTitle(conv, question) {
  if (conv.title && conv.title.trim()) return conv.title;
  const title = question.replace(/\s+/g, ' ').slice(0, 24);
  db.prepare('UPDATE ai_conversations SET title = ? WHERE id = ?').run(title, conv.id);
  return title;
}

/**
 * GET /api/chat/context?date=YYYY-MM-DD
 * 把「这次会注入给模型的数据」直接给前端看，用户能确认 AI 到底知不知道自己的数据。
 */
router.get('/chat/context', (req, res) => {
  const date = parseDate(req.query.date);
  const ctx = buildHealthContext({ date });
  res.json({
    ok: true,
    data: {
      date,
      text: ctx.text,
      missing: ctx.missing,
      stats: ctx.stats,
      has_data: ctx.hasData,
      suggestions: suggestQuestions({ stats: ctx.stats, missing: ctx.missing }),
      ai: {
        configured: publicAiConfig().configured,
        model: publicAiConfig().model,
      },
    },
  });
});

/** GET /api/chat/conversations —— 历史会话列表（带最后一条消息摘要） */
router.get('/chat/conversations', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT c.id, c.title, c.created_at,
              (SELECT COUNT(*) FROM ai_messages m WHERE m.conversation_id = c.id) AS message_count,
              (SELECT content FROM ai_messages m WHERE m.conversation_id = c.id
                 ORDER BY m.id DESC LIMIT 1) AS last_message
       FROM ai_conversations c
       WHERE c.user_id = ?
       ORDER BY c.id DESC`
    )
    .all(DEFAULT_USER_ID)
    .map((r) => ({
      id: r.id,
      title: r.title || '新的对话',
      created_at: r.created_at,
      message_count: r.message_count,
      last_message: r.last_message ? r.last_message.slice(0, 60) : '',
    }));
  res.json({ ok: true, data: { conversations: rows } });
});

/** POST /api/chat/conversations —— 新建会话 */
router.post('/chat/conversations', (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 40) : '';
    const info = db
      .prepare('INSERT INTO ai_conversations (user_id, title) VALUES (?, ?)')
      .run(DEFAULT_USER_ID, title || null);
    const conv = db
      .prepare('SELECT * FROM ai_conversations WHERE id = ?')
      .get(Number(info.lastInsertRowid));
    res.status(201).json({ ok: true, data: { conversation: conv, messages: [] } });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/chat/conversations/:id —— 改标题 */
router.patch('/chat/conversations/:id', (req, res, next) => {
  try {
    const conv = getConversation(req.params.id);
    const body = requireObject(req.body);
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 40) : '';
    if (!title) throw new ApiError(400, '标题不能为空');
    db.prepare('UPDATE ai_conversations SET title = ? WHERE id = ?').run(title, conv.id);
    res.json({ ok: true, data: { id: conv.id, title } });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/chat/conversations/:id —— 删除会话（消息级联删除） */
router.delete('/chat/conversations/:id', (req, res, next) => {
  try {
    const conv = getConversation(req.params.id);
    db.prepare('DELETE FROM ai_conversations WHERE id = ?').run(conv.id);
    res.json({ ok: true, data: { id: conv.id, deleted: true } });
  } catch (err) {
    next(err);
  }
});

/** GET /api/chat/conversations/:id/messages */
router.get('/chat/conversations/:id/messages', (req, res, next) => {
  try {
    const conv = getConversation(req.params.id);
    res.json({ ok: true, data: { conversation: conv, messages: listMessages(conv.id) } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/chat/conversations/:id/messages
 * body: { content: string, stream?: boolean, date?: 'YYYY-MM-DD' }
 *
 * 每次请求都会重新读一遍健康数据（而不是建会话时缓存），
 * 这样用户刚记完饮食再问「我还能吃多少」，答案是最新的。
 *
 * stream=true 时用 SSE 逐字下发；默认 JSON 一次性返回（方便 curl 测试）。
 */
router.post('/chat/conversations/:id/messages', async (req, res, next) => {
  let conv;
  try {
    conv = getConversation(req.params.id);
    const body = requireObject(req.body);
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) throw new ApiError(400, '问题不能为空');
    if (content.length > MAX_QUESTION) {
      throw new ApiError(400, `问题太长了（最多 ${MAX_QUESTION} 字）`);
    }

    const date = parseDate(body.date ?? todayLocal(), 'date');
    const stream = body.stream === true;

    // 1. 先落库用户提问（即使模型失败也不丢用户的输入）
    db.prepare(
      `INSERT INTO ai_messages (conversation_id, role, content) VALUES (?, 'user', ?)`
    ).run(conv.id, content);
    touchTitle(conv, content);

    // 2. 组装上下文（历史不含刚才这条，避免重复）
    const history = listMessages(conv.id).slice(0, -1);
    const ctx = buildHealthContext({ date });
    const messages = buildChatMessages({ contextText: ctx.text, history, question: content });

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();
    }

    const send = (obj) => {
      if (!stream) return;
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    };

    // 客户端断开就中断上游请求，别让 token 白烧。
    // 注意必须监听 res 而不是 req：express.json() 读完 body 后 req 会立刻 emit 'close'，
    // 监听 req 会把每一次正常请求都当成「客户端断开」。
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    const result = await chatStream({
      messages,
      temperature: 0.5,
      maxTokens: 900,
      signal: controller.signal,
      onDelta: (delta) => send({ type: 'delta', delta }),
    });

    const answer = (result.content || '').trim();
    if (!answer) throw new ApiError(502, '模型没有返回任何内容，请重试');

    // 3. 落库回答
    const info = db
      .prepare(`INSERT INTO ai_messages (conversation_id, role, content, tokens) VALUES (?, 'assistant', ?, ?)`)
      .run(conv.id, answer, result.usage?.completion_tokens ?? null);

    const saved = {
      id: Number(info.lastInsertRowid),
      role: 'assistant',
      content: answer,
      tokens: result.usage?.completion_tokens ?? null,
    };

    if (stream) {
      send({
        type: 'done',
        message: saved,
        meta: {
          model: result.model,
          usage: result.usage ?? null,
          context_chars: ctx.text.length,
          derived_from_vision: result.derived_from_vision,
        },
      });
      res.end();
      return;
    }

    res.json({
      ok: true,
      data: {
        message: saved,
        meta: { model: result.model, usage: result.usage ?? null, context_chars: ctx.text.length },
      },
    });
  } catch (err) {
    // 已经进入流式响应：错误只能通过事件回传，不能再走统一错误处理
    if (res.headersSent) {
      res.write(
        `data: ${JSON.stringify({ type: 'error', message: err?.message || 'AI 回答失败' })}\n\n`
      );
      res.end();
      return;
    }
    next(err);
  }
});

export default router;
