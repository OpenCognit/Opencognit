// Chat Tools — Tool-Use for CEO in chat context
// Tools: bash, read_file, write_file, grep, list_dir

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { isSafeWorkdir } from '../adapters/workspace-guard.js';

export interface ToolCall {
  name: string;
  parameters: Record<string, unknown>;
}

export interface ToolResult {
  tool: string;
  success: boolean;
  output: string;
  error?: string;
}

export const TOOL_DEFINITIONS = `
You have access to the following tools. Use them by writing [TOOL]{"name":"TOOL_NAME",...params...}[/TOOL] in your response.
You may call multiple tools in sequence. After each tool result, you will receive the output and can call another tool.

Available tools:

1. bash — Execute a shell command
   [TOOL]{"name":"bash","command":"npm test","cwd":"/path"}[/TOOL]
   - "command": the shell command to run (required)
   - "cwd": working directory (optional, defaults to project root)
   - "timeout": max seconds (optional, default 30)
   - IMPORTANT: Always use absolute paths. Check workspace paths first.

2. read_file — Read the contents of a file
   [TOOL]{"name":"read_file","path":"/absolute/path/to/file.ts"}[/TOOL]
   - "path": absolute file path (required)
   - Max 500KB per read. For large files, use grep first to find relevant lines.

3. write_file — Write content to a file (creates dirs if needed)
   [TOOL]{"name":"write_file","path":"/absolute/path/to/file.ts","content":"..."}[/TOOL]
   - "path": absolute file path (required)
   - "content": file content (required)
   - Will overwrite existing files. Use with caution.

4. grep — Search for a pattern in the codebase
   [TOOL]{"name":"grep","pattern":"function handleClick","path":"/absolute/path"}[/TOOL]
   - "pattern": regex or text to search (required)
   - "path": directory or file to search in (required)
   - "glob": file pattern, e.g. "*.ts" (optional)

5. list_dir — List files in a directory
   [TOOL]{"name":"list_dir","path":"/absolute/path"}[/TOOL]
   - "path": absolute directory path (required)
   - "recursive": true/false (optional, default false)

Rules:
- ALWAYS check file contents before modifying (read_file first).
- ALWAYS verify with bash/tests after writing code.
- NEVER delete or modify files outside the project workspace.
- NEVER run dangerous commands (rm -rf /, dd, mkfs, etc.).
- If a tool fails, try an alternative approach or ask the user.
`.trim();

const MAX_FILE_SIZE = 500 * 1024;

function guardPath(p: string): { safe: boolean; resolved: string; error?: string } {
  const resolved = path.resolve(p);
  if (!isSafeWorkdir(resolved)) {
    return { safe: false, resolved, error: `Path ${resolved} is outside the allowed workspace.` };
  }
  return { safe: true, resolved };
}

function guardCommand(cmd: string): { safe: boolean; error?: string } {
  // Block subshells, backticks, and process substitution
  if (/[`$]\(|\$\{.*\}|`.*`|<\(|\)>/i.test(cmd)) {
    return { safe: false, error: 'Subshells and command substitution are not allowed.' };
  }

  // Block dangerous commands and patterns
  const dangerous = /(^|\s|;|&&|\|\||\|)(rm\s+-rf\s*[\/\\]|dd\s+|mkfs|>:\s*\/dev\/(null|zero|random|sd[a-z])|shutdown|reboot|poweroff|halt|init\s+0|curl\s+.*\|\s*sh|wget\s+.*\|\s*sh|eval\s*\(|base64\s+.*\||python3?\s+.*\|.*sh|perl\s+.*\|.*sh|nc\s+|netcat\s+|ncat\s+|bash\s+-c|sh\s+-c|cmd\s+\/c|powershell\s+-c|python3?\s+-c\s+.*os\.system|python3?\s+-c\s+.*subprocess\.call|python3?\s+-c\s+.*subprocess\.run)/i;
  if (dangerous.test(cmd)) {
    return { safe: false, error: 'Dangerous command blocked by guardrail.' };
  }

  return { safe: true };
}

export async function executeTool(call: ToolCall): Promise<ToolResult> {
  const { name, parameters } = call;

  try {
    switch (name) {
      case 'bash': {
        const cmd = String(parameters.command || '');
        const cwd = parameters.cwd ? String(parameters.cwd) : process.cwd();
        const timeout = Math.min(Number(parameters.timeout || 30), 120) * 1000;

        const guard = guardCommand(cmd);
        if (!guard.safe) return { tool: name, success: false, output: '', error: guard.error };

        const pathGuard = guardPath(cwd);
        if (!pathGuard.safe) return { tool: name, success: false, output: '', error: pathGuard.error };

        const result = execSync(cmd, {
          cwd: pathGuard.resolved,
          encoding: 'utf-8',
          timeout,
          maxBuffer: 1024 * 1024,
          env: {
            PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
            HOME: process.env.HOME || '/tmp',
            LANG: process.env.LANG || 'en_US.UTF-8',
            USER: process.env.USER || 'opencognit',
            SHELL: process.env.SHELL || '/bin/sh',
            TERM: process.env.TERM || 'xterm',
          },
        });
        return { tool: name, success: true, output: result.slice(0, 50000) };
      }

      case 'read_file': {
        const p = String(parameters.path || '');
        const guard = guardPath(p);
        if (!guard.safe) return { tool: name, success: false, output: '', error: guard.error };

        if (!fs.existsSync(guard.resolved)) {
          return { tool: name, success: false, output: '', error: `File not found: ${guard.resolved}` };
        }
        const stat = fs.statSync(guard.resolved);
        if (stat.isDirectory()) {
          return { tool: name, success: false, output: '', error: `Path is a directory, not a file: ${guard.resolved}` };
        }
        if (stat.size > MAX_FILE_SIZE) {
          const head = fs.readFileSync(guard.resolved, 'utf-8').slice(0, MAX_FILE_SIZE);
          return { tool: name, success: true, output: head + '\n\n[TRUNCATED: file larger than 500KB]' };
        }
        const content = fs.readFileSync(guard.resolved, 'utf-8');
        return { tool: name, success: true, output: content };
      }

      case 'write_file': {
        const p = String(parameters.path || '');
        const content = String(parameters.content ?? '');
        const guard = guardPath(p);
        if (!guard.safe) return { tool: name, success: false, output: '', error: guard.error };

        const dir = path.dirname(guard.resolved);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(guard.resolved, content, 'utf-8');
        return { tool: name, success: true, output: `File written: ${guard.resolved} (${content.length} bytes)` };
      }

      case 'grep': {
        const pattern = String(parameters.pattern || '');
        const searchPath = String(parameters.path || '');
        const glob = parameters.glob ? String(parameters.glob) : '*';
        const guard = guardPath(searchPath);
        if (!guard.safe) return { tool: name, success: false, output: '', error: guard.error };

        if (!fs.existsSync(guard.resolved)) {
          return { tool: name, success: false, output: '', error: `Path not found: ${guard.resolved}` };
        }

        const results: string[] = [];
        const isDir = fs.statSync(guard.resolved).isDirectory();
        const files = isDir
          ? collectFiles(guard.resolved, glob)
          : [guard.resolved];

        for (const file of files.slice(0, 200)) {
          try {
            const content = fs.readFileSync(file, 'utf-8');
            const lines = content.split('\n');
            lines.forEach((line, idx) => {
              if (line.includes(pattern) || new RegExp(pattern, 'i').test(line)) {
                results.push(`${path.relative(process.cwd(), file)}:${idx + 1}: ${line.trim()}`);
              }
            });
          } catch { /* binary or unreadable */ }
        }

        if (results.length === 0) {
          return { tool: name, success: true, output: `No matches for "${pattern}"` };
        }
        return { tool: name, success: true, output: results.slice(0, 100).join('\n') + (results.length > 100 ? `\n\n... and ${results.length - 100} more matches` : '') };
      }

      case 'list_dir': {
        const p = String(parameters.path || '');
        const recursive = Boolean(parameters.recursive);
        const guard = guardPath(p);
        if (!guard.safe) return { tool: name, success: false, output: '', error: guard.error };

        if (!fs.existsSync(guard.resolved)) {
          return { tool: name, success: false, output: '', error: `Directory not found: ${guard.resolved}` };
        }
        if (!fs.statSync(guard.resolved).isDirectory()) {
          return { tool: name, success: false, output: '', error: `Path is not a directory: ${guard.resolved}` };
        }

        const items = recursive
          ? fs.readdirSync(guard.resolved, { recursive: true } as any) as string[]
          : fs.readdirSync(guard.resolved);
        const formatted = items.map(item => {
          const full = path.join(guard.resolved, item);
          try {
            const stat = fs.statSync(full);
            return `${stat.isDirectory() ? 'DIR ' : 'FILE'} ${item}`;
          } catch {
            return `?    ${item}`;
          }
        });
        return { tool: name, success: true, output: formatted.join('\n') };
      }

      default:
        return { tool: name, success: false, output: '', error: `Unknown tool: ${name}` };
    }
  } catch (err: any) {
    return { tool: name, success: false, output: '', error: err.message || String(err) };
  }
}

function collectFiles(dir: string, glob: string): string[] {
  const results: string[] = [];
  const extensions = glob === '*' ? null : glob.replace(/^\*\./, '').split(',').map(e => e.trim());

  function walk(current: string) {
    const items = fs.readdirSync(current);
    for (const item of items) {
      const full = path.join(current, item);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        if (!item.startsWith('.') && item !== 'node_modules' && item !== 'dist') {
          walk(full);
        }
      } else if (!extensions || extensions.some(ext => item.endsWith(ext))) {
        results.push(full);
      }
    }
  }

  walk(dir);
  return results;
}

/** Extract [TOOL] blocks from text */
export function extractToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const regex = /\[TOOL\]([\s\S]*?)\[\/TOOL\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.name) {
        calls.push({ name: parsed.name, parameters: parsed });
      }
    } catch { /* ignore invalid JSON */ }
  }
  return calls;
}

/** Remove [TOOL] blocks from text for clean display */
export function stripToolBlocks(text: string): string {
  return text.replace(/\[TOOL\][\s\S]*?\[\/TOOL\]/g, '').trim();
}
