import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { formatPrice } from '../public/js/ui.js';
import { createApp } from '../src/http/app.js';

test('naira formatting converts whole cents to readable currency', () => {
  assert.equal(formatPrice(250000), '₦2,500');
});

test('static server serves the public app pages, modules, and stylesheet', async (context) => {
  const server = createApp();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  for (const [pathname, contentType] of [
    ['/', /text\/html/],
    ['/event.html', /text\/html/],
    ['/login.html', /text\/html/],
    ['/tickets.html', /text\/html/],
    ['/organizer.html', /text\/html/],
    ['/checkin.html', /text\/html/],
    ['/js/api.js', /javascript/],
    ['/js/session.js', /javascript/],
    ['/js/pages/home.js', /javascript/],
    ['/js/pages/event.js', /javascript/],
    ['/js/pages/login.js', /javascript/],
    ['/js/pages/tickets.js', /javascript/],
    ['/js/pages/organizer.js', /javascript/],
    ['/js/pages/checkin.js', /javascript/],
    ['/css/styles.css', /text\/css/],
  ]) {
    const response = await fetch(`${baseUrl}${pathname}`);
    assert.equal(response.status, 200, pathname);
    assert.match(response.headers.get('content-type'), contentType);
  }
});
