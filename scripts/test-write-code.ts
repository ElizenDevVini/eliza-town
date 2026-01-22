#!/usr/bin/env bun
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

import { AgentRuntime, createMessageMemory, stringToUuid, ChannelType } from '@elizaos/core';
import { elizaTownPlugin, initializePlugin, updateAgentState } from '../src/eliza/elizaTownPlugin.js';
import * as storage from '../src/storage/index.js';

interface ActionCall {
  name: string;
  args?: Record<string, unknown>;
}

const actionCalls: ActionCall[] = [];

interface ActionHandler {
  (...args: unknown[]): Promise<unknown>;
}

interface Action {
  name: string;
  handler: ActionHandler;
  [key: string]: unknown;
}

interface Plugin {
  name: string;
  actions: Action[];
  [key: string]: unknown;
}

const trackedPlugin: Plugin = {
  ...elizaTownPlugin,
  actions: (elizaTownPlugin as Plugin).actions.map((action: Action) => {
    const original = action.handler;
    return {
      ...action,
      handler: async (...args: unknown[]): Promise<unknown> => {
        console.log(`🎯 ACTION: ${action.name}`);
        const options = args[3] as { parameters?: Record<string, unknown> } | undefined;
        actionCalls.push({ name: action.name, args: options?.parameters });
        return original(...args);
      }
    };
  })
};

interface GroqPlugin {
  default?: Plugin;
  groqPlugin?: Plugin;
}

interface InmemPlugin {
  default?: Plugin;
  plugin?: Plugin;
}

interface RuntimeOptions {
  character: {
    name: string;
    username: string;
    role: string;
    bio: string[];
    system: string;
  };
  plugins: Plugin[];
  actionPlanning: boolean;
  enableAutonomy: boolean;
}

interface Content {
  text?: string;
  [key: string]: unknown;
}

interface HandleResult {
  didRespond: boolean;
  responseContent?: Content;
}

async function test(): Promise<void> {
  console.log('=== Testing WRITE_CODE Action ===\n');
  
  const groqPlugin = await import('@elizaos/plugin-groq') as GroqPlugin;
  const inmemPlugin = await import('@elizaos/plugin-inmemorydb') as InmemPlugin;
  
  const runtimeOptions: RuntimeOptions = {
    character: {
      name: 'Ada',
      username: 'ada-coder',
      role: 'coder',
      bio: ['A skilled coder'],
      system: 'You are Ada, a coder. Use WRITE_CODE to save code files.'
    },
    plugins: [
      trackedPlugin,
      { ...(groqPlugin.default || groqPlugin), tests: undefined } as Plugin,
      { ...(inmemPlugin.default || inmemPlugin), tests: undefined } as Plugin
    ],
    actionPlanning: true,
    enableAutonomy: false
  };
  
  const runtime = new (AgentRuntime as new (options: RuntimeOptions) => {
    setSetting: (key: string, value: unknown, isSecret?: boolean) => void;
    initialize: () => Promise<void>;
    ensureConnection: (config: unknown) => Promise<void>;
    messageService: {
      handleMessage: (runtime: unknown, message: unknown, callback: () => Promise<unknown[]>) => Promise<HandleResult>;
    };
    stop: () => Promise<void>;
  })(runtimeOptions);
  
  runtime.setSetting('GROQ_API_KEY', process.env.GROQ_API_KEY, true);
  runtime.setSetting('CHECK_SHOULD_RESPOND', false);
  
  await runtime.initialize();
  
  const roomId = (stringToUuid as (s: string) => string)('test-room');
  const entityId = (stringToUuid as (s: string) => string)('test-narrator');
  
  await runtime.ensureConnection({
    entityId,
    roomId,
    worldId: (stringToUuid as (s: string) => string)('test-world'),
    userName: 'Tester',
    source: 'test',
    channelId: 'test',
    type: ChannelType
  });
  
  initializePlugin(null, null, storage);
  updateAgentState('ada-coder', { name: 'Ada', hub: 'coding_desk', status: 'idle', role: 'coder' });
  
  console.log('Asking coder to write a function...');
  
  const message = (createMessageMemory as (options: unknown) => unknown)({
    id: (stringToUuid as (s: string) => string)('test-msg-' + Date.now()),
    entityId,
    roomId,
    content: {
      text: `Write a JavaScript function that adds two numbers. 
Use the WRITE_CODE action with:
- taskId: 1001
- filename: add.js  
- code: your implementation

You MUST use WRITE_CODE to save the file.`,
      source: 'test'
    }
  });
  
  const result = await runtime.messageService.handleMessage(runtime, message, async () => []);
  
  console.log('\n=== RESULTS ===');
  console.log('didRespond:', result.didRespond);
  console.log('Response:', result.responseContent?.text?.substring(0, 200) || 'none');
  console.log('\nActions called:', actionCalls.map(a => a.name).join(', ') || 'NONE');
  
  // Check if file was created
  try {
    const files = await storage.getTaskFiles(1001);
    if (files.length > 0) {
      console.log('\n✅ FILES CREATED:');
      for (const f of files) {
        console.log(`  - ${f.name} (${f.size} bytes)`);
        const content = await storage.getTaskFile(1001, f.name);
        console.log(`    Content preview: ${content.substring(0, 100)}...`);
      }
    } else {
      console.log('\n⚠️ No files created - WRITE_CODE may not have been invoked');
    }
  } catch (e) {
    console.log('\n⚠️ Could not check files:', (e as Error).message);
  }
  
  await runtime.stop();
}

test().catch(console.error);
