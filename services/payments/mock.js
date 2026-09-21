// services/payments/mock.js
// 默认/开发/演示支付：createOrder 立即返回 completed，路由层写库即生效。
// 真实环境下，把 PAYMENT_METHOD 切到 alipay/wechat/stripe，并装对应 SDK 后实现对应文件即可。

module.exports = {
  /**
   * 创建订单（mock：直接完成）
   */
  async createOrder({ orderId, userId, planKey, amount, currency }) {
    return {
      providerOrderId: `MOCK_${Date.now()}_${orderId}`,
      payUrl: null,
      qrCode: null,
      clientSecret: null,
      status: 'completed',
      raw: { mocked: true, orderId, userId, planKey, amount, currency, ts: Date.now() }
    };
  },

  /**
   * 异步通知校验（mock：永远返回成功）
   */
  async verifyCallback(rawBody /* , headers */) {
    return { orderId: null, providerOrderId: null, status: 'completed', amount: 0, currency: 'CNY', raw: rawBody };
  },

  /**
   * 退款（mock：直接成功）
   */
  async refund({ orderId }) {
    return { success: true, providerRefundId: `MOCK_REFUND_${orderId}`, raw: { mocked: true } };
  }
};
