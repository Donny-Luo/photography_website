// 用户个人中心逻辑
let currentUser = null;
let avatarCacheBuster = Date.now(); // 头像加 ?v= 防缓存

// 订阅功能关闭时：隐藏「订阅状态」标签页及其内容
if (!subscriptionEnabled()) {
  const subTab = document.querySelector('.profile-tab[data-tab="subscription"]');
  const subSection = document.getElementById('tab-subscription');
  if (subTab) subTab.style.display = 'none';
  if (subSection) subSection.classList.add('hidden');
}

// ===== Tab 切换 =====
document.querySelectorAll('.profile-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.profile-tab').forEach(t => {
      t.classList.remove('border-indigo-600', 'text-indigo-600');
      t.classList.add('border-transparent', 'text-gray-500');
    });
    tab.classList.add('border-indigo-600', 'text-indigo-600');
    tab.classList.remove('border-transparent', 'text-gray-500');

    document.querySelectorAll('.profile-content').forEach(c => c.classList.add('hidden'));
    document.getElementById('tab-' + tab.dataset.tab).classList.remove('hidden');
  });
});

// ===== 渲染头像 =====
function renderAvatar(user) {
  const letterEl = document.getElementById('avatarLetter');
  const imgEl = document.getElementById('avatarImg');
  const removeBtn = document.getElementById('avatarRemove');
  if (user.avatar) {
    imgEl.src = '/uploads/' + user.avatar + '?v=' + avatarCacheBuster;
    imgEl.classList.remove('hidden');
    letterEl.classList.add('hidden');
    removeBtn.classList.remove('hidden');
  } else {
    imgEl.classList.add('hidden');
    letterEl.classList.remove('hidden');
    letterEl.textContent = user.username[0].toUpperCase();
    removeBtn.classList.add('hidden');
  }
}

async function loadProfile() {
  try {
    currentUser = await api('/api/auth/me');
  } catch (err) {
    showMessage('请先登录', 'error');
    setTimeout(() => location.href = window.L('/login'), 1000);
    return;
  }

  document.getElementById('profileUsername').textContent = currentUser.username;
  document.getElementById('profileEmail').textContent = currentUser.email;
  document.getElementById('profileRole').textContent = currentUser.role === 'admin' ? '管理员' : '普通用户';
  document.getElementById('profileJoinDate').textContent = '注册于 ' + formatDate(currentUser.created_at);
  if (subscriptionEnabled() && currentUser.isSubscribed) {
    document.getElementById('profileSubStatus').classList.remove('hidden');
  }

  renderAvatar(currentUser);

  document.getElementById('newUsername').value = currentUser.username;
  document.getElementById('newEmail').value = currentUser.email;

  if (subscriptionEnabled()) renderSubscription();

  if (window.i18n) window.i18n.applyI18n();
}

function renderSubscription() {
  const info = document.getElementById('subscriptionInfo');
  if (currentUser.isSubscribed) {
    info.innerHTML = `
      <div class="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-6 mb-4">
        <div class="flex items-center gap-3 mb-3">
          <span class="text-3xl">✨</span>
          <div>
            <div class="font-bold text-amber-700">会员有效中</div>
            <div class="text-sm text-amber-600">至 ${formatDate(currentUser.subscriptionEnd)}</div>
          </div>
        </div>
      </div>
      <p class="text-sm text-gray-500">您已解锁全部付费作品，可查看高清原图。</p>
    `;
  } else {
    info.innerHTML = `
      <div class="bg-gray-50 border border-gray-200 rounded-xl p-6 mb-4 text-center">
        <div class="text-5xl mb-3">🔒</div>
        <div class="font-bold text-gray-700 mb-1">未订阅</div>
        <p class="text-sm text-gray-500 mb-4">订阅后可查看全部付费作品</p>
        <a href="${window.L('/subscribe')}" class="inline-block px-6 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg font-medium hover:opacity-90">立即订阅</a>
      </div>
    `;
  }
}

// ===== 头像上传 =====
document.getElementById('avatarInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showMessage('头像文件不能超过 2MB', 'error');
    return;
  }
  const fd = new FormData();
  fd.append('avatar', file);
  try {
    const data = await api('/api/auth/avatar', { method: 'POST', body: fd });
    avatarCacheBuster = Date.now();
    currentUser.avatar = data.avatar;
    renderAvatar(currentUser);
    showMessage('头像已更新', 'success');
  } catch (err) {
    showMessage(err.message, 'error');
  } finally {
    e.target.value = ''; // 允许重复选同一文件
  }
});

// 删除头像
document.getElementById('avatarRemove').addEventListener('click', async () => {
  if (!confirm('确定要删除头像吗？')) return;
  try {
    await api('/api/auth/avatar', { method: 'DELETE' });
    avatarCacheBuster = Date.now();
    currentUser.avatar = null;
    renderAvatar(currentUser);
    showMessage('已删除头像', 'success');
  } catch (err) {
    showMessage(err.message, 'error');
  }
});

// ===== 修改用户名 =====
document.getElementById('usernameForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const newUsername = document.getElementById('newUsername').value.trim();
  const msg = document.getElementById('usernameMsg');

  if (newUsername === currentUser.username) {
    msg.textContent = '用户名未变化';
    msg.className = 'mt-2 px-3 py-2 rounded-lg text-sm bg-gray-100 text-gray-600';
    msg.classList.remove('hidden');
    return;
  }

  try {
    const result = await api('/api/auth/change-username', {
      method: 'POST',
      body: { new_username: newUsername }
    });
    msg.textContent = '✅ ' + (result.message || '用户名修改成功');
    msg.className = 'mt-2 px-3 py-2 rounded-lg text-sm bg-green-50 text-green-700';
    msg.classList.remove('hidden');
    currentUser.username = result.username;
    document.getElementById('profileUsername').textContent = result.username;
    // 同步顶部卡片首字母
    if (!currentUser.avatar) document.getElementById('avatarLetter').textContent = result.username[0].toUpperCase();
    const navName = document.getElementById('userName');
    if (navName) navName.textContent = result.username;
  } catch (err) {
    msg.textContent = '❌ ' + err.message;
    msg.className = 'mt-2 px-3 py-2 rounded-lg text-sm bg-red-50 text-red-600';
    msg.classList.remove('hidden');
  }
});

// ===== 发送邮箱验证码 =====
let codeCountdown = 0;
let codeTimer = null;
document.getElementById('sendCodeBtn').addEventListener('click', async () => {
  const newEmail = document.getElementById('newEmail').value.trim();
  const btn = document.getElementById('sendCodeBtn');
  const msg = document.getElementById('emailMsg');
  msg.classList.add('hidden');

  if (!newEmail) {
    msg.textContent = '请先输入新邮箱';
    msg.className = 'mt-2 px-3 py-2 rounded-lg text-sm bg-red-50 text-red-600';
    msg.classList.remove('hidden');
    return;
  }
  if (newEmail === currentUser.email) {
    msg.textContent = '新邮箱不能与当前邮箱相同';
    msg.className = 'mt-2 px-3 py-2 rounded-lg text-sm bg-red-50 text-red-600';
    msg.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  try {
    const lang = window.i18n ? window.i18n.getLang() : 'en';
    const result = await api('/api/auth/send-email-code', {
      method: 'POST',
      body: { new_email: newEmail, purpose: 'change_email', lang }
    });
    let extra = '';
    if (result.devCode) extra = `\n🔧 验证码: ${result.devCode}`;
    msg.textContent = '✅ ' + (result.message || '验证码已发送') + extra;
    msg.className = 'mt-2 px-3 py-2 rounded-lg text-sm bg-green-50 text-green-700';
    msg.classList.remove('hidden');

    // 60 秒倒计时
    codeCountdown = 60;
    btn.textContent = `重新发送 (${codeCountdown}s)`;
    codeTimer = setInterval(() => {
      codeCountdown--;
      if (codeCountdown <= 0) {
        clearInterval(codeTimer);
        btn.disabled = false;
        btn.textContent = '发送验证码';
      } else {
        btn.textContent = `重新发送 (${codeCountdown}s)`;
      }
    }, 1000);
  } catch (err) {
    msg.textContent = '❌ ' + err.message;
    msg.className = 'mt-2 px-3 py-2 rounded-lg text-sm bg-red-50 text-red-600';
    msg.classList.remove('hidden');
    btn.disabled = false;
  }
});

// ===== 提交改邮箱 =====
document.getElementById('emailForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const newEmail = document.getElementById('newEmail').value.trim();
  const code = document.getElementById('emailCode').value.trim();
  const currentPwd = document.getElementById('emailCurrentPassword').value;
  const msg = document.getElementById('emailMsg');

  if (newEmail === currentUser.email) {
    msg.textContent = '邮箱未变化';
    msg.className = 'mt-2 px-3 py-2 rounded-lg text-sm bg-gray-100 text-gray-600';
    msg.classList.remove('hidden');
    return;
  }
  if (!code || code.length !== 6) {
    msg.textContent = '请输入 6 位验证码';
    msg.className = 'mt-2 px-3 py-2 rounded-lg text-sm bg-red-50 text-red-600';
    msg.classList.remove('hidden');
    return;
  }

  try {
    const result = await api('/api/auth/change-email', {
      method: 'POST',
      body: { new_email: newEmail, current_password: currentPwd, code }
    });
    msg.textContent = '✅ ' + (result.message || '邮箱修改成功');
    msg.className = 'mt-2 px-3 py-2 rounded-lg text-sm bg-green-50 text-green-700';
    msg.classList.remove('hidden');
    currentUser.email = result.email || newEmail;
    document.getElementById('profileEmail').textContent = currentUser.email;
    document.getElementById('emailCode').value = '';
    document.getElementById('emailCurrentPassword').value = '';
  } catch (err) {
    msg.textContent = '❌ ' + err.message;
    msg.className = 'mt-2 px-3 py-2 rounded-lg text-sm bg-red-50 text-red-600';
    msg.classList.remove('hidden');
  }
});

// ===== 修改密码 =====
document.getElementById('passwordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const oldPwd = document.getElementById('oldPassword').value;
  const newPwd = document.getElementById('newPassword').value;
  const confirmPwd = document.getElementById('confirmPassword').value;
  const msg = document.getElementById('passwordMsg');

  if (!oldPwd || !newPwd || !confirmPwd) {
    msg.textContent = '请填写所有字段';
    msg.className = 'px-3 py-2 rounded-lg text-sm bg-red-50 text-red-600';
    msg.classList.remove('hidden');
    return;
  }
  if (newPwd.length < 6) {
    msg.textContent = '新密码至少 6 位';
    msg.className = 'px-3 py-2 rounded-lg text-sm bg-red-50 text-red-600';
    msg.classList.remove('hidden');
    return;
  }
  if (newPwd !== confirmPwd) {
    msg.textContent = '两次输入的新密码不一致';
    msg.className = 'px-3 py-2 rounded-lg text-sm bg-red-50 text-red-600';
    msg.classList.remove('hidden');
    return;
  }

  try {
    await api('/api/auth/change-password', {
      method: 'POST',
      body: { old_password: oldPwd, new_password: newPwd }
    });
    msg.textContent = '✅ 密码修改成功！请重新登录';
    msg.className = 'px-3 py-2 rounded-lg text-sm bg-green-50 text-green-700';
    msg.classList.remove('hidden');
    showMessage('密码修改成功，即将登出', 'success');
    setTimeout(async () => {
      await api('/api/auth/logout', { method: 'POST' });
      location.href = window.L('/login');
    }, 2000);
  } catch (err) {
    msg.textContent = '❌ ' + (err.message || '修改失败');
    msg.className = 'px-3 py-2 rounded-lg text-sm bg-red-50 text-red-600';
    msg.classList.remove('hidden');
  }
});

document.addEventListener('DOMContentLoaded', loadProfile);