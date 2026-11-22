import { DomainError } from './domain/errors.js';

function getPort(value) {
  if (value === undefined || value === '') {
    return 3000;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new DomainError('VALIDATION', 'PORT must be an integer from 1 to 65535.');
  }
  return port;
}

function getJwtSecret(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) < 32) {
    throw new DomainError('VALIDATION', 'Set JWT_SECRET to a secret of at least 32 bytes before starting the server.');
  }
  return value;
}

function getTicketTokenSecret(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) < 32) {
    throw new DomainError(
      'VALIDATION',
      'Set TICKET_TOKEN_SECRET to a different secret of at least 32 bytes before starting the server.',
    );
  }
  return value;
}

const jwtSecret = getJwtSecret(process.env.JWT_SECRET);
const ticketTokenSecret = getTicketTokenSecret(process.env.TICKET_TOKEN_SECRET);
if (jwtSecret === ticketTokenSecret) {
  throw new DomainError('VALIDATION', 'TICKET_TOKEN_SECRET must be different from JWT_SECRET.');
}

export const config = Object.freeze({
  port: getPort(process.env.PORT),
  jwtSecret,
  ticketTokenSecret,
});
