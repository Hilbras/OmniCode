import { readFileSync } from 'node:fs';

import { isAbsolute, join } from 'pathe';

import { Error2 } from '@hilbras/omnicode-base/errors/errors';
import { toErrorMessage } from '@hilbras/omnicode-base/errors/errorMessage';

import { CONFIG_INVALID_ERROR_CODE } from '#/llm-adapter/contract/errors';

import { ExecPolicyLoadError, loadExecPolicy, type ExecPolicy } from './execPolicy';

type ReadPolicyText = (path: string) => string;

const defaultReadPolicyText: ReadPolicyText = (path) => readFileSync(path, 'utf8');

/**
 * Reads and validates an exec-policy JSON file. Every failure — unreadable
 * file, invalid JSON, schema violation, contradicting example — comes back as
 * an `ExecPolicyLoadError` carrying the path, so a caller can never mistake a
 * failed load for "no policy".
 */
export function readExecPolicyFile(path: string, readFile: ReadPolicyText = defaultReadPolicyText): ExecPolicy {
  let text: string;
  try {
    text = readFile(path);
  } catch (error) {
    throw new ExecPolicyLoadError(path, `cannot be read: ${toErrorMessage(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new ExecPolicyLoadError(path, `is not valid JSON: ${toErrorMessage(error)}`);
  }
  return loadExecPolicy(parsed, path);
}

/**
 * Resolves a configured policy path in operator-controlled space only: `~`
 * expands to the OS home, and a relative path resolves against the Omnicode
 * home (where `config.toml` lives), never against the workspace — the file
 * carries approval rules, so a compromised workspace must not be able to
 * supply it.
 */
export function resolveExecPolicyPath(configuredPath: string, homeDir: string, osHomeDir: string): string {
  if (configuredPath === '~') return osHomeDir;
  if (configuredPath.startsWith('~/')) return join(osHomeDir, configuredPath.slice(2));
  if (isAbsolute(configuredPath)) return configuredPath;
  return join(homeDir, configuredPath);
}

/**
 * Loads the exec policy named by the `execPolicy` config section. Load errors
 * are re-thrown as `config.invalid` so a broken policy file surfaces as a
 * config error at agent creation instead of silently leaving the exec-policy
 * pass unenforced.
 */
export function loadExecPolicyFromConfig(
  configuredPath: string,
  homeDir: string,
  osHomeDir: string,
  readFile?: ReadPolicyText,
): ExecPolicy {
  const path = resolveExecPolicyPath(configuredPath, homeDir, osHomeDir);
  try {
    return readExecPolicyFile(path, readFile);
  } catch (error) {
    if (error instanceof ExecPolicyLoadError) {
      throw new Error2(CONFIG_INVALID_ERROR_CODE, error.message, { cause: error });
    }
    throw error;
  }
}
