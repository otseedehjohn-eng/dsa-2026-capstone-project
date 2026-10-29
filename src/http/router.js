import { DomainError } from '../domain/errors.js';

function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new DomainError('BAD_REQUEST', 'The request path is malformed.');
  }
}

function compilePath(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new DomainError('VALIDATION', 'Route paths must start with "/".');
  }

  return path.split('/').map((segment) => {
    if (segment.startsWith(':')) {
      if (segment.length === 1) {
        throw new DomainError('VALIDATION', 'Route parameter names cannot be empty.');
      }
      return { parameter: segment.slice(1) };
    }
    return { value: decodeSegment(segment) };
  });
}

export class Router {
  #routes = [];

  add(method, path, handler) {
    if (typeof method !== 'string' || method.trim() === '') {
      throw new DomainError('VALIDATION', 'A route method is required.');
    }
    if (typeof handler !== 'function') {
      throw new DomainError('VALIDATION', 'A route handler must be a function.');
    }

    this.#routes.push({
      method: method.toUpperCase(),
      segments: compilePath(path),
      handler,
    });
    return this;
  }

  match(method, pathname) {
    const requestSegments = pathname.split('/').map(decodeSegment);

    for (const route of this.#routes) {
      if (route.method !== method.toUpperCase() || route.segments.length !== requestSegments.length) {
        continue;
      }

      const params = {};
      let matches = true;
      for (let index = 0; index < route.segments.length; index += 1) {
        const segment = route.segments[index];
        if ('parameter' in segment) {
          params[segment.parameter] = requestSegments[index];
        } else if (segment.value !== requestSegments[index]) {
          matches = false;
          break;
        }
      }

      if (matches) {
        return { handler: route.handler, params };
      }
    }

    return undefined;
  }
}

export function createRouter() {
  return new Router();
}
