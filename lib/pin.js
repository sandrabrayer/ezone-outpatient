'use strict';

const crypto = require('crypto');

/**
 * Constant-time PIN comparison. Fails closed: any non-string or empty
 * input (submitted or configured) is rejected without a timing-variable
 * compare.
 */
function checkPin(submitted, configured) {
  if (typeof submitted !== 'string' || typeof configured !== 'string') return false;
  if (!submitted || !configured) return false;

  const a = Buffer.from(submitted, 'utf8');
  const b = Buffer.from(configured, 'utf8');
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

module.exports = { checkPin };
