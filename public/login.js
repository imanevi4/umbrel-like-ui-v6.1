document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: form.get('username'), password: form.get('password') })
  });
  if (!res.ok) {
    document.getElementById('loginError').textContent = 'Неверный логин или пароль';
    return;
  }
  location.href = '/';
});
