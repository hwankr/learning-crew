/* 초대 토큰: base64url(memberId) + '.' + base64url(HMAC-SHA256(memberId, secret)).
   상태 없는 서명 토큰 — 폐기는 AUTH_SECRET 교체(전원 재초대)로 한다. */

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array | null {
  try {
    const bin = atob(s.replaceAll('-', '+').replaceAll('_', '/'));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function makeToken(memberId: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(memberId));
  return b64url(enc.encode(memberId).buffer as ArrayBuffer) + '.' + b64url(sig);
}

/** 유효하면 memberId, 아니면 null. 비교는 crypto.subtle.verify(상수 시간). */
export async function verifyToken(token: string, secret: string): Promise<string | null> {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const idBytes = b64urlDecode(token.slice(0, dot));
  const sigBytes = b64urlDecode(token.slice(dot + 1));
  if (!idBytes || !sigBytes) return null;
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify('HMAC', key, sigBytes.buffer as ArrayBuffer, idBytes.buffer as ArrayBuffer);
  return ok ? new TextDecoder().decode(idBytes) : null;
}
