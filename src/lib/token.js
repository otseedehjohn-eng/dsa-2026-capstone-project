import { createHmac, timingSafeEqual } from 'node:crypto';
import { DomainError } from '../domain/errors.js';

const TOKEN_TTL_SECONDS = 60 * 60;
const ROLES = new Set(['attendee', 'organizer', 'staff']);

function unauthenticated() {
  throw new DomainError('UNAUTHENTICATED', 'A valid bearer token is required.');
}

function requireSecret(secret) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) {
    throw new DomainError('VALIDATION', 'JWT_SECRET must contain at least 32 bytes.');
  }
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeJson(segment) {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) unauthenticated();
  const decoded = Buffer.from(segment, 'base64url');
  if (decoded.toString('base64url') !== segment) unauthenticated();
  try {
    return JSON.parse(decoded.toString('utf8'));
  } catch {
    unauthenticated();
  }
}

function signatureFor(input, secret) {
  return createHmac('sha256', secret).update(input).digest();
}

export function signToken(claims, secret = process.env.JWT_SECRET, {
  expiresInSeconds = TOKEN_TTL_SECONDS,
  nowSeconds = Math.floor(Date.now() / 1000),
} = {}) {
  requireSecret(secret);
  if (
    claims === null
    || typeof claims !== 'object'
    || typeof claims.sub !== 'string'
    || claims.sub.length === 0
    || !ROLES.has(claims.role)
    || !Number.isSafeInteger(expiresInSeconds)
    || expiresInSeconds < 1
  ) {
    throw new DomainError('VALIDATION', 'Valid token claims and expiry are required.');
  }

  const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
  const payload = encodeJson({
    ...claims,
    iat: nowSeconds,
    exp: nowSeconds + expiresInSeconds,
  });
  const input = `${header}.${payload}`;
  const signature = signatureFor(input, secret).toString('base64url');
  return `${input}.${signature}`;
}

export function verifyToken(token, secret = process.env.JWT_SECRET, nowSeconds = Math.floor(Date.now() / 1000)) {
  requireSecret(secret);
  if (typeof token !== 'string') unauthenticated();
  const segments = token.split('.');
  if (segments.length !== 3 || segments.some((segment) => segment.length === 0)) unauthenticated();

  const header = decodeJson(segments[0]);
  if (header?.alg !== 'HS256') unauthenticated();
  const payload = decodeJson(segments[1]);
  if (
    typeof segments[2] !== 'string'
    || !/^[A-Za-z0-9_-]+$/.test(segments[2])
    || !ROLES.has(payload?.role)
    || typeof payload?.sub !== 'string'
    || payload.sub.length === 0
    || !Number.isSafeInteger(payload.exp)
    || payload.exp <= nowSeconds
  ) {
    unauthenticated();
  }

  const actualSignature = Buffer.from(segments[2], 'base64url');
  const expectedSignature = signatureFor(`${segments[0]}.${segments[1]}`, secret);
  if (
    actualSignature.toString('base64url') !== segments[2]
    || actualSignature.length !== expectedSignature.length
    || !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    unauthenticated();
  }

  return payload;
}
