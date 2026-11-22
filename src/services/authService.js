import { DomainError } from '../domain/errors.js';
import { newId } from '../domain/ids.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { signToken } from '../lib/token.js';

const ROLES = new Set(['attendee', 'organizer', 'staff']);

function normalizeEmail(email) {
  if (typeof email !== 'string') {
    throw new DomainError('VALIDATION', 'A valid email address is required.');
  }
  const normalized = email.trim().toLocaleLowerCase();
  if (
    normalized.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    throw new DomainError('VALIDATION', 'A valid email address is required.');
  }
  return normalized;
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}

function invalidCredentials() {
  return new DomainError('INVALID_CREDENTIALS', 'Email or password is incorrect.');
}

export function createAuthService(repository, secret = process.env.JWT_SECRET, {
  tokenTtlSeconds = 60 * 60,
} = {}) {
  function createSession(user) {
    const safeUser = publicUser(user);
    return {
      user: safeUser,
      token: signToken({
        sub: user.id,
        email: user.email,
        role: user.role,
      }, secret, { expiresInSeconds: tokenTtlSeconds }),
    };
  }

  return {
    async signup({ email, password, role } = {}) {
      const normalizedEmail = normalizeEmail(email);
      if (
        typeof password !== 'string'
        || password.length < 8
        || password.length > 1024
      ) {
        throw new DomainError('VALIDATION', 'Password must be between 8 and 1024 characters.');
      }
      if (!ROLES.has(role)) {
        throw new DomainError('VALIDATION', 'Role must be attendee, organizer, or staff.');
      }
      if (await repository.findUserByEmail(normalizedEmail)) {
        throw new DomainError('EMAIL_TAKEN', 'That email is already registered.');
      }

      const user = {
        id: newId(),
        email: normalizedEmail,
        name: normalizedEmail.slice(0, normalizedEmail.indexOf('@')),
        role,
        passwordHash: await hashPassword(password),
      };
      try {
        const savedUser = await repository.saveUser(user);
        return createSession(savedUser);
      } catch (error) {
        if (error.code === 'EMAIL_TAKEN') {
          throw new DomainError('EMAIL_TAKEN', 'That email is already registered.');
        }
        throw error;
      }
    },

    async login({ email, password } = {}) {
      if (typeof email !== 'string' || typeof password !== 'string') {
        throw invalidCredentials();
      }
      const user = await repository.findUserByEmail(email.trim().toLocaleLowerCase());
      if (!user || typeof user.passwordHash !== 'string') {
        throw invalidCredentials();
      }
      if (!await verifyPassword(password, user.passwordHash)) {
        throw invalidCredentials();
      }
      return createSession(user);
    },

    async me(userId) {
      const user = await repository.findUserById(userId);
      if (!user) {
        throw new DomainError('UNAUTHENTICATED', 'This account is no longer available.');
      }
      return publicUser(user);
    },
  };
}
