// services/payments/alipay.js
// 支付宝接入模板 ——【待实现】
//
// 启用步骤：
//   1. npm install alipay-sdk   （沙箱装不上，请在本地装好后随项目部署）
//   2. 在 .env 中配置：
//        PAYMENT_METHOD=alipay
//        ALIPAY_APP_ID=2021000123456789
//        ALIPAY_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY----- ... -----END RSA PRIVATE KEY-----"
//        ALIPAY_ALIPAY_PUBLIC_KEY="-----BEGIN PUBLIC KEY----- ... -----END PUBLIC KEY-----"
//        ALIPAY_NOTIFY_URL=https://yourdomain.com/api/subscriptions/callback
//        ALIPAY_RETURN_URL=https://yourdomain.com/zh/profile?subscribed=1
//   3. 把下面函数体填充即可，路由层不需要改动。

/* eslint-disable no-unused-vars */
module.exports = {
  async createOrder({ orderId, userId, planKey, amount, currency, returnUrl, notifyUrl }) {
    // TODO: 调用 alipay-sdk 的 alipay.trade.page.pay 或 alipay.trade.precreate
    // const AlipaySdk = require('alipay-sdk').default;
    // const sdk = new AlipaySdk({
    //   appId: process.env.ALIPAY_APP_ID,
    //   privateKey: process.env.ALIPAY_APP_PRIVATE_KEY,
    //   alipayPublicKey: process.env.ALIPAY_ALIPAY_PUBLIC_KEY,
    // });
    // const result = await sdk.exec('alipay.trade.page.pay', {
    //   bizContent: {
    //     out_trade_no: String(orderId),
    //     product_code: 'FAST_INSTANT_TRADE_PAY',
    //     total_amount: amount.toFixed(2),
    //     subject: `订阅-${planKey}`,
    //   },
    //   notifyUrl: notifyUrl || process.env.ALIPAY_NOTIFY_URL,
    //   returnUrl: returnUrl || process.env.ALIPAY_RETURN_URL,
    // });
    // return {
    //   providerOrderId: String(orderId),
    //   payUrl: result,        // 页面跳转 URL
    //   qrCode: null,
    //   clientSecret: null,
    //   status: 'pending',     // 等待用户在支付宝页面完成支付
    //   raw: result,
    // };
    throw new Error('支付宝支付尚未实现，请参考注释步骤接入 alipay-sdk');
  },

  async verifyCallback(rawBody /* , headers */) {
    // TODO: 校验支付宝 POST 通知签名
    // const AlipaySdk = require('alipay-sdk').default;
    // const sdk = new AlipaySdk({ alipayPublicKey: process.env.ALIPAY_ALIPAY_PUBLIC_KEY });
    // const ok = sdk.checkNotifySign(rawBody);
    // if (!ok) throw new Error('支付宝回调签名校验失败');
    // return {
    //   orderId: rawBody.out_trade_no,
    //   providerOrderId: rawBody.trade_no,
    //   status: rawBody.trade_status === 'TRADE_SUCCESS' ? 'completed' : 'pending',
    //   amount: parseFloat(rawBody.total_amount),
    //   currency: 'CNY',
    //   raw: rawBody,
    // };
    throw new Error('支付宝回调校验尚未实现');
  },

  async refund({ orderId, providerOrderId, amount, reason }) {
    // TODO: alipay.trade.refund
    throw new Error('支付宝退款尚未实现');
  }
};
