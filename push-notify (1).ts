// Supabase Edge Function: push-notify
// Se dispara via Database Webhook cuando se inserta un mensaje
// Deploy: supabase functions deploy push-notify

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const VAPID_PUBLIC_KEY  = 'BDM_QhO9JkK2CuDeJCAsWQ3bhg1N1uz-KgtCt1iATny_CR1HSgt3-bMv8fVAkYB5dKx8jZuzi1-swcc_d6dvF8M';
const VAPID_PRIVATE_KEY = 'CR1HSgt3-bMv8fVAkYB5dKx8jZuzi1-swcc_d6dvF8M';
const VAPID_SUBJECT     = 'mailto:agusunx@outlook.es';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok');

  let body: any;
  try { body = await req.json(); } catch { return new Response('bad json', { status: 400 }); }

  // Webhook payload: { type: 'INSERT', record: { ... } }
  const record = body.record || body;
  const { to_id, from_id, type: msgType, content, reel_title } = record;
  if (!to_id) return new Response('no to_id');

  // Get push subscriptions for recipient
  const subRes = await fetch(
    `${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${to_id}&select=subscription`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const subs: { subscription: string }[] = await subRes.json();
  if (!subs.length) return new Response('no subscriptions');

  // Get sender name
  const profRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${from_id}&select=name`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const [sender] = await profRes.json();
  const senderName = sender?.name || 'Alguien';

  // Build notification payload
  let title = senderName;
  let body_text = '';
  let tag = 'msg';
  if (msgType === 'nudge') {
    title = '📳 Zumbido!';
    body_text = `${senderName} te mandó un zumbido`;
    tag = 'nudge';
  } else if (msgType === 'reel') {
    body_text = `🎬 ${reel_title || 'Te mandó un reel'}`;
  } else {
    body_text = (content || '').slice(0, 80);
  }

  const pushPayload = JSON.stringify({ title, body: body_text, tag, fromId: from_id });

  // Send to all subscriptions
  const results = await Promise.allSettled(
    subs.map(({ subscription }) => {
      const sub = JSON.parse(subscription);
      return sendWebPush(sub, pushPayload);
    })
  );

  const sent = results.filter(r => r.status === 'fulfilled').length;
  return new Response(JSON.stringify({ sent, total: subs.length }), {
    headers: { 'Content-Type': 'application/json' }
  });
});

// Web Push sender using VAPID — native Deno crypto
async function sendWebPush(subscription: any, payload: string) {
  const { endpoint, keys: { p256dh, auth } } = subscription;

  // Build VAPID JWT header + claims
  const origin = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const header = btoa(JSON.stringify({ typ: 'JWT', alg: 'ES256' })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const claims = btoa(JSON.stringify({ aud: origin, exp, sub: VAPID_SUBJECT })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const sigInput = `${header}.${claims}`;

  // Import private key
  const privBytes = base64url_decode(VAPID_PRIVATE_KEY);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', privBytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    new TextEncoder().encode(sigInput)
  );
  const jwt = `${sigInput}.${base64url_encode(sig)}`;

  // Encrypt payload using ECDH + AES-GCM (Web Push encryption)
  const encrypted = await encryptPayload(payload, p256dh, auth);

  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${jwt},k=${VAPID_PUBLIC_KEY}`,
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
    },
    body: encrypted,
  });
}

async function encryptPayload(payload: string, p256dhB64: string, authB64: string) {
  const payloadBytes = new TextEncoder().encode(payload);
  const p256dh = base64url_decode(p256dhB64);
  const auth = base64url_decode(authB64);

  // Generate sender key pair
  const senderKey = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const senderPubRaw = await crypto.subtle.exportKey('raw', senderKey.publicKey);

  // Import recipient public key
  const recipientKey = await crypto.subtle.importKey('raw', p256dh, { name: 'ECDH', namedCurve: 'P-256' }, false, []);

  // ECDH shared secret
  const sharedBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: recipientKey }, senderKey.privateKey, 256);

  // HKDF PRK
  const authKey = await crypto.subtle.importKey('raw', auth, 'HKDF', false, ['deriveBits']);
  const prk = await crypto.subtle.deriveBits({
    name: 'HKDF', hash: 'SHA-256',
    salt: new Uint8Array(sharedBits),
    info: buildInfo('auth', new Uint8Array(0), new Uint8Array(0)),
  }, authKey, 256);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prkKey = await crypto.subtle.importKey('raw', prk, 'HKDF', false, ['deriveBits']);
  const senderPubArr = new Uint8Array(senderPubRaw);

  const cekBits = await crypto.subtle.deriveBits({
    name: 'HKDF', hash: 'SHA-256', salt,
    info: buildInfo('aesgcm', p256dh, senderPubArr),
  }, prkKey, 128);
  const nonceBits = await crypto.subtle.deriveBits({
    name: 'HKDF', hash: 'SHA-256', salt,
    info: buildInfo('nonce', p256dh, senderPubArr),
  }, prkKey, 96);

  const cek = await crypto.subtle.importKey('raw', cekBits, 'AES-GCM', false, ['encrypt']);
  const record = new Uint8Array([...payloadBytes, 2]); // padding delimiter
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonceBits }, cek, record);

  // aes128gcm content encoding header
  const rs = 4096;
  const header = new Uint8Array(21 + senderPubArr.length);
  new DataView(header.buffer).setUint32(0, rs, false);
  header[4] = 0; header[5] = senderPubArr.length;
  header.set(salt, 0); // overwrite with salt first
  const result = new Uint8Array(salt.length + 5 + senderPubArr.length + encrypted.byteLength);
  result.set(salt, 0);
  const dv = new DataView(result.buffer);
  dv.setUint32(16, rs, false);
  result[20] = senderPubArr.length;
  result.set(senderPubArr, 21);
  result.set(new Uint8Array(encrypted), 21 + senderPubArr.length);
  return result;
}

function buildInfo(type: string, clientKey: Uint8Array, serverKey: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const base = enc.encode(`Content-Encoding: ${type}\0`);
  if (type === 'auth') return base;
  const context = new Uint8Array(base.length + 1 + 2 + clientKey.length + 2 + serverKey.length);
  context.set(base); let i = base.length;
  context[i++] = 0x50; context[i++] = 0x32; context[i++] = 0x35; context[i++] = 0x36; // "P256"
  new DataView(context.buffer).setUint16(base.length + 4, clientKey.length, false);
  i = base.length + 6; context.set(clientKey, i); i += clientKey.length;
  new DataView(context.buffer).setUint16(i, serverKey.length, false);
  context.set(serverKey, i + 2);
  return context;
}

function base64url_decode(s: string): Uint8Array {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - b.length % 4) % 4;
  return Uint8Array.from(atob(b + '='.repeat(pad)), c => c.charCodeAt(0));
}
function base64url_encode(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
