// services/payments/stripe.js
// Stripe 接入模板 ——【待实现】
//
// 启用步骤：
//   1. npm install stripe
//   2. 在 .env 中配置：
//        PAYMENT_METHOD=stripe
//        STRIPE_SECRET_KEY=sk_live_xxx 或 sk_test_xxx
//        STRIPE_WEBHOOK_SECRET=whsec_xxx
//        STRIPE_PRICE_MONTHLY=price_xxx   // Stripe Dashboard 预创建的价格 ID
//        STRIPE_PRICE_YEARLY=price_xxx
//        STRIPE_PRICE_LIFETIME=price_xxx
//        PUBLIC_BASE_URL=https://yourdomain.com
//   3. 把下面函数体填充即可，路由层不需要改动。

/* eslint-disable no-unused-vars */
module.exports = {
  async createOrder({ orderId, userId, planKey, amount, currency, returnUrl }) {
    // TODO: 用 stripe.checkout.sessions.create 创建一次性支付页
    // const Stripe = require('stripe');
    // const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    // const priceMap = {
    //   monthly: process.env.STRIPE_PRICE_MONTHLY,
    //   yearly: process.env.STRIPE_PRICE_YEARLY,
    //   lifetime: process.env.STRIPE_PRICE_LIFETIME,
    // };
    // const session = await stripe.checkout.sessions.create({
    //   mode: 'payment',
    //   payment_method_types: ['card'],
    //   line_items: [{ price: priceMap[planKey], quantity: 1 }],
    //   success_url: `${process.env.PUBLIC_BASE_URL}${returnUrl || '/zh/profile?subscribed=1'}&session_id={CHECKOUT_SESSION_ID}`,
    //   cancel_url: `${process.env.PUBLIC_BASE_URL}/zh/subscribe?cancelled=1`,
    //   metadata: { orderId: String(orderId), userId: String(userId), planKey },
    // });
    // return {
    //   providerOrderId: session.id,
    //   payUrl: session.url,
    //   qrCode: null,
    //   clientSecret: null,
    //   status: 'pending',
    //   raw: session,
    // };
    throw new Error('Stripe 支付尚未实现，请参考注释步骤接入 stripe SDK');
  },

  async verifyCallback(rawBody, headers) {
    // TODO: 校验 webhook 签名
    // const Stripe = require('stripe');
    // const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    // const sig = headers['stripe-signature'];
    // const event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
    // if (event.type === 'checkout.session.completed') {
    //   const s = event.data.object;
    //   return {
    //     orderId: s.metadata.orderId,
    //     providerOrderId: s.id,
    //     status: 'completed',
    //     amount: s.amount_total / 100,
    //     currency: s.currency.toUpperCase(),
    //     raw: event,
    //   };
    // }
    // return { status: 'pending', raw: event };
    throw new Error('Stripe 回调校验尚未实现');
  },

  async refund({ providerOrderId, amount, reason }) {
    // TODO: stripe.refunds.create({ payment_intent: ..., amount: amount * 100, reason: 'requested_by_customer' })
    throw new Error('Stripe 退款尚未实现');
  }
};
