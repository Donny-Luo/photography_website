// 安全响应头中间件（等价于 helmet 的核心能力，无需外部依赖）
// 说明：CSP 已按站点实际情况放开必要的内联脚本/事件/图片来源；
// 若后续把内联 <script> 与 onclick 都改成外部脚本，可进一步收紧 script-src。

const isProduction = process.env.NODE_ENV === 'production';

// 内容安全策略：贴合当前站点（内联脚本 + 内联事件 + data:/blob: 图片 + 同源接口）
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "script-src-attr 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'"
].join('; ');

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', CSP);

  // HSTS 仅在 HTTPS 生产环境生效（避免开发环境强制 HTTPS）
  if (isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }

  next();
}

module.exports = securityHeaders;
