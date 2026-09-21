const express = require('express');
const { db } = require('../db/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { SUBSCRIPTION_ENABLED } = require('../config');
const payments = require('../services/payments');

const router = express.Router();

// 订阅功能关闭时：停用用户侧订阅接口（套餐查询/订阅/状态）；管理侧订单/统计仍可用
if (!SUBSCRIPTION_ENABLED) {
  router.use(['/plans', '/subscribe', '/status'], (req, res) => {
    return res.status(403).json({ error: '订阅功能暂未开放' });
  });
}

// 订阅套餐定义：按货币分档（CNY 人民币 / USD 美元）
const PLANS = {
  monthly: {
    duration: 30,
    prices: {
      CNY: { amount: 12.99, currency: 'CNY', symbol: '¥' },
      USD: { amount: 1.99,  currency: 'USD', symbol: '$' }
    }
  },
  yearly: {
    duration: 365,
    prices: {
      CNY: { amount: 99,    currency: 'CNY', symbol: '¥' },
      USD: { amount: 19.99, currency: 'USD', symbol: '$' }
    }
  },
  lifetime: {
    duration: 36500,
    prices: {
      CNY: { amount: 999,   currency: 'CNY', symbol: '¥' },
      USD: { amount: 199,   currency: 'USD', symbol: '$' }
    }
  }
};

// 从请求中推断货币：query 参数 > Accept-Language 头
function detectCurrency(req) {
  if (req.query.currency && ['CNY', 'USD'].includes(req.query.currency.toUpperCase())) {
    return req.query.currency.toUpperCase();
  }
  if (req.query.lang === 'en') return 'USD';
  if (req.query.lang === 'zh') return 'CNY';
  const accept = (req.headers['accept-language'] || '').toLowerCase();
  if (accept.startsWith('zh')) return 'CNY';
  return 'USD';
}

// 获取套餐列表（支持按语言/货币返回）
router.get('/plans', (req, res) => {
  const currency = detectCurrency(req);
  const result = {};
  Object.keys(PLANS).forEach(key => {
    result[key] = {
      ...PLANS[key],
      ...PLANS[key].prices[currency]
    };
  });
  res.json({ currency, plans: result });
});

// 创建订阅订单（走支付抽象层：mock / alipay / wechat / stripe 任意一种）
router.post('/subscribe', authenticateToken, async (req, res) => {
  const { plan_type, currency } = req.body;

  if (!PLANS[plan_type]) {
    return res.status(400).json({ error: '套餐不存在' });
  }

  const cur = (currency && currency.toUpperCase() === 'USD') ? 'USD' : 'CNY';
  const priceInfo = PLANS[plan_type].prices[cur];
  const plan = { ...PLANS[plan_type], ...priceInfo };

  try {
    // 1. 先在数据库写一条 pending 订单（拿到 orderId）
    const orderId = await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO subscriptions (user_id, plan_type, amount, status, payment_method) VALUES (?, ?, ?, ?, ?)',
        [req.user.id, plan_type, plan.amount, 'pending', payments.method + '_' + cur],
        function(err) {
          if (err) return reject(err);
          resolve(this.lastID);
        }
      );
    });

    // 2. 调用支付抽象层创建支付订单
    const payResult = await payments.createOrder({
      orderId,
      userId: req.user.id,
      planKey: plan_type,
      amount: plan.amount,
      currency: cur,
      returnUrl: req.body.return_url,
      notifyUrl: process.env.PUBLIC_BASE_URL ? `${process.env.PUBLIC_BASE_URL}/api/subscriptions/callback` : undefined
    });

    // 3. mock 模式下立即完成：直接更新订阅到期时间
    if (payResult.status === 'completed') {
      const subscriptionEnd = new Date();
      subscriptionEnd.setDate(subscriptionEnd.getDate() + plan.duration);
      await new Promise((resolve, reject) => {
        db.run('UPDATE users SET subscription_end = ? WHERE id = ?',
          [subscriptionEnd.toISOString(), req.user.id],
          (err) => err ? reject(err) : resolve());
      });
      return res.json({
        success: true,
        order_id: orderId,
        provider_order_id: payResult.providerOrderId,
        status: 'completed',
        payment_method: payments.method,
        pay_url: payResult.payUrl,
        qr_code: payResult.qrCode,
        client_secret: payResult.clientSecret,
        subscription_end: subscriptionEnd,
        plan
      });
    }

    // 4. 真实支付（pending）：返回支付参数让前端跳转
    res.json({
      success: true,
      order_id: orderId,
      provider_order_id: payResult.providerOrderId,
      status: 'pending',
      payment_method: payments.method,
      pay_url: payResult.payUrl,
      qr_code: payResult.qrCode,
      client_secret: payResult.clientSecret,
      plan
    });
  } catch (e) {
    console.error('[subscribe] 创建订单失败：', e);
    res.status(500).json({ error: '创建订单失败：' + e.message });
  }
});

// 支付回调（异步通知，统一入口）
// 真实支付方式（alipay/wechat/stripe）会把 POST 请求发到这里，由支付抽象层校验签名
router.post('/callback', express.urlencoded({ extended: false }), express.json(), async (req, res) => {
  try {
    const result = await payments.verifyCallback(req.body, req.headers);
    if (result.status !== 'completed') {
      // 等待其他状态（如 TRADE_CLOSED 等）走对应分支
      return res.status(200).send('ok');
    }

    const orderId = result.orderId || req.body.out_trade_no;
    if (!orderId) {
      console.warn('[callback] 缺少订单号：', req.body);
      return res.status(400).send('missing order id');
    }

    // 幂等：把订阅订单标记为 completed
    db.get('SELECT user_id, plan_type FROM subscriptions WHERE id = ?', [orderId], (err, sub) => {
      if (err || !sub) {
        console.warn('[callback] 订单不存在：', orderId);
        return res.status(404).send('order not found');
      }
      // 取套餐时长
      const plan = PLANS[sub.plan_type];
      if (!plan) return res.status(400).send('plan not found');

      const subscriptionEnd = new Date();
      subscriptionEnd.setDate(subscriptionEnd.getDate() + plan.duration);

      db.serialize(() => {
        db.run('UPDATE subscriptions SET status = ? WHERE id = ?', ['completed', orderId]);
        db.run('UPDATE users SET subscription_end = ? WHERE id = ?',
          [subscriptionEnd.toISOString(), sub.user_id], () => {
            res.status(200).send('ok');
          });
      });
    });
  } catch (e) {
    console.error('[callback] 处理失败：', e);
    res.status(500).send('error');
  }
});

// 获取用户订阅状态
router.get('/status', authenticateToken, (req, res) => {
  db.get(
    'SELECT subscription_end FROM users WHERE id = ?',
    [req.user.id],
    (err, user) => {
      if (err) return res.status(500).json({ error: '服务器错误' });

      const isSubscribed = user && user.subscription_end && new Date(user.subscription_end) > new Date();
      res.json({
        isSubscribed,
        subscriptionEnd: user ? user.subscription_end : null
      });
    }
  );
});

// 获取所有订单（管理员）
router.get('/orders', authenticateToken, requireAdmin, (req, res) => {
  db.all(
    `SELECT s.*, u.username, u.email
     FROM subscriptions s
     LEFT JOIN users u ON s.user_id = u.id
     ORDER BY s.created_at DESC`,
    [],
    (err, orders) => {
      if (err) return res.status(500).json({ error: '服务器错误' });
      // 解析 payment_method 后缀获取货币
      orders.forEach(o => {
        if (o.payment_method && o.payment_method.includes('_')) {
          o.currency = o.payment_method.split('_').pop();
          o.payment_method = o.payment_method.split('_')[0];
        } else {
          o.currency = 'CNY';
        }
      });
      res.json(orders);
    }
  );
});

// 获取统计数据（管理员）
router.get('/stats', authenticateToken, requireAdmin, (req, res) => {
  const stats = {};

  db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
    stats.totalUsers = row ? row.count : 0;

    db.get('SELECT COUNT(*) as count FROM photos', (err, row) => {
      stats.totalPhotos = row ? row.count : 0;

      db.get('SELECT COUNT(*) as count FROM comments', (err, row) => {
        stats.totalComments = row ? row.count : 0;

        // 按货币分组统计营收
        db.all(
          `SELECT payment_method, amount FROM subscriptions WHERE status = 'completed'`,
          [],
          (err, rows) => {
            let totalCNY = 0, totalUSD = 0;
            (rows || []).forEach(r => {
              if (r.payment_method && r.payment_method.endsWith('_USD')) totalUSD += r.amount;
              else totalCNY += r.amount;
            });
            stats.totalRevenueCNY = +totalCNY.toFixed(2);
            stats.totalRevenueUSD = +totalUSD.toFixed(2);
            stats.totalRevenue = totalCNY; // 兼容旧字段（人民币）

            db.get('SELECT COUNT(*) as count FROM subscriptions WHERE status = "completed"', (err, row) => {
              stats.totalSubscriptions = row ? row.count : 0;
              res.json(stats);
            });
          }
        );
      });
    });
  });
});

module.exports = router;
