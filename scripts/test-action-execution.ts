#!/usr/bin/env bun
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

import { AgentRuntime, createMessageMemory, stringToUuid, ChannelType } from '@elizaos/core';
import { elizaTownPlugin, initializePlugin, updateAgentState } from '../src/eliza/elizaTownPlugin.js';

interface ActionCall {
  name: string;
  time: number;
}

// Track action calls
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

// Wrap action handlers to track calls
const trackedPlugin: Plugin = {
  ...elizaTownPlugin,
  actions: (elizaTownPlugin as Plugin).actions.map((action: Action) => {
    const original = action.handler;
    return {
      ...action,
      handler: async (...args: unknown[]): Promise<unknown> => {
        console.log(`\n🎯 ACTION HANDLER CALLED: ${action.name}`);
        actionCalls.push({ name: action.name, time: Date.now() });
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
  console.log('=== Testing ElizaOS Action Execution ===\n');
  
  const groqPlugin = await import('@elizaos/plugin-groq') as GroqPlugin;
  const inmemPlugin = await import('@elizaos/plugin-inmemorydb') as InmemPlugin;
  
  const runtimeOptions: RuntimeOptions = {
    character: {
      name: 'TestAgent',
      username: 'test-agent',
      bio: ['A test agent'],
      system: 'You are a test agent. Always use the SPEAK action when responding.'
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
      handleMessage: (runtime: unknown, message: unknown, callback: (content: Content) => Promise<unknown[]>) => Promise<HandleResult>;
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
  
  initializePlugin(null, null, null);
  updateAgentState('test-agent', { name: 'TestAgent', hub: 'town_square', status: 'idle' });
  
  console.log('Sending message asking agent to use SPEAK...');
  
  const message = (createMessageMemory as (options: unknown) => unknown)({
    id: (stringToUuid as (s: string) => string)('test-msg-' + Date.now()),
    entityId,
    roomId,
    content: {
      text: 'Please use the SPEAK action to say "Hello World".',
      source: 'test'
    }
  });
  
  const result = await runtime.messageService.handleMessage(
    runtime,
    message,
    async (_content: Content): Promise<unknown[]> => {
      console.log('📤 Callback received');
      return [];
    }
  );
  
  console.log('\n=== RESULTS ===');
  console.log('didRespond:', result.didRespond);
  console.log('Response text:', result.responseContent?.text?.substring(0, 150) || 'none');
  console.log('\n🎯 ACTION HANDLERS ACTUALLY CALLED:', actionCalls.length > 0 ? actionCalls.map(a => a.name).join(', ') : '❌ NONE!');
  
  if (actionCalls.length === 0) {
    console.log('\n⚠️  WARNING: LLM may have specified actions but ElizaOS did NOT execute handlers!');
    console.log('Actions in response are potentially DECORATIVE.');
  } else {
    console.log('\n✅ Actions are being executed by ElizaOS!');
  }
  
  await runtime.stop();
}

test().catch(err => {
  console.error('Error:', (err as Error).message);
  process.exit(1);
});
