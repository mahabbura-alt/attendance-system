const crypto = require('crypto');

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
  next();
}

function requestId(req, res, next) {
  const incomingId = String(req.get('x-request-id') || '').trim();
  // Header ini hanya dipakai sebagai correlation ID; tidak dipakai untuk
  // otorisasi, ownership, atau keputusan bisnis apa pun.
  req.id = /^[A-Za-z0-9._:-]{8,128}$/.test(incomingId) ? incomingId : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

function requestTiming(req, res, next) {
  const startedAt = process.hrtime.bigint();
  const route = `${req.baseUrl || ''}${req.path || ''}`;
  const originalEnd = res.end;
  let finished = false;

  res.end = function instrumentedEnd(...args) {
    if (!finished) {
      finished = true;
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      if (!res.headersSent) {
        res.setHeader('Server-Timing', `app;dur=${durationMs.toFixed(1)}`);
      }
      res.locals.omosDurationMs = durationMs;
    }
    return originalEnd.apply(this, args);
  };

  res.on('finish', () => {
    const durationMs = Number(res.locals.omosDurationMs || 0);
    const level = durationMs >= 1000 || res.statusCode >= 500 ? 'warn' : 'info';
    console.log(JSON.stringify({
      level,
      event: 'http_request',
      request_id: req.id,
      method: req.method,
      route,
      status_code: res.statusCode,
      duration_ms: Number(durationMs.toFixed(1)),
    }));
  });
  next();
}

function createRateLimiter({ windowMs, max, key = (req) => req.ip, message }) {
  const hits = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const id = key(req) || 'unknown';
    const current = hits.get(id);
    const bucket = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : current;

    bucket.count += 1;
    hits.set(id, bucket);
    res.setHeader('RateLimit-Limit', max);
    res.setHeader('RateLimit-Remaining', Math.max(0, max - bucket.count));

    if (bucket.count > max) {
      res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000));
      return res.status(429).json({ error: message || 'Terlalu banyak permintaan. Coba lagi nanti.' });
    }
    next();
  };
}

module.exports = { securityHeaders, requestId, requestTiming, createRateLimiter };
