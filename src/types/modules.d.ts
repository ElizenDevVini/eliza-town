// Module declarations for packages without types

declare module 'express' {
  import { Server, IncomingMessage, ServerResponse } from 'http';
  
  export interface Request<P = Record<string, string>, ResBody = any, ReqBody = any, ReqQuery = Record<string, string>> {
    params: P;
    body: ReqBody;
    query: ReqQuery;
    headers: Record<string, string | string[] | undefined>;
    path: string;
  }
  
  export interface Response<ResBody = any> {
    json: (body: ResBody) => this;
    status: (code: number) => this;
    send: (body: any) => this;
    setHeader: (name: string, value: string) => this;
    sendFile: (path: string) => this;
  }
  
  export type NextFunction = (err?: Error) => void;
  
  export type RequestHandler<P = any, ResBody = any, ReqBody = any, ReqQuery = any> = 
    (req: Request<P, ResBody, ReqBody, ReqQuery>, res: Response<ResBody>, next: NextFunction) => void | Promise<void>;
  
  export interface IRouter {
    get: (path: string, ...handlers: RequestHandler[]) => IRouter;
    post: (path: string, ...handlers: RequestHandler[]) => IRouter;
    patch: (path: string, ...handlers: RequestHandler[]) => IRouter;
    put: (path: string, ...handlers: RequestHandler[]) => IRouter;
    delete: (path: string, ...handlers: RequestHandler[]) => IRouter;
  }
  
  export function Router(): IRouter;
  
  export interface StaticOptions {
    extensions?: string[];
    setHeaders?: (res: Response, filepath: string) => void;
  }
  
  export interface Application {
    use: (...args: any[]) => Application;
    get: (path: string, ...handlers: RequestHandler[]) => Application;
    post: (path: string, ...handlers: RequestHandler[]) => Application;
    listen(port: number | string, callback?: () => void): Server;
    listen(port: number | string, hostname: string, callback?: () => void): Server;
  }
  
  interface Express {
    (): Application;
    json(): RequestHandler;
    static(root: string, options?: StaticOptions): RequestHandler;
    Router(): IRouter;
  }
  
  const express: Express;
  export default express;
}

declare module 'cors' {
  import { RequestHandler } from 'express';
  export default function cors(): RequestHandler;
}

declare module 'pg' {
  export interface QueryResult<T = Record<string, any>> {
    rows: T[];
    rowCount: number | null;
    command: string;
    fields: {
      name: string;
      dataTypeID: number;
    }[];
  }
  
  export type QueryResultRow = Record<string, any>;
  
  export interface PoolConfig {
    connectionString?: string;
    ssl?: boolean | { rejectUnauthorized: boolean };
  }
  
  export class Pool {
    constructor(config?: PoolConfig);
    query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>>;
    end(): Promise<void>;
  }
  
  const pg: {
    Pool: typeof Pool;
  };
  
  export default pg;
}

declare module '@elizaos/core' {
  export class AgentRuntime {
    constructor(config: any);
    character?: {
      name?: string;
      username?: string;
      role?: string;
    };
    agentId: string;
    messageService?: {
      handleMessage: (runtime: any, message: any, callback: (content: any) => Promise<any[]>) => Promise<any>;
    };
    setSetting: (key: string, value: string | boolean, isSecret?: boolean) => void;
    initialize: () => Promise<void>;
    stop: () => Promise<void>;
    ensureConnection: (config: any) => Promise<void>;
    createMemory: (memory: any, tableName?: string) => Promise<void>;
  }
  
  export const ChannelType: {
    GROUP: string;
    DIRECT: string;
  };
  
  export function createMessageMemory(config: any): any;
  export function stringToUuid(s: string): string;
  
  export const LLMMode: {
    SMALL: string;
    LARGE: string;
  };
}

declare module '@elizaos/plugin-openai' {
  const plugin: any;
  export default plugin;
}

declare module '@elizaos/plugin-anthropic' {
  const plugin: any;
  export default plugin;
}

declare module '@elizaos/plugin-groq' {
  const plugin: any;
  export default plugin;
}

declare module '@elizaos/plugin-inmemorydb' {
  export const plugin: any;
  const _default: any;
  export default _default;
}

declare module '@elizaos/plugin-sql' {
  export const plugin: any;
  const _default: any;
  export default _default;
}

declare module '@elizaos/plugin-goals' {
  export const GoalsPlugin: any;
  const _default: any;
  export default _default;
}

declare module '@elizaos/plugin-todo' {
  export const todoPlugin: any;
  const _default: any;
  export default _default;
}

declare module '@e2b/code-interpreter' {
  export class CodeInterpreter {
    static create(options?: any): Promise<CodeInterpreter>;
    close(): Promise<void>;
    notebook: {
      execCell(code: string): Promise<{
        results: Array<{ data?: any; error?: any }>;
        logs: { stdout: string[]; stderr: string[] };
      }>;
    };
  }
  
  export class Sandbox {
    static create(options?: any): Promise<Sandbox>;
    close(): Promise<void>;
    filesystem: {
      read(path: string): Promise<string>;
      write(path: string, content: string): Promise<void>;
      list(path: string): Promise<Array<{ name: string; isDir: boolean }>>;
    };
    commands: {
      run(command: string): Promise<{
        stdout: string;
        stderr: string;
        exitCode: number;
      }>;
    };
  }
}
