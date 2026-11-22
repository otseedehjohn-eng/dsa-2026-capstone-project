import { logIn, signUp } from '../api.js';
import { saveSession } from '../session.js';
import { getErrorMessage } from '../ui.js';

const loginForm = document.querySelector('#login-form');
const signupForm = document.querySelector('#signup-form');

function destination(user) {
  const requestedPath = new URLSearchParams(window.location.search).get('returnTo');
  if (requestedPath) {
    try {
      const target = new URL(requestedPath, window.location.origin);
      if (target.origin === window.location.origin) {
        return `${target.pathname}${target.search}${target.hash}`;
      }
    } catch {
      return '/';
    }
  }
  if (user.role === 'organizer') return '/organizer.html';
  if (user.role === 'attendee') return '/tickets.html';
  return '/';
}

function setLoading(form, status, loading, message) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = loading;
  button.textContent = loading ? 'Please wait…' : message;
  status.textContent = loading ? 'Working…' : '';
  status.classList.remove('status-error');
}

async function completeLogin(form, status, operation, buttonText) {
  setLoading(form, status, true, buttonText);
  try {
    const session = await operation();
    saveSession(session);
    form.reset();
    window.location.assign(destination(session.user));
  } catch (error) {
    status.textContent = getErrorMessage(error);
    status.classList.add('status-error');
    setLoading(form, status, false, buttonText);
  }
}

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const values = new FormData(loginForm);
  const status = document.querySelector('#login-status');
  completeLogin(
    loginForm,
    status,
    () => logIn({
      email: values.get('email'),
      password: values.get('password'),
    }),
    'Sign in',
  );
});

signupForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const values = new FormData(signupForm);
  const status = document.querySelector('#signup-status');
  completeLogin(
    signupForm,
    status,
    () => signUp({
      email: values.get('email'),
      password: values.get('password'),
      role: values.get('role'),
    }),
    'Create account',
  );
});
