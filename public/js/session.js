const TOKEN_KEY = 'event-ticketing.token';
const USER_KEY = 'event-ticketing.user';

function sessionStore() {
  return globalThis.sessionStorage ?? null;
}

export function getToken() {
  return sessionStore()?.getItem(TOKEN_KEY) ?? null;
}

export function getCurrentUser() {
  const store = sessionStore();
  const value = store?.getItem(USER_KEY);
  if (!value) return null;
  try {
    const user = JSON.parse(value);
    if (
      typeof user.id !== 'string'
      || typeof user.email !== 'string'
      || !['attendee', 'organizer', 'staff'].includes(user.role)
    ) {
      clearSession();
      return null;
    }
    return user;
  } catch {
    clearSession();
    return null;
  }
}

export function saveSession(session) {
  if (
    !session
    || typeof session.token !== 'string'
    || typeof session.user?.id !== 'string'
    || !['attendee', 'organizer', 'staff'].includes(session.user.role)
  ) {
    throw new TypeError('A valid user and token are required.');
  }

  const store = sessionStore();
  if (!store) {
    throw new Error('This browser cannot store a sign-in session.');
  }
  store.setItem(TOKEN_KEY, session.token);
  store.setItem(USER_KEY, JSON.stringify({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
  }));
}

export function clearSession() {
  const store = sessionStore();
  if (!store) return;
  store.removeItem(TOKEN_KEY);
  store.removeItem(USER_KEY);
}
