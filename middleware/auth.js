const jwt = require('jsonwebtoken');
const { db } = require('../db/database');
const { SUBSCRIPTION_ENABLED } = require('../config');

const isProduction = process.env.NODE_ENV === 'production';

// JWT 密钥：生产环境必须通过环境变量显式提供，否则直接拒绝启动，避免弱密钥兜底
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (isProduction) {
    throw new Error('FATAL: 生产环境必须设置 JWT_SECRET 环境变量，请勿使用默认弱密钥');
  }
  // 仅限本地开发环境回退，切勿用于生产
  JWT_SECRET = 'dev-secret-not-for-production';
}

// 验证 JWT token
function authenticateToken(req, res, next) {
  const token = req.cookies.token || req.headers['authorization']?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: '未登录' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: '登录已过期，请重新登录' });
    }
    req.user = user;
    next();
  });
}

// 验证管理员权限（每次查库校验最新角色，确保管理员被降级后立即失去权限，而非等 token 过期）
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: '未登录' });
  }

  db.get('SELECT role FROM users WHERE id = ?', [req.user.id], (err, row) => {
    if (err) return res.status(500).json({ error: '服务器错误' });
    if (!row || row.role !== 'admin') {
      return res.status(403).json({ error: '需要管理员权限' });
    }
    // 同步数据库中的最新角色，供后续逻辑使用
    req.user.role = row.role;
    next();
  });
}

// 检查用户订阅状态
function checkSubscription(req, res, next) {
  if (!req.user) {
    return next();
  }

  db.get(
    'SELECT subscription_end FROM users WHERE id = ?',
    [req.user.id],
    (err, row) => {
      if (err) {
        console.error('检查订阅状态错误:', err);
        return next();
      }
      
      req.user.isSubscribed = row && row.subscription_end && new Date(row.subscription_end) > new Date();
      next();
    }
  );
}

// 可选鉴权：有 token 则解析并查询订阅状态；没有 token 也继续（用于公开内容 + 付费门控）
function optionalAuth(req, res, next) {
  const token = req.cookies.token || req.headers['authorization']?.split(' ')[1];

  if (!token) {
    req.user = null;
    return next();
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      req.user = null;
      return next();
    }
    req.user = user;
    db.get('SELECT role, subscription_end FROM users WHERE id = ?', [user.id], (e, row) => {
      if (e || !row) {
        req.user.isSubscribed = false;
        return next();
      }
      // 以数据库中的最新角色为准（防止被降级后仍按 token 里的旧 role 放行）
      req.user.role = row.role;
      req.user.isSubscribed = Boolean(row.subscription_end && new Date(row.subscription_end) > new Date());
      next();
    });
  });
}

// 判断当前请求是否能查看付费内容（管理员或有效订阅用户）
// 订阅功能关闭时，付费内容对所有访客免费可见
function canViewPremium(req) {
  if (!SUBSCRIPTION_ENABLED) return true;
  return Boolean(req.user && (req.user.role === 'admin' || req.user.isSubscribed));
}

module.exports = { authenticateToken, requireAdmin, checkSubscription, optionalAuth, canViewPremium, JWT_SECRET };
