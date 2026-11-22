import { createHmac, timingSafeEqual } from 'node:crypto';
import { DomainError } from '../domain/errors.js';

function invalidTicket() {
  throw new DomainError('INVALID', 'This ticket code is invalid.');
}

function requireSecret(secret) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) {
    throw new DomainError(
      'VALIDATION',
      'TICKET_TOKEN_SECRET must contain at least 32 bytes.',
    );
  }
}

function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodePayload(segment) {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) invalidTicket();
  const decoded = Buffer.from(segment, 'base64url');
  if (decoded.toString('base64url') !== segment) invalidTicket();
  try {
    return JSON.parse(decoded.toString('utf8'));
  } catch {
    invalidTicket();
  }
}

function signatureFor(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest();
}

function validateClaims(reference, issuedAt) {
  if (
    typeof reference !== 'string'
    || reference.trim() === ''
    || !Number.isSafeInteger(issuedAt)
    || issuedAt < 0
  ) {
    throw new DomainError('VALIDATION', 'A booking reference and issued-at time are required.');
  }
}

export function signTicketToken(
  reference,
  secret = process.env.TICKET_TOKEN_SECRET,
  issuedAt = Math.floor(Date.now() / 1000),
) {
  requireSecret(secret);
  validateClaims(reference, issuedAt);
  const encodedPayload = encodePayload({ reference, iat: issuedAt });
  const signature = signatureFor(encodedPayload, secret).toString('base64url');
  return `${encodedPayload}.${signature}`;
}

export function verifyTicketToken(
  token,
  secret = process.env.TICKET_TOKEN_SECRET,
) {
  requireSecret(secret);
  if (typeof token !== 'string') invalidTicket();
  const segments = token.split('.');
  if (segments.length !== 2 || segments.some((segment) => segment.length === 0)) {
    invalidTicket();
  }

  const payload = decodePayload(segments[0]);
  if (
    payload === null
    || typeof payload !== 'object'
    || Array.isArray(payload)
    || Object.keys(payload).length !== 2
    || !Object.hasOwn(payload, 'reference')
    || !Object.hasOwn(payload, 'iat')
  ) {
    invalidTicket();
  }

  try {
    validateClaims(payload.reference, payload.iat);
  } catch {
    invalidTicket();
  }

  if (!/^[A-Za-z0-9_-]+$/.test(segments[1])) invalidTicket();
  const actualSignature = Buffer.from(segments[1], 'base64url');
  const expectedSignature = signatureFor(segments[0], secret);
  if (
    actualSignature.toString('base64url') !== segments[1]
    || actualSignature.length !== expectedSignature.length
    || !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    invalidTicket();
  }

  return { reference: payload.reference, iat: payload.iat };
}
