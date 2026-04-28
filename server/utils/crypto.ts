/**
 * AES-256-GCM encryption for sensitive settings (API keys, secrets).
 *
 * Key source priority:
 *  1. ENCRYPTION_KEY environment variable (32-byte hex string)
 *  2. Auto-generated key persisted in data/.encryption_key
 *
 * Encrypted values are stored as: "enc:iv_hex:authTag_hex:ciphertext_hex"
 * Plain values pass through unchanged (for non-sensitive settings).
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const ALGORITHM = 'aes-256-gcm';
const ENC_PREFIX = 'enc:';

// Keys that must be encrypted at rest
export const SENSITIVE_KEYS = new Set([
  'anthropic_api_key',
  'openrouter_api_key',
  'openai_api_key',
  'google_api_key',
  'poe_api_key',
  'moonshot_api_key',
  'jwt_secret',
  'webhook_secret',
  'telegram_bot_token',
]);

// ─── Key management ───────────────────────────────────────────────────────────

let _encryptionKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (_encryptionKey) return _encryptionKey;

  // 1. From environment variable (32 hex bytes = 64 hex chars)
  if (process.env.ENCRYPTION_KEY) {
    const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
    if (key.length !== 32) {
      throw new Error('ENCRYPTION_KEY muss ein 64-stelliger Hex-String sein (32 Bytes)');
    }
    _encryptionKey = key;
    return key;
  }

  // 2. Auto-generated key in data/.encryption_key
  const keyFile = path.join(process.cwd(), 'data', '.encryption_key');
  if (fs.existsSync(keyFile)) {
    const hex = fs.readFileSync(keyFile, 'utf-8').trim();
    _encryptionKey = Buffer.from(hex, 'hex');
    return _encryptionKey;
  }

  // 3. Generate new key and persist it
  const newKey = crypto.randomBytes(32);
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(keyFile, newKey.toString('hex'), { mode: 0o600 }); // owner-only read
  console.log('🔑 Neuer Verschlüsselungsschlüssel generiert:', keyFile);

  _encryptionKey = newKey;
  return newKey;
}

// ─── Encrypt / Decrypt ────────────────────────────────────────────────────────

export function encryptValue(plaintext: string): string {
  if (!plaintext) return plaintext;
  if (plaintext.startsWith(ENC_PREFIX)) return plaintext; // already encrypted

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${ENC_PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptValue(ciphertext: string): string {
  if (!ciphertext) return ciphertext;
  if (!ciphertext.startsWith(ENC_PREFIX)) return ciphertext; // plain value

  const parts = ciphertext.slice(ENC_PREFIX.length).split(':');
  if (parts.length !== 3) throw new Error('Ungültiges verschlüsseltes Format');

  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString('utf-8');
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key);
}

// ─── Safe wrappers for settings read/write ────────────────────────────────────

export function encryptSetting(key: string, value: string): string {
  return isSensitiveKey(key) ? encryptValue(value) : value;
}

export function decryptSetting(key: string, value: string): string {
  return isSensitiveKey(key) ? decryptValue(value) : value;
}

// ─── Generate a new random encryption key (for setup scripts) ─────────────────
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString('hex');
}
