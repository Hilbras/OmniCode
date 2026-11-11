import { EventEmitter } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import * as pathe from 'pathe';

import type { Event } from '@hilbras/omnicode-base/event';
import type { IAgentRuntimeService } from '@hilbras/omnicode-engine/agent/runtimeBinding/agentRuntime';
import type { IAgentScopeContext } from '@hilbras/omnicode-engine/agent/scopeContext/scopeContext';
import type { HostEnvironmentInfo } from '@hilbras/omnicode-engine/os/interface/hostEnvironment';
import type { IHostFileSystem } from '@hilbras/omnicode-engine/os/interface/hostFileSystem';
import type {
  HostProcessOptions,
  IHostProcess,
  IHostProcessService,
} from '@hilbras/omnicode-engine/os/interface/hostProcess';
import type { Runtime } from '@hilbras/omnicode-engine/runtime/runtime';
import type { ISessionContext } from '@hilbras/omnicode-engine/session/sessionContext/sessionContext';
import type { ISessionWorkspaceContext } from '@hilbras/omnicode-engine/session/workspaceContext/workspaceContext';
import type { ExecutableToolContext } from '@hilbras/omnicode-engine/tool/toolContract';

export const TEST_ENVIRONMENT: HostEnvironmentInfo = {
  osKind: 'linux',
  osArch: 'x64',
  osVersion: 'test',
  shellName: 'bash',
  shellPath: '/bin/bash',
  pathClass: 'posix',
  homeDir: '/home/test',
};

export interface TestRuntimeOptions {
  readonly fs?: IHostFileSystem;
  readonly process?: IHostProcessService;
  readonly workDir: string;
  readonly additionalDirs?: readonly string[];
}

export interface TestRuntime {
  readonly runtime: Runtime;
  readonly runtimeService: IAgentRuntimeService;
  readonly workspaceCtx: ISessionWorkspaceContext;
  readonly sessionCtx: ISessionContext;
  readonly scopeCtx: IAgentScopeContext;
  readonly context: ExecutableToolContext;
}

export function makeTestRuntime(options: TestRuntimeOptions): TestRuntime {
  const additionalDirs = options.additionalDirs ?? [];
  const capabilities = new Set<'fs' | 'process'>();
  if (options.fs !== undefined) capabilities.add('fs');
  if (options.process !== undefined) capabilities.add('process');
  const statusEmitter = new EventEmitter();
  const runtime: Runtime = {
    identity: { workspaceId: 'workspace-test', runtimeId: 'runtime-test', generation: '1' },
    capabilities,
    environment: TEST_ENVIRONMENT,
    path: {
      separator: '/',
      delimiter: ':',
      isAbsolute: pathe.isAbsolute,
      join: pathe.join,
      relative: pathe.relative,
      resolve: pathe.resolve,
      basename: pathe.basename,
      dirname: pathe.dirname,
    },
    workspace: { mapRoots: (roots) => roots },
    ...(options.fs === undefined ? {} : { fs: options.fs }),
    ...(options.process === undefined ? {} : { process: options.process }),
    status: 'ready',
    onDidChangeStatus: ((listener: (value: Runtime['status']) => void) => {
      statusEmitter.on('status', listener);
      return { dispose: () => statusEmitter.off('status', listener) };
    }) as Event<Runtime['status']>,
    dispose: () => {},
  };
  const runtimeService = {
    _serviceBrand: undefined,
    onDidChange: (() => ({ dispose: () => {} })) as Event<void>,
    inspect: () => runtime,
    isAvailable: () => true,
    acquire: () => ({ runtime, track: <T>(value: T) => value, dispose: () => {} }),
  } as unknown as IAgentRuntimeService;
  const workspaceCtx: ISessionWorkspaceContext = {
    _serviceBrand: undefined,
    workDir: options.workDir,
    additionalDirs,
    resolve: (rel) => pathe.resolve(options.workDir, rel),
    isWithin: (absPath) => pathe.isAbsolute(absPath) && absPath.startsWith(options.workDir),
    assertAllowed: (absPath) => absPath,
  };
  const sessionCtx: ISessionContext = {
    _serviceBrand: undefined,
    sessionId: 'session-test',
    workspaceId: 'workspace-test',
    sessionDir: options.workDir,
    metaScope: 'test',
    cwd: options.workDir,
    scope: (subKey) => (subKey === undefined ? 'test' : `test/${subKey}`),
  };
  const scopeCtx: IAgentScopeContext = {
    _serviceBrand: undefined,
    agentId: 'agent-test',
    scope: (subKey?: string) => (subKey === undefined ? 'agent-test' : `agent-test/${subKey}`),
  } as unknown as IAgentScopeContext;
  const context: ExecutableToolContext = {
    turnId: 7,
    toolCallId: 'call-test',
    signal: new AbortController().signal,
  };
  return { runtime, runtimeService, workspaceCtx, sessionCtx, scopeCtx, context };
}

export interface FakeGitCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
}

export interface FakeGitResponse {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
}

export function createFakeProcessService(
  handler: (call: FakeGitCall) => FakeGitResponse | Promise<FakeGitResponse>,
  calls: FakeGitCall[] = [],
): IHostProcessService {
  return {
    _serviceBrand: undefined,
    spawn: async (command: string, args: readonly string[] = [], options?: HostProcessOptions) => {
      const call = { command, args, cwd: options?.cwd };
      calls.push(call);
      const response = await handler(call);
      return makeProcess(response);
    },
  };
}

function makeProcess(response: FakeGitResponse): IHostProcess {
  const stdout = Readable.from([response.stdout ?? '']);
  const stderr = Readable.from([response.stderr ?? '']);
  const stdin = new PassThrough();
  return {
    _serviceBrand: undefined,
    pid: 1000,
    exitCode: null,
    stdin,
    stdout,
    stderr,
    wait: async () => {
      await Promise.all([finished(stdout), finished(stderr)]);
      return response.exitCode ?? 0;
    },
    kill: async () => {},
    dispose: () => {},
  };
}
