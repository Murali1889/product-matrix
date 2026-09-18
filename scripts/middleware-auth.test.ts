import assert from 'node:assert/strict';
import 'next/dist/server/node-environment';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { config } from '../src/middleware';

const matches = (url: string) =>
  unstable_doesMiddlewareMatch({ config, nextConfig: {}, url });

// Dynamic API parameters must not inherit the public image-file exemption.
for (const suffix of ['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp']) {
  assert.equal(matches(`/api/client/security-audit.${suffix}`), true, suffix);
  assert.equal(matches(`/api/client/security-audit.${suffix}?view=details`), true);
}

for (const url of ['/api/analytics', '/api/matrix', '/api/auth/login', '/api/auth/callback']) {
  assert.equal(matches(url), true, url);
}

for (const url of ['/logo.png', '/favicon.ico', '/_next/static/chunks/app.js', '/_next/image']) {
  assert.equal(matches(url), false, url);
}

console.log('middleware auth matcher tests passed');
