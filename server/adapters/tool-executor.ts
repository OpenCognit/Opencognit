// Unified tool execution for all LLM adapters

import { exec } from 'child_process';
import { promisify } from 'util';
import { resolveAgentWorkdir } from './workspace-guard.js';

const execAsync = promisify(exec);

const BLOCKED_PATTERNS = [
  'rm -rf /',
  'mkfs',
  'dd if=',
  ':(){:|:&};:',
  '> /dev/sda',
  'chmod -R 777 /',
  'chown -R root /',
];

export interface ToolResult {
  success: boolean;
  output: string;
}

/**
 * Extract all ```bash / ```sh / ```shell blocks from LLM output.
 */
export function extractBashBlocks(text: string): string[] {
  const blocks: string[] = [];
  const regex = /```(?:bash|sh|shell)?\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const code = match[1].trim();
    if (code) blocks.push(code);
  }
  return blocks;
}

/**
 * Execute a single bash command in the given workspace directory.
 */
export async function executeBashCommand(
  command: string,
  workspacePath?: string,
  timeoutMs = 60_000,
): Promise<ToolResult> {
  for (const pattern of BLOCKED_PATTERNS) {
    if (command.includes(pattern)) {
      return { success: false, output: `Blocked: command matches blocked pattern "${pattern}"` };
    }
  }

  try {
    const safeWorkdir = resolveAgentWorkdir(workspacePath);
    const { stdout, stderr } = await execAsync(command, {
      cwd: safeWorkdir,
      timeout: timeoutMs,
      env: { ...process.env },
    });
    const out = [stdout, stderr ? `STDERR: ${stderr}` : ''].filter(Boolean).join('\n').trim();
    return { success: true, output: out || '(no output)' };
  } catch (e: any) {
    const out = e.stderr || e.stdout || e.message;
    return { success: false, output: out };
  }
}

/**
 * Tool schema definitions reused across adapters.
 */
export const AGENT_TOOLS_ANTHROPIC = [
  {
    name: 'bash',
    description:
      'Execute a bash command in the workspace directory. Use this to create files, write code, run scripts, install packages, etc. You can chain commands with && or use multiple calls.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'The bash command to execute' },
      },
      required: ['command'],
    },
  },
  {
    name: 'task_complete',
    description: 'Signal that the task is fully complete. Call this when all work is done.',
    input_schema: {
      type: 'object' as const,
      properties: {
        summary: { type: 'string', description: 'Summary of what was accomplished' },
      },
      required: ['summary'],
    },
  },
];

export const AGENT_TOOLS_OPENAI = [
  {
    type: 'function' as const,
    function: {
      name: 'bash',
      description:
        'Execute a bash command in the workspace directory. Use this to create files, write code, run scripts, install packages, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command to execute' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'task_complete',
      description: 'Signal that the task is fully complete.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Summary of what was accomplished' },
        },
        required: ['summary'],
      },
    },
  },
];
