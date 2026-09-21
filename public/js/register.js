document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const errorMsg = document.getElementById('errorMsg');
  errorMsg.classList.add('hidden');
  try {
    await api('/api/auth/register', {
      method: 'POST',
      body: {
        username: fd.get('username'),
        email: fd.get('email'),
        password: fd.get('password')
      }
    });
    showMessage(window.i18n.t('auth.registerSuccess'), 'success');
    setTimeout(() => location.href = window.L('/'), 1000);
  } catch (err) {
    errorMsg.textContent = err.message;
    errorMsg.classList.remove('hidden');
  }
});
