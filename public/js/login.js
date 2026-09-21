document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const errorMsg = document.getElementById('errorMsg');
  errorMsg.classList.add('hidden');
  try {
    const result = await api('/api/auth/login', {
      method: 'POST',
      body: { email: fd.get('email'), password: fd.get('password') }
    });
    showMessage(window.i18n.t('auth.loginSuccess'), 'success');
    setTimeout(() => {
      // 管理员跳到后台（后台不带语言前缀），普通用户回首页（带当前语言）
      if (result.user.role === 'admin') location.href = '/admin';
      else location.href = window.L('/');
    }, 500);
  } catch (err) {
    errorMsg.textContent = err.message;
    errorMsg.classList.remove('hidden');
  }
});
