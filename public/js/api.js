import { clearSession, getToken } from './session.js';

async function request(path, { method = 'GET', body, authenticated = true } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const token = authenticated ? getToken() : null;
  if (token) headers.authorization = `Bearer ${token}`;

  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('The server returned an invalid response.');
  }

  if (!response.ok) {
    const detail = result?.error ?? { code: 'HTTP_ERROR', message: 'The request failed.' };
    if (detail.code === 'UNAUTHENTICATED') clearSession();
    const error = new Error(detail.message);
    error.code = detail.code;
    error.error = detail;
    error.status = response.status;
    throw error;
  }
  return result;
}

export function signUp(credentials) {
  return request('/api/auth/signup', {
    method: 'POST',
    body: credentials,
    authenticated: false,
  });
}

export function logIn(credentials) {
  return request('/api/auth/login', {
    method: 'POST',
    body: credentials,
    authenticated: false,
  });
}

export function getMe() {
  return request('/api/auth/me');
}

export function listEvents({
  q = '',
  city = '',
  maxPriceCents,
  sort = 'date',
} = {}) {
  const query = new URLSearchParams();
  if (q) query.set('q', q);
  if (city) query.set('city', city);
  if (maxPriceCents !== undefined) query.set('maxPriceCents', String(maxPriceCents));
  if (sort) query.set('sort', sort);
  return request(`/api/events?${query.toString()}`, { authenticated: false });
}

export function getEvent(eventId) {
  return request(`/api/events/${encodeURIComponent(eventId)}`, { authenticated: false });
}

export function createBooking(booking) {
  return request('/api/bookings', { method: 'POST', body: booking });
}

export function pay(reference, { decline = false } = {}) {
  return request(`/api/bookings/${encodeURIComponent(reference)}/pay`, {
    method: 'POST',
    body: { decline },
  });
}

export function cancelBooking(reference) {
  return request(`/api/bookings/${encodeURIComponent(reference)}/cancel`, {
    method: 'POST',
  });
}

export function listMyBookings() {
  return request('/api/bookings');
}

export function createEvent(details) {
  return request('/api/events', { method: 'POST', body: details });
}

export function addTier(eventId, details) {
  return request(`/api/events/${encodeURIComponent(eventId)}/tiers`, {
    method: 'POST',
    body: details,
  });
}

export function publishEvent(eventId) {
  return request(`/api/events/${encodeURIComponent(eventId)}/publish`, { method: 'POST' });
}

export function unpublishEvent(eventId) {
  return request(`/api/events/${encodeURIComponent(eventId)}/unpublish`, { method: 'POST' });
}

export function listOrganizerEvents() {
  return request('/api/organizer/events');
}
