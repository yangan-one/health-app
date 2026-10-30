/**
 * AI 健康助手的提示词与消息拼装。
 *
 * 分层设计：
 *   system[0] = 角色与回答规则（稳定，便于模型缓存）
 *   system[1] = 用户当下的健康数据快照（每次请求都变）
 *   history   = 最近若干轮对话（保持连贯）
 *   user      = 本次提问
 *
 * 为什么数据快照单独放一条 system 而不是拼进用户问题：
 * 用户问题会随对话增长被淹没，而 system 位置对模型权重更高；
 * 同时前端也能把这段文本原样展示出来（「本次注入了哪些数据」），透明可查。
 */
export const COACH_SYSTEM_PROMPT = `你是一位私人健康管理助手，服务对象是同一个用户。你手上有他真实的饮食、运动、体测记录。

回答规则：
1. 先给结论，再给 2-4 条可执行建议。每条建议都要具体到「吃什么 / 做多久 / 什么时候」，不要写「保持均衡饮食」这种空话。
2. 只用【健康数据】里出现的数字。数据里没有的，就说「这项还没记录」，绝不编造热量、体重或围度。
3. 需要计算时先算再答，并把关键数字写出来（例如「目标 1650，已摄入 1200，还剩 450」）。
   注意「剩余额度」的口径是：每日目标 + 运动消耗 − 已摄入。数据里已经算好一行「今日还可摄入 X kcal」，直接引用它，不要自己改成「目标 − 摄入」。
   如果数据里写「今天还没有饮食记录」，说明是没记录而不是没吃东西，要提醒用户先记录，别断言他摄入 0。
4. 不做疾病诊断，不推荐药物或补剂剂量。涉及明显异常（如持续掉体重、体脂过低）时，建议就医。
5. 用中文口语回答，可以用短横线列表，不要用 Markdown 标题和表格。
6. 除非用户要求展开，回答控制在 250 字以内；用户问「为什么」时可以长一些。

风格：像一个懂营养学的朋友，直接、具体、不啰嗦，不说教。`;

/** 兜底：没有配置文本模型时，前端要显示的提示 */
export const NO_MODEL_HINT =
  '文本模型没配置好。请在 health-app/server/.env 里填 AI_API_KEY（如果已配视觉 Key，同一家厂商会自动复用）。';

/**
 * 把「历史 + 新问题」拼成 OpenAI 格式的 messages。
 * history 只取最近的，避免上下文无限膨胀（20 轮约 4000 字，够用了）。
 */
export function buildChatMessages({ contextText, history = [], question, maxHistory = 20 }) {
  const messages = [
    { role: 'system', content: COACH_SYSTEM_PROMPT },
    {
      role: 'system',
      content: `【健康数据】（系统自动读取，可直接引用）\n${contextText}`,
    },
  ];

  const tail = history
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content)
    .slice(-maxHistory)
    .map((m) => ({ role: m.role, content: m.content }));

  messages.push(...tail);
  if (question) messages.push({ role: 'user', content: question });
  return messages;
}

/**
 * 首轮对话的推荐问题：按「数据缺什么」动态生成，
 * 比写死 4 个固定问题更容易让人第一次就问到点子上。
 */
export function suggestQuestions({ stats = {}, missing = [] } = {}) {
  const out = [];
  if (missing.includes('今日饮食')) {
    out.push('我今天还没记录饮食，帮我安排一顿 500 kcal 左右的午餐');
  }
  if (stats.today_intake > 0 && stats.goal_calories) {
    const left = Math.round(stats.goal_calories - stats.today_intake + (stats.today_burn || 0));
    out.push(`我今天还剩 ${left} kcal 的额度，晚餐怎么吃比较合适？`);
  }
  if (stats.weight_kg) {
    out.push('结合我最近的体重和围度变化，我该怎么调整训练和饮食？');
  } else {
    out.push('我想开始减脂，第一周应该怎么记录和安排？');
  }
  out.push('我最近的蛋白质摄入够吗？不够的话吃什么补最快？');
  out.push('帮我按我的目标热量，列一份工作日的一天三餐');
  return out.slice(0, 4);
}
