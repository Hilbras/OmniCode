import { Buffer } from 'node:buffer';

import multipart from '@fastify/multipart';
import {
  CoreErrors,
  Error2,
  ErrorCodes,
  ICatalogManagementService,
  isError2,
  MAX_ARCHIVE_BYTES,
  type CatalogCreateInput,
  type Scope,
} from '@hilbras/omnicode-core';
import { z } from 'zod';

import { defineRoute } from '../../middleware/defineRoute';
import { errEnvelope, okEnvelope } from '../../protocol/envelope';
import { ErrorCode } from '../../protocol/error-codes';

interface UploadPart {
  readonly file: AsyncIterable<Buffer>;
  readonly filename: string;
}

interface CatalogRequest {
  readonly id: string;
  readonly body?: unknown;
  readonly query: { readonly cwd?: string };
  readonly headers: Record<string, unknown>;
  readonly file?: () => Promise<UploadPart | undefined>;
}

interface CatalogReply {
  send(payload: unknown): unknown;
  header(name: string, value: string): unknown;
  type(mime: string): CatalogReply;
}

interface V2CatalogRouteHost {
  register(plugin: unknown, opts: Record<string, unknown>): unknown;
  get(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> },
    handler: (req: CatalogRequest, reply: CatalogReply) => Promise<void> | void,
  ): unknown;
  post(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> },
    handler: (req: CatalogRequest, reply: CatalogReply) => Promise<void> | void,
  ): unknown;
}

const catalogQuerySchema = z.object({ cwd: z.string().min(1).optional() });

const createBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  content: z.string().min(1),
  when_to_use: z.string().min(1).optional(),
});

const skillEntrySchema = z.object({
  name: z.string(),
  description: z.string(),
  source: z.string(),
  path: z.string(),
  disabled: z.boolean(),
});

const agentEntrySchema = z.object({
  name: z.string(),
  description: z.string(),
  source: z.string(),
  path: z.string(),
  when_to_use: z.string().optional(),
  tools: z.array(z.string()).optional(),
  disallowed_tools: z.array(z.string()).optional(),
});

const importSummarySchema = z.object({
  imported: z.array(z.string()),
  skipped: z.array(z.string()),
  errors: z.array(z.string()),
});

const detailsSchema = z.array(z.object({ path: z.string(), message: z.string() }));

const errorSchemas = {
  [ErrorCode.VALIDATION_FAILED]: { detailsSchema },
  [ErrorCode.SKILL_NOT_FOUND]: {},
};

function sendMappedError(reply: CatalogReply, requestId: string, err: unknown): void {
  if (isError2(err)) {
    if (err.code === CoreErrors.codes.VALIDATION_FAILED) {
      reply.send(errEnvelope(ErrorCode.VALIDATION_FAILED, err.message, requestId, err.stack));
      return;
    }
    if (err.code === ErrorCodes.SKILL_NOT_FOUND) {
      reply.send(errEnvelope(ErrorCode.SKILL_NOT_FOUND, err.message, requestId, err.stack));
      return;
    }
  }
  throw err;
}

function toCreateInput(body: z.infer<typeof createBodySchema>): CatalogCreateInput {
  return {
    name: body.name,
    description: body.description,
    content: body.content,
    ...(body.when_to_use === undefined ? {} : { whenToUse: body.when_to_use }),
  };
}

function toSkillEntry(
  skill: {
    readonly name: string;
    readonly description: string;
    readonly source: string;
    readonly path: string;
  },
  disabled: boolean,
): z.infer<typeof skillEntrySchema> {
  return {
    name: skill.name,
    description: skill.description,
    source: skill.source,
    path: skill.path,
    disabled,
  };
}

function toAgentEntry(agent: {
  readonly name: string;
  readonly description: string;
  readonly source: string;
  readonly path: string;
  readonly whenToUse?: string;
  readonly tools?: readonly string[];
  readonly disallowedTools?: readonly string[];
}): z.infer<typeof agentEntrySchema> {
  return {
    name: agent.name,
    description: agent.description,
    source: agent.source,
    path: agent.path,
    ...(agent.whenToUse === undefined ? {} : { when_to_use: agent.whenToUse }),
    ...(agent.tools === undefined ? {} : { tools: [...agent.tools] }),
    ...(agent.disallowedTools === undefined ? {} : { disallowed_tools: [...agent.disallowedTools] }),
  };
}

function download(
  reply: CatalogReply,
  fileName: string,
  bytes: Buffer,
): void {
  reply.header('cache-control', 'no-store');
  reply.header('content-disposition', `attachment; filename="${fileName.replace(/"/g, '')}"`);
  reply.type('application/zip');
  reply.send(bytes);
}

function mapped(reply: { send(payload: unknown): unknown }, requestId: string, err: unknown): void {
  sendMappedError(reply as unknown as CatalogReply, requestId, err);
}

function typedRequest(request: unknown): CatalogRequest {
  const req = request as Partial<CatalogRequest> & Pick<CatalogRequest, 'id' | 'headers'>;
  return {
    id: req.id,
    query: (req.query ?? {}) as CatalogRequest['query'],
    headers: req.headers,
    ...(req.body === undefined ? {} : { body: req.body }),
    ...(typeof req.file === 'function' ? { file: req.file.bind(req) } : {}),
  };
}

async function readArchiveUpload(req: CatalogRequest): Promise<Buffer> {
  if (!isMultipart(req)) {
    throw new Error2(CoreErrors.codes.VALIDATION_FAILED, 'Import requires a multipart ZIP upload');
  }
  const part = await req.file!().catch((error: unknown) => {
    throw new Error2(
      CoreErrors.codes.VALIDATION_FAILED,
      `Could not read the uploaded file: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  if (part === undefined) {
    throw new Error2(CoreErrors.codes.VALIDATION_FAILED, 'Missing `file` field');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of part.file) {
      size += chunk.length;
      if (size > MAX_ARCHIVE_BYTES) {
        throw new Error2(CoreErrors.codes.VALIDATION_FAILED, 'The archive is too large');
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (isError2(error)) throw error;
    throw new Error2(
      CoreErrors.codes.VALIDATION_FAILED,
      `Could not read the uploaded archive: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return Buffer.concat(chunks);
}

function isMultipart(req: CatalogRequest): boolean {
  const contentType = req.headers['content-type'];
  return typeof contentType === 'string' && contentType.startsWith('multipart/form-data');
}

export function registerV2CatalogRoutes(app: V2CatalogRouteHost, core: Scope): void {
  app.register(multipart, { limits: { fileSize: MAX_ARCHIVE_BYTES, files: 1 } });

  const catalog = (): ICatalogManagementService => core.accessor.get(ICatalogManagementService);

  const listSkills = defineRoute(
    {
      method: 'GET',
      path: '/skills',
      querystring: catalogQuerySchema,
      success: { data: z.array(skillEntrySchema) },
      errors: errorSchemas,
      description:
        'List every skill visible to the catalog (user, project when `cwd` is given, extra, plugin and builtin); earlier sources lose same-named duplicates.',
      tags: ['v2-catalog'],
    },
    async (req, reply) => {
      try {
        const skills = await catalog().listSkills({ cwd: req.query.cwd });
        const disabled = new Set((await catalog().disabledSkills()).map((name) => name.toLowerCase()));
        reply.send(
          okEnvelope(
            skills.map((skill) => toSkillEntry(skill, disabled.has(skill.name.toLowerCase()))),
            req.id,
          ),
        );
      } catch (error) {
        mapped(reply, req.id, error);
      }
    },
  );
  app.get(
    listSkills.path,
    listSkills.options,
    listSkills.handler as unknown as Parameters<V2CatalogRouteHost['get']>[2],
  );

  const createSkill = defineRoute(
    {
      method: 'POST',
      path: '/skills',
      body: createBodySchema,
      success: { data: skillEntrySchema },
      errors: errorSchemas,
      description:
        'Create a user-level skill at `<home>/skills/<name>/SKILL.md`. An existing name anywhere in the catalog is rejected (`40001`).',
      tags: ['v2-catalog'],
    },
    async (req, reply) => {
      try {
        const skill = await catalog().createSkill(toCreateInput(req.body as z.infer<typeof createBodySchema>));
        reply.send(okEnvelope(toSkillEntry(skill, false), req.id));
      } catch (error) {
        mapped(reply, req.id, error);
      }
    },
  );
  app.post(
    createSkill.path,
    createSkill.options,
    createSkill.handler as unknown as Parameters<V2CatalogRouteHost['post']>[2],
  );

  const skillNameParamSchema = z.object({ name: z.string().min(1) });
  const disabledListSchema = z.object({ disabled: z.array(z.string()) });

  const disableSkill = defineRoute(
    {
      method: 'POST',
      path: '/skills/{name}/disable',
      params: skillNameParamSchema,
      success: { data: disabledListSchema },
      errors: errorSchemas,
      description:
        'Disable a skill by name; persists in user config `disabledSkills` and removes it from the session skill catalog. Returns the updated disabled list.',
      tags: ['v2-catalog'],
    },
    async (req, reply) => {
      try {
        const disabled = await catalog().setSkillDisabled(req.params.name, true);
        reply.send(okEnvelope({ disabled: [...disabled] }, req.id));
      } catch (error) {
        mapped(reply, req.id, error);
      }
    },
  );
  app.post(
    disableSkill.path,
    disableSkill.options,
    disableSkill.handler as unknown as Parameters<V2CatalogRouteHost['post']>[2],
  );

  const enableSkill = defineRoute(
    {
      method: 'POST',
      path: '/skills/{name}/enable',
      params: skillNameParamSchema,
      success: { data: disabledListSchema },
      errors: errorSchemas,
      description:
        'Re-enable a skill by name; removes it from user config `disabledSkills` so it re-enters the session skill catalog. Returns the updated disabled list.',
      tags: ['v2-catalog'],
    },
    async (req, reply) => {
      try {
        const disabled = await catalog().setSkillDisabled(req.params.name, false);
        reply.send(okEnvelope({ disabled: [...disabled] }, req.id));
      } catch (error) {
        mapped(reply, req.id, error);
      }
    },
  );
  app.post(
    enableSkill.path,
    enableSkill.options,
    enableSkill.handler as unknown as Parameters<V2CatalogRouteHost['post']>[2],
  );

  const importSkills = defineRoute(
    {
      method: 'POST',
      path: '/skills:import',
      success: { data: importSummarySchema },
      errors: errorSchemas,
      description:
        'Import skills from a multipart upload of a ZIP (`skills/<name>/SKILL.md` bundles or `skills/<name>.md`) in the `file` field. Conflicts are skipped; invalid items are reported.',
      tags: ['v2-catalog'],
      consumes: ['multipart/form-data'],
    },
    async (req, reply) => {
      try {
        const archive = await readArchiveUpload(typedRequest(req));
        reply.send(okEnvelope(await catalog().importSkills(archive), req.id));
      } catch (error) {
        mapped(reply, req.id, error);
      }
    },
  );
  app.post(
    importSkills.path,
    importSkills.options,
    importSkills.handler as unknown as Parameters<V2CatalogRouteHost['post']>[2],
  );

  const exportSkills = defineRoute(
    {
      method: 'GET',
      path: '/skills:export',
      success: { data: z.null() },
      errors: errorSchemas,
      description: 'Export every editable skill (user and project bundles) as a ZIP download.',
      tags: ['v2-catalog'],
    },
    async (req, reply) => {
      try {
        const archive = await catalog().exportSkills();
        download(reply as unknown as CatalogReply, archive.fileName, archive.bytes);
      } catch (error) {
        mapped(reply, req.id, error);
      }
    },
  );
  app.get(
    exportSkills.path,
    exportSkills.options,
    exportSkills.handler as unknown as Parameters<V2CatalogRouteHost['get']>[2],
  );

  const listAgents = defineRoute(
    {
      method: 'GET',
      path: '/agents',
      querystring: catalogQuerySchema,
      success: { data: z.array(agentEntrySchema) },
      errors: errorSchemas,
      description:
        'List agent (subagent) profiles visible to the catalog: user, project (with `cwd`), extra and plugin.',
      tags: ['v2-catalog'],
    },
    async (req, reply) => {
      try {
        const agents = await catalog().listAgentProfiles({ cwd: req.query.cwd });
        reply.send(okEnvelope(agents.map(toAgentEntry), req.id));
      } catch (error) {
        mapped(reply, req.id, error);
      }
    },
  );
  app.get(
    listAgents.path,
    listAgents.options,
    listAgents.handler as unknown as Parameters<V2CatalogRouteHost['get']>[2],
  );

  const createAgent = defineRoute(
    {
      method: 'POST',
      path: '/agents',
      body: createBodySchema,
      success: { data: agentEntrySchema },
      errors: errorSchemas,
      description:
        'Create a user-level agent profile at `<home>/agents/<name>.md`. An existing name anywhere is rejected (`40001`).',
      tags: ['v2-catalog'],
    },
    async (req, reply) => {
      try {
        const agent = await catalog().createAgentProfile(
          toCreateInput(req.body as z.infer<typeof createBodySchema>),
        );
        reply.send(okEnvelope(toAgentEntry(agent), req.id));
      } catch (error) {
        mapped(reply, req.id, error);
      }
    },
  );
  app.post(
    createAgent.path,
    createAgent.options,
    createAgent.handler as unknown as Parameters<V2CatalogRouteHost['post']>[2],
  );

  const importAgents = defineRoute(
    {
      method: 'POST',
      path: '/agents:import',
      success: { data: importSummarySchema },
      errors: errorSchemas,
      description:
        'Import agent profiles from a multipart upload of a ZIP containing `<any>/<name>.md` files in the `file` field. Conflicts are skipped; invalid profiles are reported.',
      tags: ['v2-catalog'],
      consumes: ['multipart/form-data'],
    },
    async (req, reply) => {
      try {
        const archive = await readArchiveUpload(typedRequest(req));
        reply.send(okEnvelope(await catalog().importAgentProfiles(archive), req.id));
      } catch (error) {
        mapped(reply, req.id, error);
      }
    },
  );
  app.post(
    importAgents.path,
    importAgents.options,
    importAgents.handler as unknown as Parameters<V2CatalogRouteHost['post']>[2],
  );

  const exportAgents = defineRoute(
    {
      method: 'GET',
      path: '/agents:export',
      success: { data: z.null() },
      errors: errorSchemas,
      description: 'Export every user-level agent profile as a ZIP download.',
      tags: ['v2-catalog'],
    },
    async (req, reply) => {
      try {
        const archive = await catalog().exportAgentProfiles();
        download(reply as unknown as CatalogReply, archive.fileName, archive.bytes);
      } catch (error) {
        mapped(reply, req.id, error);
      }
    },
  );
  app.get(
    exportAgents.path,
    exportAgents.options,
    exportAgents.handler as unknown as Parameters<V2CatalogRouteHost['get']>[2],
  );
}
