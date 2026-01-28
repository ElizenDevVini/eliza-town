/**
 * User Sandbox API Routes
 *
 * These routes provide per-user isolated sandbox environments.
 * Users are identified by their session ID (X-Session-ID header).
 * Each user gets their own directory for file operations and shell execution.
 *
 * These routes sit alongside the existing API routes and do NOT modify
 * the shared agent sandbox in any way.
 */

import { Router, Request, Response } from 'express';
import { getUserSandboxManager } from '../eliza/userSandboxManager.js';

const router = Router();

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Extract and validate session ID from request headers
 */
function getSessionId(req: Request): string | null {
  return (req.headers['x-session-id'] as string) || null;
}

/**
 * Middleware to require a session ID
 */
function requireSession(req: Request, res: Response, next: () => void): void {
  const sessionId = getSessionId(req);
  if (!sessionId) {
    res.status(400).json({
      error: 'Session ID required',
      message: 'Set the X-Session-ID header to identify your sandbox session.',
    });
    return;
  }
  next();
}

// ============================================================================
// SANDBOX STATUS & MANAGEMENT
// ============================================================================

/**
 * GET /api/sandbox/status
 * Get the current user's sandbox status and info
 */
router.get('/status', requireSession, async (req: Request, res: Response) => {
  try {
    const sessionId = getSessionId(req)!;
    const manager = getUserSandboxManager();
    const info = await manager.getSandboxInfo(sessionId);

    if (!info) {
      res.json({
        exists: false,
        sessionId,
        message: 'No sandbox created yet. Perform any file or shell operation to auto-create one.',
      });
      return;
    }

    res.json({
      exists: true,
      ...info,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /api/sandbox/stats
 * Get stats about all active user sandboxes (admin endpoint)
 */
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const manager = getUserSandboxManager();
    const stats = await manager.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * DELETE /api/sandbox
 * Close and clean up the current user's sandbox
 */
router.delete('/', requireSession, async (req: Request, res: Response) => {
  try {
    const sessionId = getSessionId(req)!;
    const manager = getUserSandboxManager();
    const closed = await manager.closeSandbox(sessionId);

    res.json({
      success: closed,
      message: closed ? 'Sandbox closed' : 'No sandbox found for this session',
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ============================================================================
// FILE OPERATIONS
// ============================================================================

/**
 * GET /api/sandbox/files
 * List files in the user's sandbox directory
 */
router.get('/files', requireSession, async (req: Request, res: Response) => {
  try {
    const sessionId = getSessionId(req)!;
    const dirPath = (req.query.path as string) || '.';

    const manager = getUserSandboxManager();
    const sandbox = await manager.getSandbox(sessionId);
    const result = await sandbox.listFiles(dirPath, `user:${sessionId}`);

    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      path: dirPath,
      items: result.items || [],
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /api/sandbox/files/read
 * Read a specific file from the user's sandbox
 */
router.get('/files/read', requireSession, async (req: Request, res: Response) => {
  try {
    const sessionId = getSessionId(req)!;
    const filepath = req.query.path as string;

    if (!filepath) {
      res.status(400).json({ error: 'path query parameter is required' });
      return;
    }

    const manager = getUserSandboxManager();
    const sandbox = await manager.getSandbox(sessionId);
    const result = await sandbox.readFile(filepath, `user:${sessionId}`);

    if (!result.ok) {
      res.status(404).json({ error: result.error });
      return;
    }

    res.json({
      filepath,
      content: result.content,
      size: result.content?.length || 0,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * POST /api/sandbox/files/write
 * Write a file to the user's sandbox
 */
router.post('/files/write', requireSession, async (req: Request, res: Response) => {
  try {
    const sessionId = getSessionId(req)!;
    const { filepath, content } = req.body as { filepath?: string; content?: string };

    if (!filepath) {
      res.status(400).json({ error: 'filepath is required' });
      return;
    }
    if (content === undefined) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    const manager = getUserSandboxManager();
    const sandbox = await manager.getSandbox(sessionId);
    const result = await sandbox.writeFile(filepath, content, `user:${sessionId}`);

    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.status(201).json({
      success: true,
      filepath: result.filepath,
      size: result.size,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * POST /api/sandbox/files/edit
 * Edit a file in the user's sandbox (find and replace)
 */
router.post('/files/edit', requireSession, async (req: Request, res: Response) => {
  try {
    const sessionId = getSessionId(req)!;
    const { filepath, oldStr, newStr } = req.body as {
      filepath?: string;
      oldStr?: string;
      newStr?: string;
    };

    if (!filepath || !oldStr || newStr === undefined) {
      res.status(400).json({ error: 'filepath, oldStr, and newStr are required' });
      return;
    }

    const manager = getUserSandboxManager();
    const sandbox = await manager.getSandbox(sessionId);
    const result = await sandbox.editFile(filepath, oldStr, newStr, `user:${sessionId}`);

    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      filepath: result.filepath,
      size: result.size,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * POST /api/sandbox/files/search
 * Search for text in files within the user's sandbox
 */
router.post('/files/search', requireSession, async (req: Request, res: Response) => {
  try {
    const sessionId = getSessionId(req)!;
    const { pattern, path: dirPath } = req.body as { pattern?: string; path?: string };

    if (!pattern) {
      res.status(400).json({ error: 'pattern is required' });
      return;
    }

    const manager = getUserSandboxManager();
    const sandbox = await manager.getSandbox(sessionId);
    const result = await sandbox.searchFiles(pattern, dirPath || '.', 50, `user:${sessionId}`);

    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      pattern,
      matches: result.matches || [],
      count: result.matches?.length || 0,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ============================================================================
// SHELL EXECUTION
// ============================================================================

/**
 * POST /api/sandbox/execute
 * Execute a shell command in the user's sandbox
 */
router.post('/execute', requireSession, async (req: Request, res: Response) => {
  try {
    const sessionId = getSessionId(req)!;
    const { command } = req.body as { command?: string };

    if (!command) {
      res.status(400).json({ error: 'command is required' });
      return;
    }

    const manager = getUserSandboxManager();
    const sandbox = await manager.getSandbox(sessionId);
    const result = await sandbox.executeShell(command, `user:${sessionId}`);

    res.json({
      success: result.success,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      executedIn: result.executedIn,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ============================================================================
// RECENT CHANGES
// ============================================================================

/**
 * GET /api/sandbox/changes
 * Get recent file changes in the user's sandbox
 */
router.get('/changes', requireSession, async (req: Request, res: Response) => {
  try {
    const sessionId = getSessionId(req)!;
    const limit = parseInt((req.query.limit as string) || '20', 10);

    const manager = getUserSandboxManager();

    if (!manager.hasSandbox(sessionId)) {
      res.json({ changes: [], count: 0 });
      return;
    }

    const sandbox = await manager.getSandbox(sessionId);
    const changes = sandbox.getRecentChanges(limit);

    res.json({
      changes,
      count: changes.length,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
