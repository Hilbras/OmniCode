import { join } from 'pathe';

import type { IHostFileSystem } from '@hilbras/omnicode-engine/os/interface/hostFileSystem';
import { IAgentRuntimeService, inspectAgentRuntime } from '@hilbras/omnicode-engine/agent/runtimeBinding/agentRuntime';
import { IAgentScopeContext } from '@hilbras/omnicode-engine/agent/scopeContext/scopeContext';
import { RuntimeWorkspaceView } from '@hilbras/omnicode-engine/runtime/runtimeWorkspaceView';
import { ISessionContext } from '@hilbras/omnicode-engine/session/sessionContext/sessionContext';
import { ISessionSkillCatalog } from '@hilbras/omnicode-engine/features/skill/session/skillCatalog';
import { ISessionWorkspaceContext } from '@hilbras/omnicode-engine/session/workspaceContext/workspaceContext';
import { ToolAccesses, type ExecutableToolContext, type ToolExecution } from '@hilbras/omnicode-engine/tool/toolContract';
import { registerAgentToolService } from '@hilbras/omnicode-engine/agent/toolRegistry/toolContribution';
import { toInputJsonSchema } from '@hilbras/omnicode-engine/tool/input-schema';
import {
  resolvePathAccessPath,
  type WorkspaceConfig,
} from '@hilbras/omnicode-engine/tool/path-access';

import {
  ARTIFACT_DIR,
  ARTIFACT_KIND,
  DEFAULT_ARTIFACT_MAX_CHARS,
  DEFAULT_SOURCE_EXCERPT_CHARS,
  SOURCE_DIR,
  SOURCE_KIND,
  SessionRecordStore,
  sourceLines,
  sourceLocation,
  type RecordProvenance,
  type RecordSourceLocation,
} from './recordStore';
import {
  ArtifactRecordInputSchema,
  IArtifactRecordTool,
  ISourceRecordTool,
  SourceRecordInputSchema,
  type ArtifactRecordInput,
  type SourceRecordInput,
} from './records';

const SOURCE_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_SOURCE_LINES = 200;

export class ArtifactRecordTool implements IArtifactRecordTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'ArtifactRecord' as const;
  readonly description =
    'Record bounded textual artifact content plus provenance in the session data area. Does not write arbitrary filesystem paths.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(ArtifactRecordInputSchema);

  constructor(
    @IAgentRuntimeService private readonly runtime: IAgentRuntimeService,
    @ISessionContext private readonly session: ISessionContext,
    @IAgentScopeContext private readonly scope: IAgentScopeContext,
  ) {}

  resolveExecution(args: ArtifactRecordInput): ToolExecution {
    const directory = join(this.session.sessionDir, ARTIFACT_DIR);
    return {
      accesses: ToolAccesses.writeTree(directory),
      description: `Recording artifact ${args.name}`,
      display: { kind: 'generic', summary: `Record artifact ${args.name}` },
      approvalRule: this.name,
      execute: async (ctx) => {
        const lease = this.runtime.acquire(['fs']);
        try {
          const fs = lease.runtime.fs;
          if (fs === undefined) return { isError: true, output: 'Filesystem runtime is unavailable.' };
          const store = new SessionRecordStore(fs, this.session.sessionDir);
          const saved = await store.save({
            kind: ARTIFACT_KIND,
            name: args.name,
            content: args.content,
            maxChars: args.max_chars ?? DEFAULT_ARTIFACT_MAX_CHARS,
            ...(args.media_type === undefined ? {} : { mediaType: args.media_type }),
            ...(args.note === undefined ? {} : { note: args.note }),
            provenance: provenance(this.session.sessionId, this.scope.agentId, ctx),
          });
          return { output: renderSavedRecord(saved.relativePath, saved.record) };
        } catch (error) {
          return { isError: true, output: error instanceof Error ? error.message : String(error) };
        } finally {
          lease.dispose();
        }
      },
    };
  }
}

export class SourceRecordTool implements ISourceRecordTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'SourceRecord' as const;
  readonly description =
    'Record a bounded excerpt of a source file plus path, line range, hash, and provenance in the session data area. Reads through workspace path rules and never writes outside session storage.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(SourceRecordInputSchema);

  constructor(
    @IAgentRuntimeService private readonly runtime: IAgentRuntimeService,
    @ISessionContext private readonly session: ISessionContext,
    @IAgentScopeContext private readonly scope: IAgentScopeContext,
    @ISessionWorkspaceContext private readonly workspaceCtx: ISessionWorkspaceContext,
    @ISessionSkillCatalog private readonly skillCatalog?: ISessionSkillCatalog,
  ) {}

  resolveExecution(args: SourceRecordInput): ToolExecution {
    const inspected = inspectAgentRuntime(this.runtime);
    const view = new RuntimeWorkspaceView(inspected, {
      workDir: this.workspaceCtx.workDir,
      additionalDirs: [
        ...this.workspaceCtx.additionalDirs,
        ...(this.skillCatalog?.catalog.getSkillRoots() ?? []),
      ],
    });
    const env = { _serviceBrand: undefined, ...inspected.environment, ready: Promise.resolve() };
    const workspace: WorkspaceConfig = {
      workspaceDir: view.workDir,
      additionalDirs: view.additionalDirs,
    };
    let sourcePath: string;
    try {
      sourcePath = resolvePathAccessPath(args.path, { env, workspace, operation: 'read' });
    } catch (error) {
      return { isError: true, output: error instanceof Error ? error.message : String(error) };
    }
    const recordDir = join(this.session.sessionDir, SOURCE_DIR);
    return {
      accesses: [...ToolAccesses.readFile(sourcePath), ...ToolAccesses.writeTree(recordDir)],
      description: `Recording source ${args.path}`,
      display: { kind: 'generic', summary: `Record source ${args.path}` },
      approvalRule: this.name,
      execute: async (ctx) => {
        const lease = this.runtime.acquire(['fs']);
        try {
          const fs = lease.runtime.fs;
          if (fs === undefined) return { isError: true, output: 'Filesystem runtime is unavailable.' };
          try {
            return await this.execution(fs, args, sourcePath, ctx);
          } catch (error) {
            return { isError: true, output: error instanceof Error ? error.message : String(error) };
          }
        } finally {
          lease.dispose();
        }
      },
    };
  }

  private async execution(
    fs: IHostFileSystem,
    args: SourceRecordInput,
    sourcePath: string,
    ctx: ExecutableToolContext,
  ): Promise<{ output: string; isError?: boolean }> {
    const stat = await fs.stat(sourcePath);
    if (!stat.isFile) return { isError: true, output: `${args.path} is not a file.` };
    if (stat.size > SOURCE_MAX_BYTES) {
      return {
        isError: true,
        output: `Source file is ${String(stat.size)} bytes; limit is ${String(SOURCE_MAX_BYTES)}.`,
      };
    }
    const text = await fs.readText(sourcePath);
    const lines = sourceLines(text);
    const startLine = args.start_line ?? 1;
    let source: RecordSourceLocation;
    let content: string;
    if (lines.length === 0) {
      source = { path: sourcePath, startLine: 1, endLine: 0, totalLines: 0 };
      content = '';
    } else {
      const endLine = args.end_line ?? Math.min(startLine + DEFAULT_SOURCE_LINES - 1, lines.length);
      const located = sourceLocation(sourcePath, lines, startLine, endLine);
      source = located.source;
      content = located.content;
    }
    try {
      const store = new SessionRecordStore(fs, this.session.sessionDir);
      const saved = await store.save({
        kind: SOURCE_KIND,
        name: args.path,
        content,
        maxChars: args.max_chars ?? DEFAULT_SOURCE_EXCERPT_CHARS,
        ...(args.note === undefined ? {} : { note: args.note }),
        source,
        provenance: provenance(this.session.sessionId, this.scope.agentId, ctx),
      });
      return { output: renderSavedRecord(saved.relativePath, saved.record) };
    } catch (error) {
      return { isError: true, output: error instanceof Error ? error.message : String(error) };
    }
  }
}

function provenance(
  sessionId: string,
  agentId: string,
  ctx: ExecutableToolContext,
): RecordProvenance {
  return {
    sessionId,
    agentId,
    toolCallId: ctx.toolCallId,
    turnId: ctx.turnId,
    origin: 'agent-tool',
  };
}

function renderSavedRecord(relativePath: string, record: object): string {
  return JSON.stringify({ path: relativePath, record }, null, 2);
}

registerAgentToolService(IArtifactRecordTool, ArtifactRecordTool, {
  name: 'ArtifactRecord',
  domain: 'records',
  requiredRuntimeCapabilities: ['fs'],
});
registerAgentToolService(ISourceRecordTool, SourceRecordTool, {
  name: 'SourceRecord',
  domain: 'records',
  requiredRuntimeCapabilities: ['fs'],
});
