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

export const config = Object.freeze({
  port: getPort(process.env.PORT),
});
