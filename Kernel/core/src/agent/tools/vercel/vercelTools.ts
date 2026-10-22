import { z } from 'zod';

import { createDecorator } from '#/_base/di/instantiation';
import { IFlagService } from '#/app/flag/flag';
import { isVercelError, redactVercelSecrets } from '#/app/vercel/errors';
import { VERCEL_FLAG_ID } from '#/app/vercel/flag';
import type {
  VercelDeployment,
  VercelDeploymentEvent,
  VercelProject,
  VercelUser,
} from '#/app/vercel/types';
import type { AgentTool } from '#/tool/toolContract';

export const VERCEL_TOOL_DOMAIN = 'vercel';

export const VercelProjectInputSchema = z
  .string()
  .min(1)
  .describe('Project name or prj_ identifier, for example "my-app" or "prj_abc123".');

export const VercelDeploymentInputSchema = z
  .string()
  .min(1)
  .describe('Deployment id or deployment url, for example "dpl_abc123".');

export const VercelListProjectsInputSchema = z.object({
  search: z.string().min(1).describe('Filter projects by name.').optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(30)
    .describe('Maximum number of projects to return.')
    .optional(),
});
export type VercelListProjectsInput = z.infer<typeof VercelListProjectsInputSchema>;
export interface IVercelListProjectsTool extends AgentTool<VercelListProjectsInput> {
  readonly _serviceBrand: undefined;
}
export const IVercelListProjectsTool =
  createDecorator<IVercelListProjectsTool>('vercelListProjectsTool');

export const VercelListDeploymentsInputSchema = z.object({
  project: VercelProjectInputSchema,
  target: z
    .enum(['production', 'preview'])
    .describe('Only return deployments for this target.')
    .optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(30)
    .describe('Maximum number of deployments to return.')
    .optional(),
});
export type VercelListDeploymentsInput = z.infer<typeof VercelListDeploymentsInputSchema>;
export interface IVercelListDeploymentsTool extends AgentTool<VercelListDeploymentsInput> {
  readonly _serviceBrand: undefined;
}
export const IVercelListDeploymentsTool = createDecorator<IVercelListDeploymentsTool>(
  'vercelListDeploymentsTool',
);

export const VercelGetDeploymentInputSchema = z.object({
  deployment: VercelDeploymentInputSchema,
});
export type VercelGetDeploymentInput = z.infer<typeof VercelGetDeploymentInputSchema>;
export interface IVercelGetDeploymentTool extends AgentTool<VercelGetDeploymentInput> {
  readonly _serviceBrand: undefined;
}
export const IVercelGetDeploymentTool =
  createDecorator<IVercelGetDeploymentTool>('vercelGetDeploymentTool');

export const VercelGetDeploymentEventsInputSchema = z.object({
  deployment: VercelDeploymentInputSchema,
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(30)
    .describe('Maximum number of build log events to return.')
    .optional(),
});
export type VercelGetDeploymentEventsInput = z.infer<typeof VercelGetDeploymentEventsInputSchema>;
export interface IVercelGetDeploymentEventsTool extends AgentTool<VercelGetDeploymentEventsInput> {
  readonly _serviceBrand: undefined;
}
export const IVercelGetDeploymentEventsTool = createDecorator<IVercelGetDeploymentEventsTool>(
  'vercelGetDeploymentEventsTool',
);

export const VercelGetAuthenticatedUserInputSchema = z.object({});
export type VercelGetAuthenticatedUserInput = z.infer<typeof VercelGetAuthenticatedUserInputSchema>;
export interface IVercelGetAuthenticatedUserTool extends AgentTool<VercelGetAuthenticatedUserInput> {
  readonly _serviceBrand: undefined;
}
export const IVercelGetAuthenticatedUserTool = createDecorator<IVercelGetAuthenticatedUserTool>(
  'vercelGetAuthenticatedUserTool',
);

export function vercelFlagOffMessage(): string {
  return `The ${VERCEL_FLAG_ID} experimental flag is off, so Vercel tools are unavailable.`;
}

export function vercelToolErrorMessage(error: unknown): string {
  if (isVercelError(error)) {
    return `${error.code}: ${redactVercelSecrets(error.message)}`;
  }
  return redactVercelSecrets(error instanceof Error ? error.message : String(error));
}

export function vercelFlagEnabled(flags: IFlagService): boolean {
  return flags.enabled(VERCEL_FLAG_ID);
}

export function formatVercelUser(user: VercelUser): string {
  return [
    `id: ${user.id}`,
    `username: ${user.username}`,
    `name: ${user.name ?? 'unknown'}`,
    `email: ${user.email ?? 'unknown'}`,
    `default_team: ${user.defaultTeamId ?? 'none'}`,
  ].join('\n');
}

export function formatVercelProject(project: VercelProject): string {
  return [
    `project: ${project.name}`,
    `id: ${project.id}`,
    `account: ${project.accountId}`,
    `framework: ${project.framework ?? 'unknown'}`,
    `node_version: ${project.nodeVersion ?? 'unknown'}`,
    `url: ${project.url}`,
  ].join('\n');
}

export function formatVercelProjects(projects: readonly VercelProject[]): string {
  if (projects.length === 0) return 'projects: 0\nNo projects found.';
  return [`projects: ${String(projects.length)}`, ...projects.map(formatVercelProject)].join('\n');
}

export function formatVercelDeployment(deployment: VercelDeployment): string {
  return [
    `deployment: ${deployment.id}`,
    `project: ${deployment.name}`,
    `project_id: ${deployment.projectId}`,
    `target: ${deployment.target}`,
    `state: ${deployment.state}`,
    `source: ${deployment.source ?? 'unknown'}`,
    `alias: ${deployment.alias.length === 0 ? 'none' : deployment.alias.join(', ')}`,
    `error: ${deployment.errorCode ?? 'none'}`,
    `error_message: ${deployment.errorMessage ?? 'none'}`,
    `created_at: ${deployment.createdAt ?? 'unknown'}`,
    `url: ${deployment.url}`,
  ].join('\n');
}

export function formatVercelDeployments(deployments: readonly VercelDeployment[]): string {
  if (deployments.length === 0) return 'deployments: 0\nNo deployments found.';
  return [
    `deployments: ${String(deployments.length)}`,
    ...deployments.map(formatVercelDeployment),
  ].join('\n');
}

export function formatVercelDeploymentEvent(event: VercelDeploymentEvent): string {
  return [
    `type: ${event.type}`,
    `level: ${event.level ?? 'unknown'}`,
    `created_at: ${event.createdAt ?? 'unknown'}`,
    `text: ${event.text}`,
  ].join('\n');
}

export function formatVercelDeploymentEvents(events: readonly VercelDeploymentEvent[]): string {
  if (events.length === 0) return 'events: 0\nNo build log events found.';
  return [`events: ${String(events.length)}`, ...events.map(formatVercelDeploymentEvent)].join(
    '\n',
  );
}
