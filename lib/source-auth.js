'use strict';

// A dedicated server-to-source credential. Never reuse the PIN, session key,
// or a cross-app consumer's narrower credential.
function sourceAuthConfigured(secret) {
  return typeof secret === 'string' && secret.trim().length >= 32;
}

module.exports = { sourceAuthConfigured };
