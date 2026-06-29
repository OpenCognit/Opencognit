import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';

// ─── Provider Interface ───────────────────────────────────────────────────────
export interface ArtifactStorageProvider {
  write(artifactId: string, companyId: string, buffer: Buffer, filename: string): Promise<{ storagePath: string; checksum: string }>;
  read(storagePath: string): Promise<Buffer>;
  delete(storagePath: string): Promise<void>;
  verify(storagePath: string, expectedChecksum: string): Promise<boolean>;
}

// ─── Local Filesystem Provider ────────────────────────────────────────────────
export class LocalFilesystemProvider implements ArtifactStorageProvider {
  private root: string;

  constructor(root?: string) {
    const raw = root || process.env.ARTIFACT_STORAGE_ROOT || path.join(process.cwd(), 'data', 'artifacts');
    // Resolve to real path to handle symlinks (e.g. /tmp → /private/tmp on macOS)
    try {
      const dir = path.resolve(raw);
      // Create if needed so realpath can resolve
      fsSync.mkdirSync(dir, { recursive: true });
      this.root = fsSync.realpathSync(dir);
    } catch {
      this.root = path.resolve(raw);
    }
  }

  getRoot(): string {
    return this.root;
  }

  /**
   * Atomic write: temp file → checksum → rename → return path + checksum.
   * Guarantees no partial files in the artifact store.
   */
  async write(artifactId: string, companyId: string, buffer: Buffer, filename: string): Promise<{ storagePath: string; checksum: string }> {
    const companyDir = path.join(this.root, companyId);
    const artifactDir = path.join(companyDir, artifactId);
    const finalPath = path.join(artifactDir, filename);
    const tempPath = path.join(companyDir, `${artifactId}.tmp`);

    // Path containment check
    this.ensureWithinRoot(finalPath);
    this.ensureWithinRoot(tempPath);

    try {
      // Create company directory
      await fs.mkdir(companyDir, { recursive: true });

      // Write to temp file
      await fs.writeFile(tempPath, buffer);

      // Compute checksum
      const checksum = await this.computeChecksum(tempPath);

      // Create artifact directory and rename
      await fs.mkdir(artifactDir, { recursive: true });
      await fs.rename(tempPath, finalPath);

      const storagePath = path.join(companyId, artifactId, filename);
      return { storagePath, checksum };
    } catch (err) {
      // Cleanup on failure
      await this.safeUnlink(tempPath);
      await this.safeRmdir(artifactDir);
      throw err;
    }
  }

  async read(storagePath: string): Promise<Buffer> {
    const fullPath = path.join(this.root, storagePath);
    this.ensureWithinRoot(fullPath);
    this.ensureNoSymlink(fullPath);
    return fs.readFile(fullPath);
  }

  async delete(storagePath: string): Promise<void> {
    const fullPath = path.join(this.root, storagePath);
    this.ensureWithinRoot(fullPath);
    await this.safeUnlink(fullPath);

    // Clean up empty parent directories (best-effort)
    const artifactDir = path.dirname(fullPath);
    const companyDir = path.dirname(artifactDir);
    await this.safeRmdir(artifactDir);
    await this.safeRmdir(companyDir);
  }

  async verify(storagePath: string, expectedChecksum: string): Promise<boolean> {
    try {
      const fullPath = path.join(this.root, storagePath);
      this.ensureWithinRoot(fullPath);
      const actual = await this.computeChecksum(fullPath);
      return actual === expectedChecksum;
    } catch {
      return false;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async computeChecksum(filePath: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    const stream = (await import('fs')).createReadStream(filePath);
    return new Promise<string>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  private resolvedRoot: string | null = null;

  private getResolvedRoot(): string {
    if (!this.resolvedRoot) {
      // root is already resolved in constructor
      this.resolvedRoot = this.root;
    }
    return this.resolvedRoot!;
  }

  private ensureWithinRoot(targetPath: string): void {
    const resolved = path.resolve(targetPath);
    const root = this.getResolvedRoot();
    // Resolve existing path components to real path for comparison
    let realTarget = resolved;
    try {
      // Walk up until we find an existing directory, then resolve
      let check = resolved;
      while (check !== path.dirname(check)) {
        try {
          const real = fsSync.realpathSync(check);
          realTarget = path.join(real, path.relative(check, resolved));
          break;
        } catch (e: any) {
          if (e.code !== 'ENOENT') throw e;
        }
        check = path.dirname(check);
      }
    } catch {}
    
    if (!realTarget.startsWith(root + path.sep) && realTarget !== root) {
      throw new Error(`Path traversal denied: ${targetPath}`);
    }
  }

  private async ensureNoSymlink(targetPath: string): Promise<void> {
    try {
      const realPath = await fs.realpath(targetPath);
      const root = this.getResolvedRoot();
      if (!realPath.startsWith(root + path.sep) && realPath !== root) {
        throw new Error(`Path traversal denied (symlink): ${targetPath}`);
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
  }

  private async safeUnlink(filePath: string): Promise<void> {
    try { await fs.unlink(filePath); } catch {}
  }

  private async safeRmdir(dirPath: string): Promise<void> {
    try { await fs.rmdir(dirPath); } catch {}
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
let defaultProvider: LocalFilesystemProvider | null = null;

export function getArtifactStorage(): LocalFilesystemProvider {
  if (!defaultProvider) {
    defaultProvider = new LocalFilesystemProvider();
  }
  return defaultProvider;
}
