/**
 * User Sandbox Manager for Eliza Town
 *
 * Manages per-user isolated sandbox environments. Each user (identified by session ID)
 * gets their own sandbox directory where they can read, write, edit files, and execute
 * shell commands independently of other users and the shared agent sandbox.
 *
 * The shared agent sandbox (sharedSandbox.ts) remains completely untouched -- this module
 * sits alongside it, providing user-level isolation.
 */

import { SharedSandboxService } from './sharedSandbox.js';
import type { SandboxConfig, FileResult, WriteResult, ListResult, SearchResult, ShellResult, FileChange } from './sharedSandbox.js';
import type { WebSocketMessage } from '../websocket/index.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// ============================================================================
// TYPES
// ============================================================================

export interface UserSandboxInfo {
  sessionId: string;
  directory: string;
  createdAt: number;
  lastAccessedAt: number;
  fileCount: number;
}

export interface UserSandboxStats {
  activeSandboxes: number;
  sandboxes: UserSandboxInfo[];
  baseDirectory: string;
}

type BroadcastFn = (message: WebSocketMessage) => void;

// ============================================================================
// USER SANDBOX MANAGER
// ============================================================================

class UserSandboxManager {
  private sandboxes = new Map<string, SharedSandboxService>();
  private metadata = new Map<string, { createdAt: number; lastAccessedAt: number }>();
  private baseDirectory: string;
  private broadcastFn: BroadcastFn | null = null;
  private initialized = false;
  private timeoutMs: number;
  private maxIdleMs: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.baseDirectory = process.env.USER_SANDBOX_BASE_DIR
      || path.join(process.env.SANDBOX_DIR || '/tmp/eliza-town-sandbox', 'users');
    this.timeoutMs = parseInt(process.env.USER_SANDBOX_TIMEOUT || '30000', 10);
    this.maxIdleMs = parseInt(process.env.USER_SANDBOX_MAX_IDLE || '3600000', 10); // 1 hour default
  }

  /**
   * Initialize the user sandbox manager
   */
  async initialize(broadcast?: BroadcastFn): Promise<void> {
    if (this.initialized) return;

    this.broadcastFn = broadcast || null;

    // Ensure the base directory exists
    await fs.mkdir(this.baseDirectory, { recursive: true });

    // Start cleanup interval to evict idle sandboxes
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleSandboxes().catch((err) => {
        console.error('[UserSandboxManager] Cleanup error:', err);
      });
    }, 300000); // Check every 5 minutes

    this.initialized = true;
    console.log(`[UserSandboxManager] Initialized. Base directory: ${this.baseDirectory}`);
    console.log(`[UserSandboxManager] Max idle time: ${this.maxIdleMs}ms, Command timeout: ${this.timeoutMs}ms`);
  }

  /**
   * Get or create a sandbox for a specific user session.
   * Each session gets its own isolated directory.
   */
  async getSandbox(sessionId: string): Promise<SharedSandboxService> {
    if (!this.initialized) {
      throw new Error('UserSandboxManager not initialized');
    }

    // Validate session ID to prevent path traversal
    const safeSessionId = this.sanitizeSessionId(sessionId);
    if (!safeSessionId) {
      throw new Error('Invalid session ID');
    }

    // Return existing sandbox if available
    const existing = this.sandboxes.get(safeSessionId);
    if (existing) {
      this.touchSession(safeSessionId);
      return existing;
    }

    // Create new sandbox for this user
    const userDir = path.join(this.baseDirectory, safeSessionId);
    const config: Partial<SandboxConfig> = {
      mode: 'local',
      allowedDirectory: userDir,
      timeoutMs: this.timeoutMs,
    };

    const sandbox = new SharedSandboxService(config);
    await sandbox.initialize(this.broadcastFn ? (msg) => {
      // Prefix sandbox events with session ID so frontend can route them
      if (this.broadcastFn) {
        this.broadcastFn({
          type: msg.type,
          data: {
            ...(msg.data || {}),
            sessionId: safeSessionId,
          },
        });
      }
    } : undefined);

    this.sandboxes.set(safeSessionId, sandbox);
    this.metadata.set(safeSessionId, {
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    });

    console.log(`[UserSandboxManager] Created sandbox for session: ${safeSessionId}`);

    if (this.broadcastFn) {
      this.broadcastFn({
        type: 'user_sandbox_created',
        data: {
          sessionId: safeSessionId,
          directory: userDir,
        },
      });
    }

    return sandbox;
  }

  /**
   * Check if a sandbox exists for a session
   */
  hasSandbox(sessionId: string): boolean {
    const safeId = this.sanitizeSessionId(sessionId);
    return safeId ? this.sandboxes.has(safeId) : false;
  }

  /**
   * Get info about a specific user's sandbox
   */
  async getSandboxInfo(sessionId: string): Promise<UserSandboxInfo | null> {
    const safeId = this.sanitizeSessionId(sessionId);
    if (!safeId) return null;

    const meta = this.metadata.get(safeId);
    if (!meta) return null;

    const userDir = path.join(this.baseDirectory, safeId);
    let fileCount = 0;
    try {
      fileCount = await this.countFiles(userDir);
    } catch {
      // Directory may not exist yet
    }

    return {
      sessionId: safeId,
      directory: userDir,
      createdAt: meta.createdAt,
      lastAccessedAt: meta.lastAccessedAt,
      fileCount,
    };
  }

  /**
   * Get stats about all active sandboxes
   */
  async getStats(): Promise<UserSandboxStats> {
    const sandboxes: UserSandboxInfo[] = [];

    for (const [sessionId] of this.sandboxes) {
      const info = await this.getSandboxInfo(sessionId);
      if (info) {
        sandboxes.push(info);
      }
    }

    return {
      activeSandboxes: this.sandboxes.size,
      sandboxes,
      baseDirectory: this.baseDirectory,
    };
  }

  /**
   * Close and remove a user's sandbox
   */
  async closeSandbox(sessionId: string): Promise<boolean> {
    const safeId = this.sanitizeSessionId(sessionId);
    if (!safeId) return false;

    const sandbox = this.sandboxes.get(safeId);
    if (!sandbox) return false;

    await sandbox.close();
    this.sandboxes.delete(safeId);
    this.metadata.delete(safeId);

    console.log(`[UserSandboxManager] Closed sandbox for session: ${safeId}`);

    if (this.broadcastFn) {
      this.broadcastFn({
        type: 'user_sandbox_closed',
        data: { sessionId: safeId },
      });
    }

    return true;
  }

  /**
   * Close all user sandboxes and shut down
   */
  async closeAll(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    const sessionIds = Array.from(this.sandboxes.keys());
    for (const sessionId of sessionIds) {
      try {
        await this.closeSandbox(sessionId);
      } catch (error) {
        console.error(`[UserSandboxManager] Error closing sandbox ${sessionId}:`, error);
      }
    }

    this.initialized = false;
    console.log('[UserSandboxManager] All user sandboxes closed');
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Sanitize session ID to prevent path traversal attacks.
   * Only allows alphanumeric, hyphens, and underscores.
   */
  private sanitizeSessionId(sessionId: string): string | null {
    if (!sessionId || typeof sessionId !== 'string') return null;

    // Strip anything that's not alphanumeric, hyphen, or underscore
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');

    // Must be between 1 and 128 characters
    if (safe.length < 1 || safe.length > 128) return null;

    return safe;
  }

  /**
   * Update last accessed time for a session
   */
  private touchSession(sessionId: string): void {
    const meta = this.metadata.get(sessionId);
    if (meta) {
      meta.lastAccessedAt = Date.now();
    }
  }

  /**
   * Count files recursively in a directory
   */
  private async countFiles(dir: string): Promise<number> {
    let count = 0;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (entry.isDirectory()) {
          count += await this.countFiles(path.join(dir, entry.name));
        } else {
          count++;
        }
      }
    } catch {
      // Directory doesn't exist or isn't readable
    }
    return count;
  }

  /**
   * Clean up sandboxes that have been idle for too long
   */
  private async cleanupIdleSandboxes(): Promise<void> {
    const now = Date.now();
    const toClose: string[] = [];

    for (const [sessionId, meta] of this.metadata) {
      if (now - meta.lastAccessedAt > this.maxIdleMs) {
        toClose.push(sessionId);
      }
    }

    for (const sessionId of toClose) {
      console.log(`[UserSandboxManager] Evicting idle sandbox: ${sessionId}`);
      await this.closeSandbox(sessionId);
    }

    if (toClose.length > 0) {
      console.log(`[UserSandboxManager] Cleaned up ${toClose.length} idle sandboxes`);
    }
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let userSandboxManager: UserSandboxManager | null = null;

/**
 * Get or create the user sandbox manager instance
 */
export function getUserSandboxManager(): UserSandboxManager {
  if (!userSandboxManager) {
    userSandboxManager = new UserSandboxManager();
  }
  return userSandboxManager;
}

/**
 * Initialize the user sandbox manager (call once at startup)
 */
export async function initializeUserSandboxes(broadcast?: BroadcastFn): Promise<UserSandboxManager> {
  const manager = getUserSandboxManager();
  await manager.initialize(broadcast);
  return manager;
}

/**
 * Close the user sandbox manager (call at shutdown)
 */
export async function closeUserSandboxes(): Promise<void> {
  if (userSandboxManager) {
    await userSandboxManager.closeAll();
    userSandboxManager = null;
  }
}

export { UserSandboxManager };
export default getUserSandboxManager;
