#!/usr/bin/env bun
/**
 * Setup script to build ElizaOS plugins from the local eliza monorepo
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');
const elizaDir = join(rootDir, 'eliza');

// Plugins to build
const PLUGINS: string[] = [
  'plugin-openai',
  'plugin-anthropic',
  'plugin-groq',
  'plugin-sql',
  'plugin-goals',
  'plugin-todo',
  'plugin-inmemorydb',
  'plugin-agent-orchestrator',
  'plugin-code'
];

function run(cmd: string, cwd: string): boolean {
  console.log(`  Running: ${cmd}`);
  try {
    execSync(cmd, { cwd, stdio: 'inherit' });
    return true;
  } catch (error) {
    console.error(`  Failed: ${(error as Error).message}`);
    return false;
  }
}

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║   ElizaOS Plugin Setup for Eliza Town                ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  // Check if eliza directory exists
  if (!existsSync(elizaDir)) {
    console.error('Error: eliza directory not found at', elizaDir);
    process.exit(1);
  }

  // First build @elizaos/core
  console.log('\n📦 Building @elizaos/core...');
  const corePath = join(elizaDir, 'packages/typescript');
  if (existsSync(corePath)) {
    if (!existsSync(join(corePath, 'node_modules'))) {
      run('bun install', corePath);
    }
    run('bun run build', corePath);
  } else {
    console.log('  Core package not found, skipping');
  }

  // Build each plugin
  for (const plugin of PLUGINS) {
    console.log(`\n📦 Building ${plugin}...`);
    const pluginPath = join(elizaDir, 'plugins', plugin, 'typescript');
    
    if (!existsSync(pluginPath)) {
      console.log(`  Plugin not found at ${pluginPath}, skipping`);
      continue;
    }

    const distPath = join(pluginPath, 'dist');
    if (existsSync(distPath)) {
      console.log('  ✓ Already built');
      continue;
    }

    // Install dependencies and build
    if (!existsSync(join(pluginPath, 'node_modules'))) {
      run('bun install', pluginPath);
    }
    
    const buildSuccess = run('bun run build', pluginPath);
    if (buildSuccess) {
      console.log(`  ✓ Built ${plugin}`);
    } else {
      console.log(`  ✗ Failed to build ${plugin}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('Plugin setup complete!');
  console.log('Run "npm install" to link the plugins.');
  console.log('═══════════════════════════════════════════════════════\n');
}

main().catch(console.error);
