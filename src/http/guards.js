import { DomainError } from '../domain/errors.js';
import { verifyToken } from '../lib/token.js';

export function requireUser(request, secret = process.env.JWT_SECRET) {
  const authorization = request.headers.authorization;
  const match = typeof authorization === 'string'
    ? /^Bearer\s+(\S+)$/i.exec(authorization)
    : null;
  if (!match) {
    throw new DomainError('UNAUTHENTICATED', 'A bearer token is required.');
  }
  return verifyToken(match[1], secret);
}

export function requireRole(user, ...allowedRoles) {
  if (!user || typeof user.sub !== 'string') {
    throw new DomainError('UNAUTHENTICATED', 'A valid bearer token is required.');
  }
  if (!allowedRoles.includes(user.role)) {
    throw new DomainError('FORBIDDEN', 'Your account does not have permission to do this.');
  }
  return user;
}
