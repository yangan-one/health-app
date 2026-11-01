/**
 * 当前请求的「用户上下文」。
 *
 * 为什么要这层：所有 SQL 都需要按 user_id 过滤，如果每个路由函数都手动传一遍
 * userId，30 多个查询点很容易漏掉一个 → 就变成「A 能看到 B 的数据」。
 * 这里用 AsyncLocalStorage 把 userId 挂在请求上下文上，
 * 业务代码统一调用 currentUserId()，就不会漏。
 *
 * 不在请求上下文里调用（CLI 脚本、测试）时，回退到传进来的 fallback。
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

/** 在指定用户身份下执行后续中间件/处理函数 */
export function runAsUser(userId, fn) {
  return storage.run({ userId }, fn);
}

/** 取当前请求的用户 id；没有上下文返回 fallback */
export function currentUserId(fallback = null) {
  const store = storage.getStore();
  const id = Number(store?.userId);
  return Number.isInteger(id) && id > 0 ? id : fallback;
}
