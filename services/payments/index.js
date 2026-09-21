// services/payments/index.js
// 支付抽象层：定义统一接口，由具体支付方式实现，路由层只调用这个工厂。
//
// 启动时根据环境变量 PAYMENT_METHOD 选择具体实现：
//   PAYMENT_METHOD=mock       → services/payments/mock.js （默认，立即成功）
//   PAYMENT_METHOD=alipay     → services/payments/alipay.js （待接入，需要 @alipay/sdk）
//   PAYMENT_METHOD=wechat     → services/payments/wechat.js （待接入，需要 wechatpay-node-v3）
//   PAYMENT_METHOD=stripe     → services/payments/stripe.js （待接入，需要 stripe）
//
// 切换支付方式 = 改环境变量 + 装对应 SDK + 写实现文件，路由层 0 改动。

const path = require('path');
const fs = require('fs');

// 防止重复 require 时的 hot reload 问题
function loadProvider(name) {
  const file = path.join(__dirname, `${name}.js`);
  if (!fs.existsSync(file)) {
    throw new Error(`未找到支付实现: ${file}\n请在 services/payments/ 下创建 ${name}.js`);
  }
  return require(file);
}

const method = (process.env.PAYMENT_METHOD || 'mock').toLowerCase();
let provider;
try {
  provider = loadProvider(method);
} catch (e) {
  console.error('[payments] ' + e.message);
  console.error('[payments] 已回退到 mock 实现');
  provider = loadProvider('mock');
}

// 接口契约（每个 provider 都必须实现）：
//   async createOrder({ orderId, userId, planKey, amount, currency, returnUrl, notifyUrl })
//     → { providerOrderId, payUrl | qrCode | clientSecret, status, raw? }
//   async verifyCallback(rawBody, headers)  // 异步通知校验签名
//     → { orderId, providerOrderId, status: 'completed' | 'failed', amount, currency, raw? }
//   async refund({ orderId, providerOrderId, amount, reason })
//     → { success, providerRefundId, raw? }
//
// status 统一：'pending' / 'completed' / 'failed'

module.exports = {
  method,
  createOrder: provider.createOrder,
  verifyCallback: provider.verifyCallback,
  refund: provider.refund
};
