import { describe, it, expect } from 'vitest';
import { quickSafetyCheck, validateOutput, sanitizeOutput } from './guardrails.js';

describe('Guardrails — validateOutput', () => {
  it('passes safe output', () => {
    const result = validateOutput('Hello world, this is a normal response.');
    expect(result.violations.filter(v => v.severity === 'critical' || v.severity === 'high')).toHaveLength(0);
  });

  it('detects PII (email) as high severity', () => {
    const result = validateOutput('Contact me at max@example.com for details.');
    expect(result.violations.some(v => v.type === 'pii_detected' && v.severity === 'high')).toBe(true);
  });

  it('detects secrets as critical severity', () => {
    const result = validateOutput('-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----');
    expect(result.violations.some(v => v.type === 'secret_detected' && v.severity === 'critical')).toBe(true);
  });

  it('blocks output with critical violations', () => {
    const result = validateOutput('-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----');
    expect(result.passed).toBe(false);
  });

  it('detects forbidden keywords', () => {
    const result = validateOutput('You should rm -rf / the system.', {
      forbiddenKeywords: ['rm -rf /', 'DROP TABLE'],
    });
    expect(result.violations.some(v => v.type === 'forbidden_keyword')).toBe(true);
  });

  it('validates JSON schema with required fields', () => {
    const result = validateOutput('{"name":"test","value":42}', {
      requireJsonSchema: { type: 'object' },
      requiredFields: ['name', 'value'],
    });
    expect(result.violations.filter(v => v.severity === 'critical' || v.severity === 'high')).toHaveLength(0);
  });

  it('fails invalid JSON when schema required', () => {
    const result = validateOutput('not json at all', {
      requireJsonSchema: { type: 'object' },
    });
    expect(result.violations.some(v => v.type === 'invalid_json')).toBe(true);
  });

  it('detects output too long as medium severity', () => {
    const result = validateOutput('a'.repeat(5000), {
      maxLength: 1000,
    });
    expect(result.violations.some(v => v.type === 'output_too_long' && v.severity === 'medium')).toBe(true);
  });
});

describe('Guardrails — quickSafetyCheck', () => {
  it('returns true for safe output', () => {
    expect(quickSafetyCheck('Hello world')).toBe(true);
  });

  it('returns false for output with secrets', () => {
    expect(quickSafetyCheck('password: supersecret12345678')).toBe(false);
  });
});

describe('Guardrails — sanitizeOutput', () => {
  it('redacts emails', () => {
    const result = sanitizeOutput('Contact me at user@example.com');
    expect(result).not.toContain('user@example.com');
    expect(result).toContain('[REDACTED-EMAIL]');
  });

  it('redacts long API keys', () => {
    const result = sanitizeOutput('key: abcdef1234567890abcdef1234567890');
    expect(result).toContain('[REDACTED-KEY]');
  });
});
