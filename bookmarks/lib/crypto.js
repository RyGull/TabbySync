// crypto.js — optional end-to-end encryption of the bookmark blob.
// AES-256-GCM with a key derived from the passphrase via PBKDF2-SHA256.
// The stored envelope is self-describing so any device with the passphrase
// can decrypt it. Runs in the service worker (WebCrypto).

const ITERATIONS = 200000;
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(bytes) {
  let s = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}
function unb64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase, salt) {
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// Returns an object envelope { enc:true, v, salt, iv, ct }.
export async function encryptJSON(obj, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const plaintext = enc.encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return { enc: true, v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

export function isEncrypted(payload) {
  return payload && typeof payload === 'object' && payload.enc === true && payload.ct;
}

export async function decryptJSON(envelope, passphrase) {
  const salt = unb64(envelope.salt);
  const iv = unb64(envelope.iv);
  const ct = unb64(envelope.ct);
  const key = await deriveKey(passphrase, salt);
  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  } catch (e) {
    throw new Error('Decryption failed — wrong passphrase?');
  }
  return JSON.parse(dec.decode(plaintext));
}
