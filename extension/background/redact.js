import { state } from './state.js';

export async function sha256Hex(input) {
  let data;
  if (typeof input === 'string') {
    data = new TextEncoder().encode(input);
  } else {
    data = input;
  }
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function maskEmail(str) {
  return str.replace(/([A-Za-z0-9._%+-])[^@\s]{2,}(@[^\s]+)/g, (m, p1, p2) => `${p1}***${p2}`);
}

function maskPhones(str) {
  return str.replace(/(\d{3})\d{3,}(\d{4})/g, (m, p1, p2) => `${p1}***${p2}`);
}

function maskDigits(str) {
  return maskPhones(str);
}

export async function redactString(str) {
  let out = maskEmail(str);
  out = maskDigits(out);
  const jwtRegex = /eyJ[^\.]+\.[^\.]+\.[^\s"']+/g;
  const matches = out.match(jwtRegex) || [];
  for (const token of matches) {
    let alg = 'unk';
    try {
      const header = JSON.parse(atob(token.split('.')[0]));
      alg = header.alg || 'unk';
    } catch {}
    const h = (await sha256Hex(token)).slice(0, 8);
    out = out.replace(token, `jwt.${alg}.${h}`);
  }
  return out;
}

export async function redactHeaders(headers = {}) {
  const redacted = {};
  for (const [name, value] of Object.entries(headers)) {
    const lname = name.toLowerCase();
    if (lname === 'cookie') {
      const parts = value.split(';').map((p) => p.trim());
      const masked = await Promise.all(
        parts.map(async (part) => {
          const [k, v] = part.split('=');
          if (!v) return k;
          const hash = (await sha256Hex(v.trim())).slice(0, 8);
          return `${k}=${`<${hash}>`}`;
        })
      );
      redacted[name] = masked.join('; ');
      state.counters.cookies_masked = (state.counters.cookies_masked || 0) + parts.length;
    } else if (lname === 'authorization') {
      const hash = (await sha256Hex(value.trim())).slice(0, 8);
      redacted[name] = value.startsWith('Bearer ')
        ? `Bearer <${hash}>`
        : `<${hash}>`;
    } else {
      redacted[name] = await redactString(value);
    }
  }
  return redacted;
}

export function maskQuery(query) {
  const out = {};
  const piiKeys = /(email|phone|token|auth|password)/i;
  for (const [k, v] of query.entries()) {
    out[k] = piiKeys.test(k) ? '<redacted>' : v;
  }
  return out;
}

export function templatePath(path) {
  return path
    .split('/')
    .map((seg) => {
      if (/^\d+$/.test(seg)) return ':id';
      if (/^[0-9a-fA-F-]{8,}$/.test(seg)) return ':uuid';
      return seg;
    })
    .join('/');
}

export async function prepareBody(body, isBase64) {
  if (state.dropBodies) {
    state.counters.dropped_bodies++;
    return { kind: 'none', size: 0 };
  }
  if (!body) {
    return { kind: 'none', size: 0 };
  }
  if (isBase64) {
    const bin = atob(body);
    const size = bin.length;
    const hash = await sha256Hex(new TextEncoder().encode(bin));
    return { kind: 'binary', size, hash };
  } else {
    const size = body.length;
    const truncated = body.slice(0, BODY_CAP);
    let sample = await redactString(truncated);
    if (size > BODY_CAP) {
      sample += '...<truncated>';
    }
    const hash = await sha256Hex(body);
    return { kind: 'text', size, hash, sample };
  }
}

const BODY_CAP = 128 * 1024; // 128KB
