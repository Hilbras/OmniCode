import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';

import type { SkillDefinition } from '#/features/skill/catalog/types';
import type { AgentFileDefinition } from '#/workspace/workspaceAgentProfileLoader/internal/types';

export interface CatalogQuery {
  readonly cwd?: string;
}

export interface CatalogCreateInput {
  readonly name: string;
  readonly description: string;
  readonly content: string;
  readonly whenToUse?: string;
}

export interface CatalogZipExport {
  readonly fileName: string;
  readonly bytes: Buffer;
}

export interface CatalogImportSummary {
  readonly imported: readonly string[];
  readonly skipped: readonly string[];
  readonly errors: readonly string[];
}

export interface McpServersExport {
  readonly mcpServers: Record<string, Record<string, unknown>>;
}

export interface ICatalogManagementService {
  readonly _serviceBrand: undefined;

  listSkills(query?: CatalogQuery): Promise<readonly SkillDefinition[]>;
  disabledSkills(): Promise<readonly string[]>;
  setSkillDisabled(name: string, disabled: boolean): Promise<readonly string[]>;
  listAgentProfiles(query?: CatalogQuery): Promise<readonly AgentFileDefinition[]>;
  createSkill(input: CatalogCreateInput): Promise<SkillDefinition>;
  createAgentProfile(input: CatalogCreateInput): Promise<AgentFileDefinition>;
  importSkills(archive: Buffer): Promise<CatalogImportSummary>;
  importAgentProfiles(archive: Buffer): Promise<CatalogImportSummary>;
  exportSkills(): Promise<CatalogZipExport>;
  exportAgentProfiles(): Promise<CatalogZipExport>;
  exportMcpServers(query?: CatalogQuery): Promise<McpServersExport>;
}

export const ICatalogManagementService: ServiceIdentifier<ICatalogManagementService> =
  createDecorator<ICatalogManagementService>('catalogManagementService');
