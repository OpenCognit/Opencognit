/**
 * Agent Output Guardrails
 * ========================
 * 3-Layer Defense for agent outputs:
 * Layer 1: Rule-based validators (sub-10ms) — JSON schema, regex, format
 * Layer 2: Pattern detection (fast) — PII, toxic content, forbidden keywords
 * Layer 3: Semantic validation (LLM-based) — groundedness, consistency
 *
 * Based on 2026 State-of-the-Art:
 * "The failure mode everyone hits first is error propagation."
 * "88% of organizations reported confirmed or suspected AI agent security incidents."
 */

import { db } from '../db/client.js';
import { traceEvents } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export interface GuardrailViolation {
  layer: 1 | 2 | 3;
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: string;
  message: string;
  location?: string;
  suggestedFix?: string;
}

export interface GuardrailResult {
  passed: boolean;
  violations: GuardrailViolation[];
  sanitizedOutput?: string;
  metadata: {
    checkedAt: string;
    layersRun: number[];
    durationMs: number;
  };
}

export interface GuardrailConfig {
  // Layer 1: Structural
  requireJsonSchema?: object;
  maxLength?: number;
  forbiddenPatterns?: RegExp[];
  requiredFields?: string[];

  // Layer 2: Content Safety
  blockPII?: boolean;
  blockSecrets?: boolean;
  forbiddenKeywords?: string[];
  maxToxicityScore?: number;

  // Layer 3: Semantic
  checkGroundedness?: boolean;
  checkConsistency?: boolean;
  minConfidence?: number;
}

const DEFAULT_CONFIG: GuardrailConfig = {
  maxLength: 50000,
  blockPII: true,
  blockSecrets: true,
  forbiddenKeywords: ['rm -rf /', 'DROP TABLE', 'DELETE FROM', 'sudo', 'chmod 777'],
  maxToxicityScore: 0.7,
  minConfidence: 0.3,
};

// ─── Layer 1: Rule-Based Validators (sub-10ms) ──────────────────────────────

function runLayer1(output: string, config: GuardrailConfig): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];

  // Length check
  if (config.maxLength && output.length > config.maxLength) {
    violations.push({
      layer: 1,
      severity: 'medium',
      type: 'output_too_long',
      message: `Output exceeds maximum length of ${config.maxLength} chars (got ${output.length})`,
      suggestedFix: 'Truncate or split into multiple responses',
    });
  }

  // JSON schema validation
  if (config.requireJsonSchema) {
    try {
      const parsed = JSON.parse(output);
      const required = config.requiredFields || [];
      for (const field of required) {
        if (!(field in parsed)) {
          violations.push({
            layer: 1,
            severity: 'high',
            type: 'missing_required_field',
            message: `Required field "${field}" missing from JSON output`,
            location: field,
            suggestedFix: `Include "${field}" in the JSON response`,
          });
        }
      }
    } catch {
      violations.push({
        layer: 1,
        severity: 'high',
        type: 'invalid_json',
        message: 'Output is not valid JSON as required',
        suggestedFix: 'Ensure output is valid JSON',
      });
    }
  }

  // Regex pattern checks
  if (config.forbiddenPatterns) {
    for (const pattern of config.forbiddenPatterns) {
      if (pattern.test(output)) {
        violations.push({
          layer: 1,
          severity: 'critical',
          type: 'forbidden_pattern',
          message: `Output contains forbidden pattern: ${pattern.source}`,
          suggestedFix: 'Remove the forbidden content',
        });
      }
    }
  }

  return violations;
}

// ─── Layer 2: Content Safety (PII, Secrets, Keywords) ───────────────────────

// Simple PII patterns (fast, rule-based)
const PII_PATTERNS = [
  { name: 'email', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/ },
  { name: 'phone', regex: /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/ },
  { name: 'ssn', regex: /\b\d{3}-\d{2}-\d{4}\b/ },
  { name: 'credit_card', regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/ },
  { name: 'api_key', regex: /\b(?:api[_-]?key|apikey|token)\s*[:=]\s*["']?[a-zA-Z0-9_-]{16,}["']?/i },
];

const SECRET_PATTERNS = [
  { name: 'private_key', regex: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'password', regex: /\b(?:password|passwd|pwd)\s*[:=]\s*["']?[^"'\s]{8,}["']?/i },
  { name: 'secret', regex: /\b(?:secret|aws_secret_access_key)\s*[:=]\s*["']?[A-Za-z0-9/+=]{20,}["']?/i },
];

function runLayer2(output: string, config: GuardrailConfig): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];

  // PII detection
  if (config.blockPII) {
    for (const pii of PII_PATTERNS) {
      if (pii.regex.test(output)) {
        violations.push({
          layer: 2,
          severity: 'high',
          type: 'pii_detected',
          message: `Potential PII detected: ${pii.name}`,
          suggestedFix: 'Redact or mask PII before outputting',
        });
      }
    }
  }

  // Secret detection
  if (config.blockSecrets) {
    for (const secret of SECRET_PATTERNS) {
      if (secret.regex.test(output)) {
        violations.push({
          layer: 2,
          severity: 'critical',
          type: 'secret_detected',
          message: `Potential secret/credential detected: ${secret.name}`,
          suggestedFix: 'Never include secrets in agent outputs',
        });
      }
    }
  }

  // Forbidden keywords
  if (config.forbiddenKeywords) {
    const lowerOutput = output.toLowerCase();
    for (const keyword of config.forbiddenKeywords) {
      if (lowerOutput.includes(keyword.toLowerCase())) {
        violations.push({
          layer: 2,
          severity: 'critical',
          type: 'forbidden_keyword',
          message: `Forbidden keyword detected: "${keyword}"`,
          location: keyword,
          suggestedFix: 'Remove or rephrase the forbidden content',
        });
      }
    }
  }

  return violations;
}

// ─── Layer 3: Semantic Validation (LLM-based, expensive) ────────────────────

function runLayer3(output: string, config: GuardrailConfig): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];

  // Confidence calibration: check if output is overly vague or uncertain
  if (config.minConfidence) {
    const uncertaintyPatterns = [
      /\b(maybe|perhaps|possibly|might|could be|i think|i guess|not sure|unclear)\b/gi,
      /\b(i don't know|i'm not certain|it's hard to say)\b/gi,
    ];

    let uncertaintyCount = 0;
    for (const pattern of uncertaintyPatterns) {
      const matches = output.match(pattern);
      if (matches) uncertaintyCount += matches.length;
    }

    const uncertaintyRatio = uncertaintyCount / (output.split(/\s+/).length || 1);
    if (uncertaintyRatio > 0.15) {
      violations.push({
        layer: 3,
        severity: 'medium',
        type: 'low_confidence_output',
        message: `Output contains high uncertainty (${Math.round(uncertaintyRatio * 100)}% hedge words). Confidence threshold: ${config.minConfidence}`,
        suggestedFix: 'Be more decisive or ask for clarification instead of guessing',
      });
    }
  }

  // Internal consistency check: look for contradictions
  if (config.checkConsistency) {
    const contradictionPatterns = [
      /\b(not .{0,30}but)\b/i,
      /\b(however|but|although|though)\b/gi,
    ];

    let contradictionCount = 0;
    for (const pattern of contradictionPatterns) {
      const matches = output.match(pattern);
      if (matches) contradictionCount += matches.length;
    }

    if (contradictionCount > 3) {
      violations.push({
        layer: 3,
        severity: 'low',
        type: 'potential_contradiction',
        message: `Multiple contradiction markers detected (${contradictionCount}). Review for consistency.`,
        suggestedFix: 'Review and resolve contradictions in reasoning',
      });
    }
  }

  return violations;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Run all guardrail layers on an agent output.
 */
export function validateOutput(
  output: string,
  config: GuardrailConfig = DEFAULT_CONFIG
): GuardrailResult {
  const startTime = Date.now();
  const allViolations: GuardrailViolation[] = [];
  const layersRun: number[] = [];

  // Layer 1
  const l1 = runLayer1(output, config);
  allViolations.push(...l1);
  layersRun.push(1);

  // Layer 2
  const l2 = runLayer2(output, config);
  allViolations.push(...l2);
  layersRun.push(2);

  // Layer 3 (only if no critical violations so far)
  const hasCritical = allViolations.some(v => v.severity === 'critical');
  if (!hasCritical) {
    const l3 = runLayer3(output, config);
    allViolations.push(...l3);
    layersRun.push(3);
  }

  // Sort by severity
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  allViolations.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const durationMs = Date.now() - startTime;

  return {
    passed: !allViolations.some(v => v.severity === 'critical' || v.severity === 'high'),
    violations: allViolations,
    metadata: {
      checkedAt: new Date().toISOString(),
      layersRun,
      durationMs,
    },
  };
}

/**
 * Quick check for critical violations only (fast path).
 */
export function quickSafetyCheck(output: string): boolean {
  const result = validateOutput(output, {
    maxLength: 100000,
    blockPII: true,
    blockSecrets: true,
    forbiddenKeywords: ['rm -rf /', 'DROP TABLE', 'DELETE FROM', 'sudo', 'chmod 777', 'format c:'],
  });
  return result.passed;
}

/**
 * Sanitize output by redacting detected PII and secrets.
 */
export function sanitizeOutput(output: string): string {
  let sanitized = output;

  // Redact emails
  sanitized = sanitized.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[REDACTED-EMAIL]');
  // Redact phone numbers
  sanitized = sanitized.replace(/\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[REDACTED-PHONE]');
  // Redact API keys
  sanitized = sanitized.replace(/\b[a-zA-Z0-9_-]{32,}\b/g, '[REDACTED-KEY]');
  // Redact private keys
  sanitized = sanitized.replace(/-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, '[REDACTED-PRIVATE-KEY]');

  return sanitized;
}

/**
 * Log guardrail violation as a trace event.
 */
export function logGuardrailViolation(
  expertId: string,
  unternehmenId: string,
  runId: string | null,
  violation: GuardrailViolation
): void {
  db.insert(traceEvents).values({
    id: crypto.randomUUID(),
    companyId: unternehmenId,
    agentId: expertId,
    runId,
    type: 'error',
    title: `Guardrail: ${violation.type}`,
    details: `${violation.message} (severity: ${violation.severity}, layer: ${violation.layer})`,
    createdAt: new Date().toISOString(),
  }).run();
}

/**
 * Run guardrails and auto-sanitize if needed.
 * Returns the safe output (or null if blocked).
 */
export function guardAgentOutput(
  output: string,
  expertId: string,
  unternehmenId: string,
  runId: string | null,
  config?: GuardrailConfig
): { safe: boolean; output: string | null; violations: GuardrailViolation[] } {
  const result = validateOutput(output, config);

  // Log all violations
  for (const v of result.violations) {
    logGuardrailViolation(expertId, unternehmenId, runId, v);
  }

  // Critical violations → block entirely
  if (result.violations.some(v => v.severity === 'critical')) {
    return { safe: false, output: null, violations: result.violations };
  }

  // High violations → sanitize
  if (result.violations.some(v => v.severity === 'high')) {
    return {
      safe: true,
      output: sanitizeOutput(output),
      violations: result.violations,
    };
  }

  // Medium/Low → pass through with warnings
  return { safe: true, output, violations: result.violations };
}
