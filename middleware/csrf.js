const crypto = require('crypto');

const COOKIE_NAME = 'csrf_token';
const HEADER_NAME = 'x-csrf-token';

// 只读方法不校验 CSRF
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// 双重提交 Cookie 方式的 CSRF 防护：
// 1. 给浏览器下发一个非 httpOnly 的 csrf_token cookie（前端 JS 可读取）
// 2. 写操作（POST/PUT/PATCH/DELETE）必须携带同名请求头，且与 cookie 一致
// 跨站攻击者无法读取本站 cookie，也无法随请求带上匹配的自定义头，因此无法伪造写操作
function csrfProtection(req, res, next) {
  // 确保浏览器持有 token（首次请求时下发）
  let token = req.cookies[COOKIE_NAME];
  if (!token) {
    token = crypto.randomBytes(24).toString('base64url');
    res.cookie(COOKIE_NAME, token, {
      httpOnly: false, // 前端需要读取
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 8 * 60 * 60 * 1000, // 8 小时
      path: '/'
    });
  }

  // 只读请求直接放行
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const headerToken = req.headers[HEADER_NAME];
  if (!headerToken || headerToken !== token) {
    return res.status(403).json({ error: 'CSRF 校验失败，请刷新页面后重试' });
  }

  next();
}

module.exports = csrfProtection;
