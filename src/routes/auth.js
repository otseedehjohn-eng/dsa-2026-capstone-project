import { DomainError } from '../domain/errors.js';
import { requireUser } from '../http/guards.js';

function requireBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new DomainError('VALIDATION', 'A JSON object body is required.');
  }
  return body;
}

export function registerAuthRoutes(router, authService, tokenSecret = process.env.JWT_SECRET) {
  router.add('POST', '/api/auth/signup', async ({ response, body }) => {
    const session = await authService.signup(requireBody(body));
    response.statusCode = 201;
    return session;
  });

  router.add('POST', '/api/auth/login', ({ body }) => (
    authService.login(requireBody(body))
  ));

  router.add('GET', '/api/auth/me', async ({ request }) => {
    const user = requireUser(request, tokenSecret);
    return { user: await authService.me(user.sub) };
  });
}
