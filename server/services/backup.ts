// Backup Service — creates daily SQLite snapshots with 7-day retention
// Uses better-sqlite3's built-in .backup() for hot backups (no lock required)

import fs from 'fs';
import path from 'path';
import { sqlite } from '../db/client.js';

const DATA_DIR = path.resolve('data');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const MAX_BACKUPS = 7;

export interface BackupResult {
  path: string;
  sizeBytes: number;
  timestamp: string;
}

class BackupService {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    if (!fs.existsSync(BACKUPS_DIR)) {
      fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    }

    // Run at midnight every day: check every hour if today's backup is missing
    this.intervalId = setInterval(() => {
      this.runBackupIfNeeded().catch(e => console.warn('⚠️ Backup error:', e.message));
    }, 60 * 60 * 1000); // every hour

    // Also run once on startup if no backup exists today
    this.runBackupIfNeeded().catch(e => console.warn('⚠️ Startup backup error:', e.message));

    console.log('💾 Backup service started (daily SQLite snapshots → data/backups/)');
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
  }

  async runBackupIfNeeded(): Promise<BackupResult | null> {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const backupPath = path.join(BACKUPS_DIR, `opencognit_${today}.db`);

    // Skip if today's backup already exists
    if (fs.existsSync(backupPath)) return null;

    return this.runBackup();
  }

  async runBackup(): Promise<BackupResult> {
    if (!fs.existsSync(BACKUPS_DIR)) {
      fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    }

    const timestamp = new Date().toISOString();
    const dateStr = timestamp.slice(0, 10); // YYYY-MM-DD
    const backupPath = path.join(BACKUPS_DIR, `opencognit_${dateStr}.db`);

    // Use better-sqlite3's hot backup — safe while DB is open and writing
    await (sqlite as any).backup(backupPath);

    const stat = fs.statSync(backupPath);
    const sizeBytes = stat.size;

    console.log(`💾 Backup created: ${backupPath} (${(sizeBytes / 1024 / 1024).toFixed(1)} MB)`);

    // Prune old backups — keep only MAX_BACKUPS most recent
    this.pruneOldBackups();

    return { path: backupPath, sizeBytes, timestamp };
  }

  listBackups(): Array<{ name: string; path: string; sizeBytes: number; createdAt: string }> {
    if (!fs.existsSync(BACKUPS_DIR)) return [];

    return fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.startsWith('opencognit_') && f.endsWith('.db'))
      .sort()
      .reverse()
      .map(name => {
        const filePath = path.join(BACKUPS_DIR, name);
        const stat = fs.statSync(filePath);
        return {
          name,
          path: filePath,
          sizeBytes: stat.size,
          createdAt: stat.mtime.toISOString(),
        };
      });
  }

  private pruneOldBackups(): void {
    const backups = this.listBackups();
    if (backups.length <= MAX_BACKUPS) return;

    const toDelete = backups.slice(MAX_BACKUPS);
    for (const backup of toDelete) {
      try {
        fs.unlinkSync(backup.path);
        console.log(`🗑️ Pruned old backup: ${backup.name}`);
      } catch (e: any) {
        console.warn(`⚠️ Could not delete backup ${backup.name}:`, e.message);
      }
    }
  }
}

export const backupService = new BackupService();
