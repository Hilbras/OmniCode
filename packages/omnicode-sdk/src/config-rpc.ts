import { resolveConfigPath } from '@hilbras/omnicode-core';
import { z } from 'zod';

import { parseConfigString } from '#/config/index';
import { ErrorCodes, OmnicodeError } from '#/errors';

export type OmnicodeConfigValidationPathSegment = string | number;

export interface OmnicodeConfigValidationIssue {
  readonly path: readonly OmnicodeConfigValidationPathSegment[];
  readonly message: string;
}

export interface ResolveOmnicodeConfigPathInput {
  readonly homeDir?: string | undefined;
  readonly configPath?: string | undefined;
}

export interface ValidateOmnicodeConfigTomlInput {
  readonly text: string;
  readonly filePath?: string | undefined;
}

export interface OmnicodeConfigRpc {
  resolveConfigPath(input?: ResolveOmnicodeConfigPathInput): Promise<string>;
  validateConfigToml(input: ValidateOmnicodeConfigTomlInput): Promise<void>;
}

export class OmnicodeConfigRpcClient implements OmnicodeConfigRpc {
  async resolveConfigPath(input: ResolveOmnicodeConfigPathInput = {}): Promise<string> {
    return resolveConfigPath(input);
  }

  async validateConfigToml(input: ValidateOmnicodeConfigTomlInput): Promise<void> {
    try {
      parseConfigString(input.text, input.filePath);
    } catch (error) {
      const validationIssues = extractValidationIssues(error);
      if (validationIssues !== undefined) {
        throw toConfigValidationError(error, validationIssues);
      }
      throw error;
    }
  }
}

export function createOmnicodeConfigRpc(): OmnicodeConfigRpc {
  return new OmnicodeConfigRpcClient();
}

function toConfigValidationError(
  error: unknown,
  validationIssues: readonly OmnicodeConfigValidationIssue[],
): OmnicodeError {
  const details =
    error instanceof OmnicodeError && error.details !== undefined
      ? { ...error.details, validationIssues }
      : { validationIssues };

  if (error instanceof OmnicodeError) {
    return new OmnicodeError(error.code, error.message, { details });
  }

  const message = error instanceof Error ? error.message : String(error);
  return new OmnicodeError(ErrorCodes.CONFIG_INVALID, message, { details });
}

function extractValidationIssues(error: unknown): readonly OmnicodeConfigValidationIssue[] | undefined {
  const zodError = findZodError(error);
  if (zodError === undefined) return undefined;
  return zodError.issues.map((issue) => ({
    path: issue.path.map((segment) =>
      typeof segment === 'number' ? segment : String(segment),
    ),
    message: issue.message,
  }));
}

function findZodError(error: unknown): z.ZodError | undefined {
  if (error instanceof z.ZodError) return error;
  if (error instanceof Error && error.cause instanceof z.ZodError) return error.cause;
  return undefined;
}
