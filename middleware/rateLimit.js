// 轻量内存限流器（单进程应用足够，无需额外依赖）
// 按 key（默认 IP）统计时间窗口内的请求次数，超限返回 429 + Retry-After
//
// 说明：生产环境若部署在反向代理之后，需在 server.js 中设置
//   app.set('trust proxy', 1)
// 才能让 req.ip 取到真实客户端 IP，否则会被限成代理 IP。

function createRateLimiter({ windowMs, max, message, keyFn }) {
  const buckets = new Map(); // key -> { count, resetAt }

  // 定期清理过期桶，避免内存无限增长
  const cleanup = () => {
    const now = Date.now();
    for (const [k, v] of buckets) {
      if (v.resetAt <= now) buckets.delete(k);
    }
  };
  const timer = setInterval(cleanup, Math.max(windowMs, 60 * 1000));
  timer.unref(); // 不阻塞进程退出

  return function rateLimit(req, res, next) {
    const key = keyFn ? keyFn(req) : req.ip;
    const now = Date.now();

    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }

    b.count++;

    if (b.count > max) {
      const retryAfter = Math.ceil((b.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: message || '请求过于频繁，请稍后再试' });
    }

    next();
  };
}

module.exports = createRateLimiter;
