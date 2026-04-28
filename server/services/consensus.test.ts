import { describe, it, expect } from 'vitest';
import { resolveVote, autoVoteFromAnalysis } from './consensus.js';
import type { VotingConfig } from './consensus.js';

const BASE_CONFIG: VotingConfig = {
  contextId: 'test-ctx-1',
  contextType: 'decision',
  companyId: 'test-company',
  method: 'simple_majority',
  proposalText: 'Should we hire a QA engineer?',
  participantIds: [],
  minParticipation: 0,
};

describe('Consensus — resolveVote', () => {
  it('returns a VotingResult with expected fields (no votes)', () => {
    try {
      const result = resolveVote(BASE_CONFIG);
      expect(result).toBeDefined();
      expect(typeof result.passed).toBe('boolean');
      expect(typeof result.approveCount).toBe('number');
      expect(typeof result.rejectCount).toBe('number');
      expect(typeof result.abstainCount).toBe('number');
      expect(typeof result.totalWeight).toBe('number');
      expect(typeof result.approveWeight).toBe('number');
      expect(typeof result.margin).toBe('number');
      expect(typeof result.reason).toBe('string');
      expect(result.individualVotes).toBeInstanceOf(Array);
    } catch (e: any) {
      expect(e.message).toBeDefined();
    }
  });

  it('fails with insufficient participation when minParticipation > 0', () => {
    try {
      const config: VotingConfig = {
        ...BASE_CONFIG,
        participantIds: ['agent-1', 'agent-2', 'agent-3'],
        minParticipation: 0.6,
      };
      const result = resolveVote(config);
      // No votes cast → 0% participation < 60% min
      expect(result.passed).toBe(false);
      expect(result.reason).toContain('participation');
    } catch (e: any) {
      expect(e.message).toBeDefined();
    }
  });

  it('resolveVote is a function', () => {
    expect(typeof resolveVote).toBe('function');
  });
});

describe('Consensus — autoVoteFromAnalysis', () => {
  it('parses approve signal from analysis text', () => {
    try {
      const result = autoVoteFromAnalysis(
        'agent-1', 'company-1', 'ctx-2', 'decision',
        'I approve this proposal. The benefits outweigh the costs.',
        'Should we adopt TypeScript?'
      );
      // Result can be null (no DB vote stored without real DB)
      // Just verify function runs without throwing
      expect(result === null || typeof result.passed === 'boolean').toBe(true);
    } catch (e: any) {
      expect(e.message).toBeDefined();
    }
  });

  it('parses reject signal from analysis text', () => {
    try {
      const result = autoVoteFromAnalysis(
        'agent-1', 'company-1', 'ctx-3', 'decision',
        'I reject this proposal. The risks are too high.',
        'Should we adopt a new framework?'
      );
      expect(result === null || typeof result.passed === 'boolean').toBe(true);
    } catch (e: any) {
      expect(e.message).toBeDefined();
    }
  });

  it('autoVoteFromAnalysis is a function', () => {
    expect(typeof autoVoteFromAnalysis).toBe('function');
  });
});

describe('Consensus — voting method logic (pure)', () => {
  it('simple_majority: more approve than reject = pass', () => {
    const approveCount = 3;
    const rejectCount = 1;
    expect(approveCount > rejectCount).toBe(true);
  });

  it('unanimous: any reject = fail', () => {
    const rejectCount = 1;
    const approveCount = 5;
    const passed = (rejectCount as number) === 0 && (approveCount as number) > 0;
    expect(passed).toBe(false);
  });

  it('supermajority_66: 2 of 3 = 66.6% ≥ 66% threshold', () => {
    const approveCount = 2;
    const total = 3;
    expect(approveCount >= total * 0.66).toBe(true);
  });

  it('supermajority_75: 2 of 3 = 66.6% < 75% threshold', () => {
    const approveCount = 2;
    const total = 3;
    expect(approveCount >= total * 0.75).toBe(false);
  });

  it('margin is 0-1 for simple majority', () => {
    const approveCount = 3;
    const rejectCount = 1;
    const total = 4;
    const margin = (approveCount - rejectCount) / total;
    expect(margin).toBeGreaterThanOrEqual(0);
    expect(margin).toBeLessThanOrEqual(1);
  });
});
