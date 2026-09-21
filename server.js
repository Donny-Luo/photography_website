const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
// 可选加载 dotenv
try { require('dotenv').config(); } catch (e) {}

const { initDatabase } = require('./db/database');

const authRoutes = require('./routes/auth');
const photoRoutes = require('./routes/photos');
const categoryRoutes = require('./routes/categories');
const commentRoutes = require('./routes/comments');
const subscriptionRoutes = require('./routes/subscriptions');
const albumRoutes = require('./routes/albums');
const adminUserRoutes = require('./routes/adminUsers');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
// CORS：默认不启用跨域（前后端同源部署）。如需跨域，用 CORS_ORIGINS 环境变量配置白名单（逗号分隔）
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
if (allowedOrigins.length > 0) {
  app.use(cors({ origin: allowedOrigins, credentials: true }));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// 安全响应头（X-Frame-Options / CSP / nosniff 等）
app.use(require('./middleware/securityHeaders'));

// CSRF 防护（需在 cookieParser 之后）
app.use(require('./middleware/csrf'));

// API 路由（优先）
app.use('/api/auth', authRoutes);
app.use('/api/photos', photoRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/albums', albumRoutes);
app.use('/api/admin', adminUserRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 前端功能开关注入（如付费订阅开关）
app.get('/js/config.js', (req, res) => {
  const { SUBSCRIPTION_ENABLED } = require('./config');
  res.type('application/javascript');
  res.send(`window.APP_CONFIG = { subscriptionEnabled: ${SUBSCRIPTION_ENABLED} };`);
});

// 根路径 → 默认中文站
app.get('/', (req, res) => {
  // 优先尊重用户之前在本站点的语言选择（保存在 cookie 里）
  if (req.cookies && req.cookies.preferred_lang) {
    const saved = String(req.cookies.preferred_lang).toLowerCase();
    if (saved === 'en' || saved === 'zh') {
      return res.redirect(302, '/' + saved);
    }
  }
  // 否则默认中文
  res.redirect(302, '/zh');
});

// 静态资源
// 付费原图防直链：在静态服务前拦截 /uploads/<filename> 的付费照片
app.use(require('./middleware/premiumImageGuard'));
app.use(express.static(path.join(__dirname, 'public')));

// 页面映射
const PAGES = {
  '/': 'index.html',
  '/photo/:id': 'photo.html',
  '/login': 'login.html',
  '/register': 'register.html',
  '/forgot-password': 'forgot-password.html',
  '/reset-password': 'reset-password.html',
  '/subscribe': 'subscribe.html',
  '/albums': 'albums.html',
  '/album/:id': 'album.html',
  '/profile': 'profile.html'
};

// 后台（不带语言前缀，中文专用）
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// 处理 /zh/xxx 与 /en/xxx
['/', '/photo/:id', '/login', '/register', '/forgot-password', '/reset-password', '/subscribe', '/albums', '/album/:id', '/profile'].forEach(route => {
  const file = PAGES[route];
  ['zh', 'en'].forEach(lang => {
    const fullPath = `/${lang}${route === '/' ? '' : route}`;
    app.get(fullPath, (req, res) => {
      res.sendFile(path.join(__dirname, 'public', file));
    });
  });
});

// 无语言前缀的页面路由（兜底，默认跳中文版；如有 cookie 则按用户偏好）
['/photo/:id', '/login', '/register', '/forgot-password', '/reset-password', '/subscribe', '/albums', '/album/:id', '/profile'].forEach(route => {
  const file = PAGES[route];
  app.get(route, (req, res) => {
    let lang = 'zh'; // 默认中文
    if (req.cookies && req.cookies.preferred_lang) {
      const saved = String(req.cookies.preferred_lang).toLowerCase();
      if (saved === 'en' || saved === 'zh') lang = saved;
    }
    const suffix = route.includes(':id') ? '/' + req.params.id : '';
    res.redirect(302, `/${lang}${route.replace('/:id', suffix)}`);
  });
});

// 错误处理
app.use((err, req, res, next) => {
  // multer 错误（文件过大、格式不允许等）→ 返回友好中文提示
  if (err && err.name === 'MulterError') {
    let msg = '文件上传失败';
    if (err.code === 'LIMIT_FILE_SIZE') msg = '单张图片不能超过 10MB，请压缩后再上传';
    else if (err.code === 'LIMIT_FILE_COUNT') msg = '单次上传文件数量超过限制';
    else if (err.code === 'LIMIT_UNEXPECTED_FILE') msg = '上传字段名不正确';
    return res.status(400).json({ error: msg, code: err.code });
  }
  if (err && err.message && /只支持图片格式|头像仅支持|封面只支持/.test(err.message)) {
    // 我们自己的 fileFilter 抛出的友好提示，可安全返回
    return res.status(400).json({ error: err.message });
  }
  // 兜底：只记录完整错误到服务端日志，不向客户端泄露内部细节
  console.error('[服务器错误]', err);
  res.status(500).json({ error: '服务器内部错误，请稍后再试' });
});

async function start() {
  try {
    await initDatabase();
    app.listen(PORT, () => {
      console.log('═══════════════════════════════════════');
      console.log(`📸 Lumière Photography Blog 已启动`);
      console.log(`🌐 中文站: http://localhost:${PORT}/zh`);
      console.log(`🌐 English: http://localhost:${PORT}/en`);
      console.log(`🔧 后台管理: http://localhost:${PORT}/admin`);
      console.log('🔐 后台管理员账号通过 .env 的 ADMIN_EMAIL / ADMIN_PASSWORD 配置');
      console.log('═══════════════════════════════════════');
    });
  } catch (err) {
    console.error('启动失败:', err);
    process.exit(1);
  }
}

start();
