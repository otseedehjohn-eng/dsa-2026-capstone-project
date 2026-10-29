import { createServer } from 'node:http';
import { realpath, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DomainError } from '../domain/errors.js';
import { createRouter } from './router.js';

const publicDirectory = path.resolve(fileURLToPath(new URL('../../public/', import.meta.url)));
const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
]);
const MAX_JSON_BYTES = 1_048_576;

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function sendError(response, statusCode, code, message) {
  sendJson(response, statusCode, { error: { code, message } });
}

function statusForError(error) {
  if (error instanceof DomainError) {
    if (error.code === 'BAD_REQUEST') return 400;
    if (error.code === 'NOT_FOUND') return 404;
    return 400;
  }
  return 500;
}

async function readJsonBody(request) {
  const contentType = request.headers['content-type'] ?? '';
  if (contentType.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    return undefined;
  }

  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_JSON_BYTES) {
      throw new DomainError('BAD_REQUEST', 'JSON request body is too large.');
    }
    chunks.push(chunk);
  }

  if (bytes === 0) {
    return undefined;
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new DomainError('BAD_JSON', 'Request body must contain valid JSON.');
  }
}

async function serveStatic(pathname, response) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    throw new DomainError('BAD_REQUEST', 'The request path is malformed.');
  }

  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const requestedPath = path.resolve(publicDirectory, relativePath);
  const publicRealPath = await realpath(publicDirectory);
  let requestedRealPath;
  try {
    requestedRealPath = await realpath(requestedPath);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      sendError(response, 404, 'NOT_FOUND', 'The requested file was not found.');
      return;
    }
    throw error;
  }

  if (
    requestedRealPath !== publicRealPath
    && !requestedRealPath.startsWith(`${publicRealPath}${path.sep}`)
  ) {
    sendError(response, 404, 'NOT_FOUND', 'The requested file was not found.');
    return;
  }

  const file = await readFile(requestedRealPath);
  const contentType = MIME_TYPES.get(path.extname(requestedRealPath).toLowerCase())
    ?? 'application/octet-stream';
  response.writeHead(200, { 'content-type': contentType });
  response.end(file);
}

export function createApp() {
  const router = createRouter();
  router.add('GET', '/health', () => ({ status: 'ok' }));

  return createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, 'http://localhost');
      const body = await readJsonBody(request);
      const route = router.match(request.method ?? 'GET', requestUrl.pathname);

      if (route) {
        const result = await route.handler({
          request,
          response,
          params: route.params,
          query: requestUrl.searchParams,
          body,
        });
        if (!response.writableEnded) {
          sendJson(response, 200, result);
        }
        return;
      }

      if (requestUrl.pathname === '/api' || requestUrl.pathname.startsWith('/api/')) {
        sendError(response, 404, 'NOT_FOUND', 'The requested API route was not found.');
        return;
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendError(response, 404, 'NOT_FOUND', 'The requested route was not found.');
        return;
      }

      await serveStatic(requestUrl.pathname, response);
    } catch (error) {
      if (response.headersSent || response.writableEnded) {
        response.destroy(error);
        return;
      }
      const status = statusForError(error);
      if (error instanceof DomainError) {
        sendError(response, status, error.code, error.message);
      } else {
        sendError(response, 500, 'INTERNAL_ERROR', 'An unexpected server error occurred.');
      }
    }
  });
}
