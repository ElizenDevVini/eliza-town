/**
 * Shared Sandbox Service for Eliza Town
 *
 * Provides a single shared code execution environment that ALL agents can access.
 * This enables collaborative coding where agents can see and modify each other's work.
 *
 * Supports:
 * - Local filesystem (restricted to allowed directory)
 * - E2B cloud sandbox (all agents share one sandbox instance)
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { WebSocketMessage } from '../websocket/index.js';

// ============================================================================
// TYPES
// ============================================================================

export interface SandboxConfig {
  mode: 'local' | 'e2b';
  allowedDirectory: string;
  e2bApiKey?: string;
  timeoutMs: number;
}

export interface FileResult {
  ok: boolean;
  content?: string;
  error?: string;
}

export interface WriteResult {
  ok: boolean;
  filepath?: string;
  size?: number;
  error?: string;
}

export interface ListResult {
  ok: boolean;
  items?: Array<{ name: string; isDirectory: boolean; size?: number }>;
  error?: string;
}

export interface SearchMatch {
  file: string;
  line: number;
  content: string;
}

export interface SearchResult {
  ok: boolean;
  matches?: SearchMatch[];
  error?: string;
}

export interface ShellResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  executedIn?: string;
}

export interface FileChange {
  type: 'created' | 'modified' | 'deleted';
  filepath: string;
  agent: string;
  timestamp: number;
  size?: number;
}

type BroadcastFn = (message: WebSocketMessage) => void;

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG: SandboxConfig = {
  mode: process.env.USE_E2B === 'true' ? 'e2b' : 'local',
  allowedDirectory: process.env.CODER_ALLOWED_DIRECTORY || process.env.SANDBOX_DIR || '/tmp/eliza-town-sandbox',
  e2bApiKey: process.env.E2B_API_KEY,
  timeoutMs: parseInt(process.env.CODER_TIMEOUT || '30000', 10),
};

// Forbidden command patterns for security
const FORBIDDEN_PATTERNS: RegExp[] = [
  /rm\s+-rf\s+[\/~]/,
  /rm\s+-rf\s+\*/,
  />\s*\/dev\/sd/,
  /mkfs\./,
  /dd\s+if=/,
  /:(){ :\|:& };:/,
  /chmod\s+-R\s+777\s+\//,
  /curl.*\|\s*(ba)?sh/,
  /wget.*\|\s*(ba)?sh/,
];

// ============================================================================
// SHARED SANDBOX SERVICE (Singleton)
// ============================================================================

class SharedSandboxService {
  private config: SandboxConfig;
  private initialized = false;
  private currentDirectory: string;
  private fileHistory: FileChange[] = [];
  private broadcastFn: BroadcastFn | null = null;

  // E2B sandbox instance (shared by all agents)
  private e2bSandbox: {
    filesystem: {
      read(path: string): Promise<string>;
      write(path: string, content: string): Promise<void>;
      list(path: string): Promise<Array<{ name: string; isDir: boolean }>>;
    };
    process: {
      start(opts: { cmd: string }): Promise<{
        wait(): Promise<void>;
        exitCode: number;
        stdout?: string;
        stderr?: string;
      }>;
    };
    close(): Promise<void>;
  } | null = null;

  constructor(config: Partial<SandboxConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentDirectory = this.config.allowedDirectory;
  }

  /**
   * Initialize the shared sandbox
   */
  async initialize(broadcast?: BroadcastFn): Promise<void> {
    if (this.initialized) return;

    this.broadcastFn = broadcast || null;

    if (this.config.mode === 'e2b') {
      await this.initializeE2B();
    } else {
      await this.initializeLocal();
    }

    this.initialized = true;
    console.log(`[SharedSandbox] Initialized in ${this.config.mode} mode`);
    console.log(`[SharedSandbox] Working directory: ${this.config.allowedDirectory}`);
  }

  /**
   * Initialize local filesystem sandbox
   */
  private async initializeLocal(): Promise<void> {
    try {
      await fs.mkdir(this.config.allowedDirectory, { recursive: true });
      console.log(`[SharedSandbox] Local sandbox ready at ${this.config.allowedDirectory}`);
    } catch (error) {
      console.error('[SharedSandbox] Failed to create sandbox directory:', error);
      throw error;
    }
  }

  /**
   * Initialize E2B cloud sandbox
   */
  private async initializeE2B(): Promise<void> {
    if (!this.config.e2bApiKey) {
      throw new Error('[SharedSandbox] E2B_API_KEY required for E2B mode');
    }

    try {
      // Dynamic import with type assertion
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e2bModule = await import('@e2b/code-interpreter') as Record<string, unknown>;
      // Handle various export patterns
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const SandboxClass = (e2bModule.Sandbox || e2bModule.CodeInterpreter || e2bModule.default) as any;

      if (!SandboxClass?.create) {
        throw new Error('Could not find Sandbox.create in @e2b/code-interpreter');
      }

      this.e2bSandbox = await SandboxClass.create({ apiKey: this.config.e2bApiKey });
      console.log('[SharedSandbox] E2B sandbox created - all agents will share this instance');
    } catch (error) {
      console.error('[SharedSandbox] Failed to initialize E2B:', error);
      throw error;
    }
  }

  /**
   * Validate that a path is within the allowed directory
   */
  private validatePath(targetPath: string): string | null {
    const resolved = path.resolve(this.currentDirectory, targetPath);
    if (!resolved.startsWith(this.config.allowedDirectory)) {
      return null;
    }
    return resolved;
  }

  /**
   * Record a file change and broadcast it
   */
  private recordFileChange(change: FileChange): void {
    this.fileHistory.push(change);
    // Keep only last 100 changes
    if (this.fileHistory.length > 100) {
      this.fileHistory = this.fileHistory.slice(-100);
    }

    if (this.broadcastFn) {
      this.broadcastFn({
        type: 'sandbox_file_change',
        data: change as unknown as Record<string, unknown>,
      });
    }
  }

  /**
   * Get recent file changes (for CODEBASE provider)
   */
  getRecentChanges(limit = 20): FileChange[] {
    return this.fileHistory.slice(-limit);
  }

  /**
   * Get sandbox configuration
   */
  getConfig(): SandboxConfig {
    return { ...this.config };
  }

  /**
   * Get current working directory
   */
  getCurrentDirectory(): string {
    return this.currentDirectory;
  }

  // ============================================================================
  // FILE OPERATIONS
  // ============================================================================

  /**
   * Read a file
   */
  async readFile(filepath: string, agentName = 'unknown'): Promise<FileResult> {
    if (!this.initialized) {
      return { ok: false, error: 'Sandbox not initialized' };
    }

    if (this.config.mode === 'e2b' && this.e2bSandbox) {
      try {
        const content = await this.e2bSandbox.filesystem.read(filepath);
        return { ok: true, content };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    }

    // Local mode
    const resolved = this.validatePath(filepath);
    if (!resolved) {
      return { ok: false, error: 'Path outside allowed directory' };
    }

    try {
      const content = await fs.readFile(resolved, 'utf-8');
      console.log(`[SharedSandbox] ${agentName} read: ${filepath}`);
      return { ok: true, content };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      return { ok: false, error: err.code === 'ENOENT' ? 'File not found' : err.message };
    }
  }

  /**
   * Write a file
   */
  async writeFile(filepath: string, content: string, agentName = 'unknown'): Promise<WriteResult> {
    if (!this.initialized) {
      return { ok: false, error: 'Sandbox not initialized' };
    }

    if (this.config.mode === 'e2b' && this.e2bSandbox) {
      try {
        await this.e2bSandbox.filesystem.write(filepath, content);
        this.recordFileChange({
          type: 'created',
          filepath,
          agent: agentName,
          timestamp: Date.now(),
          size: content.length,
        });
        return { ok: true, filepath, size: content.length };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    }

    // Local mode
    const resolved = this.validatePath(filepath);
    if (!resolved) {
      return { ok: false, error: 'Path outside allowed directory' };
    }

    try {
      // Check if file exists (for change type)
      let changeType: 'created' | 'modified' = 'created';
      try {
        await fs.access(resolved);
        changeType = 'modified';
      } catch {
        // File doesn't exist, will be created
      }

      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, content, 'utf-8');

      this.recordFileChange({
        type: changeType,
        filepath: path.relative(this.config.allowedDirectory, resolved),
        agent: agentName,
        timestamp: Date.now(),
        size: content.length,
      });

      console.log(`[SharedSandbox] ${agentName} wrote: ${filepath} (${content.length} bytes)`);
      return { ok: true, filepath: resolved, size: content.length };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  /**
   * Edit a file (find and replace)
   */
  async editFile(
    filepath: string,
    oldStr: string,
    newStr: string,
    agentName = 'unknown'
  ): Promise<WriteResult> {
    if (!this.initialized) {
      return { ok: false, error: 'Sandbox not initialized' };
    }

    // Read current content
    const readResult = await this.readFile(filepath, agentName);
    if (!readResult.ok || !readResult.content) {
      return { ok: false, error: readResult.error || 'Could not read file' };
    }

    // Check if old string exists
    if (!readResult.content.includes(oldStr)) {
      return { ok: false, error: 'Could not find old_str in file' };
    }

    // Replace and write
    const newContent = readResult.content.replace(oldStr, newStr);
    const writeResult = await this.writeFile(filepath, newContent, agentName);

    if (writeResult.ok) {
      // Override the change type to 'modified'
      const lastChange = this.fileHistory[this.fileHistory.length - 1];
      if (lastChange) {
        lastChange.type = 'modified';
      }
    }

    return writeResult;
  }

  /**
   * List files in a directory
   */
  async listFiles(dirPath = '.', agentName = 'unknown'): Promise<ListResult> {
    if (!this.initialized) {
      return { ok: false, error: 'Sandbox not initialized' };
    }

    if (this.config.mode === 'e2b' && this.e2bSandbox) {
      try {
        const entries = await this.e2bSandbox.filesystem.list(dirPath);
        const items = entries.map((e) => ({
          name: e.name,
          isDirectory: e.isDir,
        }));
        return { ok: true, items };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    }

    // Local mode
    const resolved = this.validatePath(dirPath);
    if (!resolved) {
      return { ok: false, error: 'Path outside allowed directory' };
    }

    try {
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      const items = entries
        .filter((e) => !e.name.startsWith('.'))
        .map((e) => ({
          name: e.name,
          isDirectory: e.isDirectory(),
        }))
        .sort((a, b) => {
          // Directories first
          if (a.isDirectory !== b.isDirectory) {
            return a.isDirectory ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });

      console.log(`[SharedSandbox] ${agentName} listed: ${dirPath} (${items.length} items)`);
      return { ok: true, items };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      return { ok: false, error: err.code === 'ENOENT' ? 'Directory not found' : err.message };
    }
  }

  /**
   * Search for text in files
   */
  async searchFiles(
    pattern: string,
    dirPath = '.',
    maxMatches = 50,
    agentName = 'unknown'
  ): Promise<SearchResult> {
    if (!this.initialized) {
      return { ok: false, error: 'Sandbox not initialized' };
    }

    // E2B doesn't have native search, fall back to manual
    const resolved = this.config.mode === 'local'
      ? this.validatePath(dirPath)
      : dirPath;

    if (this.config.mode === 'local' && !resolved) {
      return { ok: false, error: 'Path outside allowed directory' };
    }

    const matches: SearchMatch[] = [];
    const searchDir = resolved || this.config.allowedDirectory;

    await this.searchInDirectory(searchDir, pattern.toLowerCase(), matches, maxMatches);

    console.log(`[SharedSandbox] ${agentName} searched: "${pattern}" (${matches.length} matches)`);
    return { ok: true, matches };
  }

  private async searchInDirectory(
    dir: string,
    needle: string,
    matches: SearchMatch[],
    maxMatches: number
  ): Promise<void> {
    if (matches.length >= maxMatches) return;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (matches.length >= maxMatches) break;
        if (entry.name.startsWith('.')) continue;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Skip common non-code directories
          if (['node_modules', 'dist', 'build', '.git', 'coverage', '__pycache__'].includes(entry.name)) {
            continue;
          }
          await this.searchInDirectory(fullPath, needle, matches, maxMatches);
        } else if (entry.isFile()) {
          try {
            const content = await fs.readFile(fullPath, 'utf-8');
            const lines = content.split('\n');

            for (let i = 0; i < lines.length && matches.length < maxMatches; i++) {
              if (lines[i].toLowerCase().includes(needle)) {
                matches.push({
                  file: path.relative(this.config.allowedDirectory, fullPath),
                  line: i + 1,
                  content: lines[i].trim().slice(0, 200),
                });
              }
            }
          } catch {
            // Skip binary or unreadable files
          }
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  // ============================================================================
  // SHELL EXECUTION
  // ============================================================================

  /**
   * Execute a shell command
   */
  async executeShell(command: string, agentName = 'unknown'): Promise<ShellResult> {
    if (!this.initialized) {
      return { success: false, stdout: '', stderr: 'Sandbox not initialized', exitCode: 1 };
    }

    // Security check
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(command)) {
        return {
          success: false,
          stdout: '',
          stderr: 'Command forbidden by security policy',
          exitCode: 1,
        };
      }
    }

    if (this.config.mode === 'e2b' && this.e2bSandbox) {
      try {
        const result = await this.e2bSandbox.process.start({ cmd: command });
        await result.wait();
        console.log(`[SharedSandbox] ${agentName} executed: ${command}`);
        return {
          success: result.exitCode === 0,
          stdout: result.stdout || '',
          stderr: result.stderr || '',
          exitCode: result.exitCode,
        };
      } catch (error) {
        return {
          success: false,
          stdout: '',
          stderr: (error as Error).message,
          exitCode: 1,
        };
      }
    }

    // Local mode
    try {
      const stdout = execSync(command, {
        cwd: this.currentDirectory,
        encoding: 'utf-8',
        timeout: this.config.timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      });

      console.log(`[SharedSandbox] ${agentName} executed: ${command}`);
      return {
        success: true,
        stdout,
        stderr: '',
        exitCode: 0,
        executedIn: this.currentDirectory,
      };
    } catch (error) {
      const err = error as Error & { stdout?: string; stderr?: string; status?: number };
      return {
        success: false,
        stdout: err.stdout?.toString() || '',
        stderr: err.stderr?.toString() || err.message,
        exitCode: err.status || 1,
        executedIn: this.currentDirectory,
      };
    }
  }

  /**
   * Run git command
   */
  async git(args: string, agentName = 'unknown'): Promise<ShellResult> {
    return this.executeShell(`git ${args}`, agentName);
  }

  /**
   * Change directory (within allowed bounds)
   */
  async changeDirectory(targetPath: string, agentName = 'unknown'): Promise<ShellResult> {
    if (this.config.mode === 'e2b') {
      // E2B manages its own cwd
      return { success: true, stdout: `Changed to ${targetPath}`, stderr: '', exitCode: 0 };
    }

    const resolved = this.validatePath(targetPath);
    if (!resolved) {
      return {
        success: false,
        stdout: '',
        stderr: 'Path outside allowed directory',
        exitCode: 1,
      };
    }

    try {
      const stat = await fs.stat(resolved);
      if (!stat.isDirectory()) {
        return { success: false, stdout: '', stderr: 'Not a directory', exitCode: 1 };
      }

      this.currentDirectory = resolved;
      console.log(`[SharedSandbox] ${agentName} changed directory to: ${resolved}`);
      return {
        success: true,
        stdout: `Changed directory to: ${resolved}`,
        stderr: '',
        exitCode: 0,
        executedIn: resolved,
      };
    } catch (error) {
      return { success: false, stdout: '', stderr: (error as Error).message, exitCode: 1 };
    }
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  /**
   * Close the sandbox
   */
  async close(): Promise<void> {
    if (this.e2bSandbox) {
      try {
        await this.e2bSandbox.close();
        console.log('[SharedSandbox] E2B sandbox closed');
      } catch (error) {
        console.error('[SharedSandbox] Error closing E2B sandbox:', error);
      }
      this.e2bSandbox = null;
    }

    this.initialized = false;
    this.fileHistory = [];
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let sharedSandbox: SharedSandboxService | null = null;

/**
 * Get or create the shared sandbox instance
 */
export function getSharedSandbox(): SharedSandboxService {
  if (!sharedSandbox) {
    sharedSandbox = new SharedSandboxService();
  }
  return sharedSandbox;
}

/**
 * Initialize the shared sandbox (call once at startup)
 */
export async function initializeSharedSandbox(broadcast?: BroadcastFn): Promise<SharedSandboxService> {
  const sandbox = getSharedSandbox();
  await sandbox.initialize(broadcast);
  return sandbox;
}

/**
 * Close the shared sandbox (call at shutdown)
 */
export async function closeSharedSandbox(): Promise<void> {
  if (sharedSandbox) {
    await sharedSandbox.close();
    sharedSandbox = null;
  }
}

export { SharedSandboxService };
export default getSharedSandbox;
