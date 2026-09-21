// 当前货币（基于语言自动推断）
let currentCurrency = 'CNY';
let currentSymbol = '¥';

async function loadPlans() {
  try {
    // 从 URL 路径推断语言 → 货币
    const path = location.pathname;
    const lang = path.startsWith('/en') ? 'en' : 'zh';
    currentCurrency = lang === 'en' ? 'USD' : 'CNY';
    currentSymbol = currentCurrency === 'USD' ? '$' : '¥';

    const data = await api(`/api/subscriptions/plans?lang=${lang}`);
    // 接口返回 { currency, plans: { monthly, yearly, lifetime } }
    const plans = data.plans || data;
    const grid = document.getElementById('plansGrid');
    const order = ['monthly', 'yearly', 'lifetime'];
    const recommended = 'yearly';

    grid.innerHTML = order.map(key => {
      const p = plans[key];
      const isRec = key === recommended;
      const periodKey = key === 'lifetime' ? 'forever' : (key === 'yearly' ? 'year' : 'month');
      const priceDisplay = currentSymbol + Number(p.amount).toFixed(2);
      const currencyTag = currentCurrency; // CNY / USD

      return `
        <div class="relative bg-white rounded-2xl p-8 shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-2 ${isRec ? 'ring-2 ring-indigo-600 transform md:scale-105' : ''}">
          ${isRec ? `<span class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-full text-xs font-medium shadow-lg">${window.i18n.t('subscribe.recommended')}</span>` : ''}
          <h3 class="text-2xl font-bold mb-4 text-gray-900">${window.i18n.t('subscribe.' + key)}</h3>
          <div class="mb-2">
            <span class="text-5xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">${priceDisplay}</span>
            <span class="text-gray-400 ml-1">${window.i18n.t('subscribe.' + periodKey)}</span>
          </div>
          <p class="text-gray-500 mb-1 text-sm">${p.duration} ${window.i18n.t('subscribe.day')}</p>
          <p class="text-gray-400 mb-6 text-xs">${currencyTag}</p>
          <ul class="space-y-3 mb-8 text-sm text-gray-700">
            <li class="flex items-center gap-2"><span class="text-green-500">✓</span> ${window.i18n.t('subscribe.feature1')}</li>
            <li class="flex items-center gap-2"><span class="text-green-500">✓</span> ${window.i18n.t('subscribe.feature2')}</li>
            <li class="flex items-center gap-2"><span class="text-green-500">✓</span> ${window.i18n.t('subscribe.feature3')}</li>
            <li class="flex items-center gap-2"><span class="text-green-500">✓</span> ${window.i18n.t('subscribe.feature4')}</li>
          </ul>
          <button data-plan="${key}" class="subscribe-btn w-full py-3 ${isRec ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'} rounded-xl font-medium transition">
            ${window.i18n.t('subscribe.subscribeNow')}
          </button>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('button[data-plan]').forEach(btn => {
      btn.addEventListener('click', () => subscribe(btn.dataset.plan));
    });
  } catch (err) {
    showMessage('加载失败', 'error');
  }
}

async function checkStatus() {
  const user = await getCurrentUser();
  const statusEl = document.getElementById('currentStatus');
  if (!user) {
    statusEl.classList.remove('hidden');
    statusEl.innerHTML = `<p>${window.i18n.t('subscribe.loginFirst')} <a href="${L('/login')}" class="text-indigo-600 font-medium hover:underline">${window.i18n.t('subscribe.loginAndSubscribe')}</a> ${window.i18n.t('subscribe.afterLogin')}</p>`;
    return;
  }
  if (user.isSubscribed) {
    statusEl.classList.remove('hidden');
    statusEl.innerHTML = `<p>🎉 ${window.i18n.t('subscribe.currentMember')} <strong class="text-amber-600">${formatDate(user.subscriptionEnd)}</strong></p>`;
  }
}

async function subscribe(planType) {
  const user = await getCurrentUser();
  if (!user) {
    showMessage(window.i18n.t('subscribe.loginFirst'), 'error');
    setTimeout(() => location.href = window.L('/login'), 1000);
    return;
  }
  const planName = window.i18n.t('subscribe.' + planType);
  if (!confirm(window.i18n.t('subscribe.confirmTitle') + planName + window.i18n.t('subscribe.confirmSuffix') + '\n' + window.i18n.t('subscribe.confirmTip'))) return;
  try {
    await api('/api/subscriptions/subscribe', {
      method: 'POST',
      body: {
        plan_type: planType,
        payment_method: 'mock',
        currency: currentCurrency  // 告诉后端当前选用的货币
      }
    });
    showMessage(window.i18n.t('subscribe.success'), 'success');
    setTimeout(() => location.reload(), 1500);
  } catch (err) { showMessage(err.message, 'error'); }
}

// 订阅功能关闭时的页面呈现
function renderDisabled() {
  const msg = (window.i18n && window.i18n.t) ? window.i18n.t('subscribe.disabled') : '订阅功能暂未开放，敬请期待';
  const titleBlock = document.querySelector('main .text-center.mb-16');
  if (titleBlock) titleBlock.style.display = 'none';
  const grid = document.getElementById('plansGrid');
  if (grid) {
    grid.innerHTML = `<div style="grid-column:1/-1" class="text-center py-24 text-gray-500 text-lg">${msg}</div>`;
  }
  const notice = document.querySelector('main .bg-yellow-50');
  if (notice) notice.style.display = 'none';
}

document.addEventListener('DOMContentLoaded', () => {
  if (!subscriptionEnabled()) { renderDisabled(); return; }
  loadPlans();
  checkStatus();
});

document.addEventListener('langchange', () => {
  if (!subscriptionEnabled()) { renderDisabled(); return; }
  loadPlans();
  checkStatus();
});
