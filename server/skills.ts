import fs from 'fs';
import path from 'path';
import { db } from './db/client.js';
import { v4 as uuid } from 'uuid';
import { chatMessages, activityLog, agents, companies } from './db/schema.js';
import { eq } from 'drizzle-orm';
import { mcpClient } from './services/mcpClient.js';

const OPENCOGNIT_ROOT = path.resolve(process.cwd());

// Safe workspace root inside the data/ folder — gitignored, never part of app code
const SAFE_WORKSPACE_ROOT = path.join(OPENCOGNIT_ROOT, 'data', 'workspaces');

/**
 * Returns true if the given path is inside the OpenCognit app directory
 * (i.e. would let agents overwrite server code, frontend, package.json etc.)
 * Exception: data/workspaces/ is explicitly allowed — it's user data.
 */
function isInsideAppDir(dir: string): boolean {
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(OPENCOGNIT_ROOT + path.sep) && resolved !== OPENCOGNIT_ROOT) return false;
  // Allow data/workspaces — that's the safe sandbox
  if (resolved.startsWith(SAFE_WORKSPACE_ROOT + path.sep) || resolved === SAFE_WORKSPACE_ROOT) return false;
  return true; // inside app dir but outside safe sandbox → dangerous
}

/**
 * Resolves the effective working directory for an agent.
 * Priority: taskWorkspacePath → agent.connectionConfig.workDir → company.workDir → data/workspaces/<companyId>
 *
 * Any path that resolves to inside the OpenCognit app directory (except data/workspaces/)
 * is rejected to prevent agents from overwriting the application itself.
 */
export function resolveWorkDir(expertId: string, unternehmenId: string, taskWorkspacePath?: string | null): string {
  const safeDefault = () => {
    const dir = path.join(SAFE_WORKSPACE_ROOT, unternehmenId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  };

  const guardPath = (dir: string, label: string): string | null => {
    if (!path.isAbsolute(dir)) return null;
    if (isInsideAppDir(dir)) {
      console.warn(`[Workspace] ⚠️ ${label} zeigt auf das OpenCognit-Verzeichnis (${dir}) — blockiert. Agents dürfen die App nicht modifizieren.`);
      return null;
    }
    return dir;
  };

  // 1. Task-level override
  if (taskWorkspacePath) {
    const safe = guardPath(taskWorkspacePath, 'Task-Workspace');
    if (safe && fs.existsSync(safe)) return safe;
  }

  // 2. Agent-level override (in verbindungsConfig.workDir)
  try {
    const expert = db.select().from(agents).where(eq(agents.id, expertId)).get() as any;
    if (expert?.connectionConfig) {
      const config = JSON.parse(expert.connectionConfig);
      if (config.workDir) {
        const safe = guardPath(config.workDir, 'Agent-WorkDir');
        if (safe && fs.existsSync(safe)) return safe;
      }
    }
  } catch {}

  // 3. Company-level (global default) — auto-create if configured but missing
  try {
    const company = db.select().from(companies).where(eq(companies.id, unternehmenId)).get() as any;
    if (company?.workDir) {
      const safe = guardPath(company.workDir, 'Company-WorkDir');
      if (safe) {
        if (!fs.existsSync(safe)) {
          fs.mkdirSync(safe, { recursive: true });
          console.log(`[Workspace] Projektverzeichnis automatisch erstellt: ${safe}`);
        }
        return safe;
      }
    }
  } catch {}

  // 4. Safe fallback: data/workspaces/<companyId>/ — isolated per company, inside data/ (gitignored)
  console.warn(`[Workspace] Kein Projektverzeichnis konfiguriert — nutze sicheres Fallback: data/workspaces/${unternehmenId}/`);
  return safeDefault();
}

export async function executeSkill(expertId: string, unternehmenId: string, action: string, params: any, taskWorkspacePath?: string | null): Promise<string> {
  let result = "";
  let logAction = "";
  const workDir = resolveWorkDir(expertId, unternehmenId, taskWorkspacePath);
  
  try {
    if (action === 'file_read') {
      const relPath = params.path;
      const targetPath = path.resolve(workDir, relPath);

      const normalizedWorkDir = workDir.endsWith(path.sep) ? workDir : workDir + path.sep;
      if (!targetPath.startsWith(normalizedWorkDir) && targetPath !== workDir) {
        result = `Fehler: Zugriff verweigert. Nur Pfade innerhalb von "${workDir}" erlaubt.`;
      } else if (!fs.existsSync(targetPath)) {
        result = `Fehler: Datei "${relPath}" nicht gefunden (in ${workDir}).`;
      } else if (fs.lstatSync(targetPath).isDirectory()) {
        result = `Fehler: "${relPath}" ist ein Verzeichnis. Nutze list_files.`;
      } else {
        // Symlink escape check: verify real path stays inside workDir
        try {
          const realTarget = fs.realpathSync(targetPath);
          const realWorkDir = fs.realpathSync(workDir);
          const normalizedReal = realWorkDir.endsWith(path.sep) ? realWorkDir : realWorkDir + path.sep;
          if (!realTarget.startsWith(normalizedReal) && realTarget !== realWorkDir) {
            result = `Fehler: Zugriff verweigert. Symlink-Traversal außerhalb von "${workDir}" nicht erlaubt.`;
          } else {
            result = fs.readFileSync(targetPath, 'utf8');
            logAction = `Datei gelesen: ${relPath}`;
          }
        } catch {
          result = fs.readFileSync(targetPath, 'utf8');
          logAction = `Datei gelesen: ${relPath}`;
        }
      }
    } 
    else if (action === 'list_files') {
      const relPath = params.path || '.';
      const targetDir = path.resolve(workDir, relPath);
      
      if (!targetDir.startsWith(workDir)) {
        result = `Fehler: Zugriff verweigert. Nur Pfade innerhalb von "${workDir}" erlaubt.`;
      } else if (!fs.existsSync(targetDir)) {
        result = `Fehler: Verzeichnis "${relPath}" existiert nicht.`;
      } else {
        const files = fs.readdirSync(targetDir);
        result = files.map(f => {
          const stat = fs.statSync(path.join(targetDir, f));
          return `${stat.isDirectory() ? '[DIR]' : '[FILE]'} ${f}`;
        }).join('\n');
        logAction = `Verzeichnis aufgelistet: ${relPath}`;
      }
    }
    else if (action === 'web_search') {
      const query = params.query || "";
      try {
        // DuckDuckGo Instant Answer API (no key required)
        const encoded = encodeURIComponent(query);
        const r = await fetch(`https://api.duckduckgo.com/?q=${encoded}&format=json&no_redirect=1&no_html=1`, {
          headers: { 'User-Agent': 'OpenCognit/1.0' },
          signal: AbortSignal.timeout(8000),
        });
        const data = await r.json() as any;

        const lines: string[] = [];
        if (data.AbstractText) lines.push(`📋 ${data.AbstractText.slice(0, 400)}`);
        if (data.Answer) lines.push(`💡 ${data.Answer}`);
        if (data.RelatedTopics?.length > 0) {
          data.RelatedTopics.slice(0, 4).forEach((t: any, i: number) => {
            if (t.Text) lines.push(`${i + 1}. ${t.Text.slice(0, 200)}`);
          });
        }

        result = lines.length > 0
          ? `Suchergebnisse für "${query}":\n${lines.join('\n')}`
          : `Keine direkten Ergebnisse für "${query}". Versuche eine spezifischere Suche.`;
      } catch {
        result = `Websuche für "${query}" fehlgeschlagen (Timeout oder Netzwerkfehler).`;
      }
      logAction = `Websuche: "${query}"`;
    }
    else if (action === 'file_write') {
      const relPath = params.path;
      const content = params.content || '';
      const targetPath = path.resolve(workDir, relPath);

      const normalizedWorkDir = workDir.endsWith(path.sep) ? workDir : workDir + path.sep;
      if (!targetPath.startsWith(normalizedWorkDir) && targetPath !== workDir) {
        result = `Fehler: Zugriff verweigert. Nur Pfade innerhalb von "${workDir}" erlaubt.`;
      } else {
        // Create directory if it doesn't exist
        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        // Symlink escape check: resolve the real path of the parent directory
        try {
          const realDir = fs.realpathSync(dir);
          const realWorkDir = fs.realpathSync(workDir);
          const normalizedReal = realWorkDir.endsWith(path.sep) ? realWorkDir : realWorkDir + path.sep;
          if (!realDir.startsWith(normalizedReal) && realDir !== realWorkDir) {
            result = `Fehler: Zugriff verweigert. Symlink-Traversal außerhalb von "${workDir}" nicht erlaubt.`;
          } else {
            fs.writeFileSync(targetPath, content, 'utf8');
            result = `✅ Datei "${targetPath}" gespeichert (${content.length} Bytes).`;
            logAction = `Datei gespeichert: ${targetPath}`;
          }
        } catch {
          result = `Fehler: Pfad "${relPath}" konnte nicht aufgelöst werden.`;
        }
      }
    }
    else if (action === 'memory_search') {
      const query = params.query || "";
      const mcpRes = await mcpClient.callTool('memory_search', { query });
      result = JSON.stringify(mcpRes, null, 2);
      logAction = `Memory Suche: "${query}"`;
    }
    else if (action === 'memory_add_drawer') {
      const mcpRes = await mcpClient.callTool('memory_add_drawer', params);
      result = `✅ Drawer erfolgreich gespeichert: ${JSON.stringify(mcpRes)}`;
      logAction = `Memory Drawer erstellt: ${params.room || 'general'}`;
    }
    else if (action === 'memory_diary_write') {
      const mcpRes = await mcpClient.callTool('memory_diary_write', params);
      result = `✅ Tagebucheintrag gespeichert.`;
      logAction = `Memory Tagebuch geschrieben`;
    }
    else if (action === 'file_delete') {
      const relPath = params.path;
      const targetPath = path.resolve(workDir, relPath);
      
      const normalizedWorkDir = workDir.endsWith(path.sep) ? workDir : workDir + path.sep;
      if (!targetPath.startsWith(normalizedWorkDir) && targetPath !== workDir) {
        result = `Fehler: Zugriff verweigert. Nur Pfade innerhalb von "${workDir}" erlaubt.`;
      } else if (!fs.existsSync(targetPath)) {
        result = `Fehler: Datei "${relPath}" existiert nicht.`;
      } else {
        fs.unlinkSync(targetPath);
        result = `Datei "${targetPath}" erfolgreich gelöscht.`;
        logAction = `Datei gelöscht: ${targetPath}`;
      }
    }
    else {
      result = `Unbekannter Skill oder Aktion: ${action}`;
    }
  } catch (e: any) {
    result = `Skill-Fehlfunktion (${action}): ${e.message}`;
  }

  // Store in database as System Observation
  const msgId = uuid();
  db.insert(chatMessages).values({
    id: msgId,
    companyId: unternehmenId,
    agentId: expertId,
    senderType: 'system',
    message: `[SYSTEM BEOBACHTUNG - ${action.toUpperCase()}]\n${result}`,
    read: false,
    createdAt: new Date().toISOString()
  }).run();

  // Log to Activity
  if (logAction) {
    db.insert(activityLog).values({
      id: uuid(),
      companyId: unternehmenId,
      actorType: 'agent',
      actorId: expertId,
      action: logAction,
      entityType: 'skill',
      entityId: action,
      createdAt: new Date().toISOString()
    }).run();
  }
  
  return result;
}
