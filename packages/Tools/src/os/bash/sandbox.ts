import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import { ScopeActivation, registerScopedService } from '@hilbras/omnicode-base/di/scope';
import { IAgentPermissionModeService } from '@hilbras/omnicode-engine/agent/permissionMode/permissionMode';
import { LifecycleScope } from '@hilbras/omnicode-engine/app/scopes';
import {
  createSandboxExecutionPlan,
  probeSandboxBackends,
  selectSandboxBackend,
  type SandboxAvailability,
  type SandboxExecutionPlan,
  type SandboxPermissionMode,
} from '@hilbras/omnicode-kaos/sandbox';

export type BashSandboxMode = 'off' | 'auto' | 'required';

export interface BashSandboxRequest {
  readonly command: string;
  readonly cwd: string;
  readonly workspace: string;
  readonly shellPath: string;
  readonly env: Readonly<Record<string, string>>;
  readonly writeAllowlist?: readonly string[];
  /**
   * Hosts an exec-policy rule restricted this command to. No sandbox backend
   * can confine a process's network to specific hosts yet, so a request
   * carrying hosts is refused instead of running with unrestricted network.
   */
  readonly allowedHosts?: readonly string[];
}

/**
 * The refusal text for a command whose exec policy restricted it to specific
 * hosts: fail closed with the restriction named, never run it unconfined.
 */
export function hostRestrictionDenialMessage(allowedHosts: readonly string[]): string {
  return (
    'Command not run: the exec policy restricts this command to network host(s) ' +
    `${allowedHosts.join(', ')}, and the runtime cannot yet confine a process's network ` +
    'to specific hosts. Run the command yourself, or remove the `hosts` field from the ' +
    'exec-policy rule if unrestricted network access is acceptable.'
  );
}

export type BashSandboxPreparation =
  | { readonly kind: 'direct'; readonly reason?: string }
  | { readonly kind: 'sandbox'; readonly plan: SandboxExecutionPlan }
  | { readonly kind: 'denied'; readonly message: string };

export interface BashSandboxOptions {
  readonly mode?: () => BashSandboxMode;
  readonly probe?: () => Promise<readonly SandboxAvailability[]>;
  readonly permissionMode?: () => SandboxPermissionMode;
}

export interface IBashSandboxService {
  readonly _serviceBrand: undefined;
  prepare(request: BashSandboxRequest): Promise<BashSandboxPreparation>;
}

export const IBashSandboxService = createDecorator<IBashSandboxService>('bashSandboxService');

export function resolveBashSandboxMode(env: NodeJS.ProcessEnv = process.env): BashSandboxMode {
  const raw = (env['OMNICODE_SANDBOX_MODE'] ?? 'off').trim().toLowerCase();
  return raw === 'auto' || raw === 'required' ? raw : 'off';
}

export function sandboxWriteAllowlist(env: NodeJS.ProcessEnv = process.env): readonly string[] | undefined {
  const raw = env['OMNICODE_SANDBOX_WRITE_ROOTS']?.trim();
  if (raw === undefined || raw.length === 0) return undefined;
  const roots = raw.split(',').map((value) => value.trim()).filter((value) => value.startsWith('/'));
  return roots.length === 0 ? undefined : roots;
}

export function sandboxNetworkShared(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env['OMNICODE_SANDBOX_NETWORK'] ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'shared';
}

export class BashSandboxService implements IBashSandboxService {
  declare readonly _serviceBrand: undefined;

  private probing: Promise<readonly SandboxAvailability[]> | undefined;

  constructor(
    @IAgentPermissionModeService private readonly modeService: IAgentPermissionModeService,
    private readonly options: BashSandboxOptions = {},
  ) {}

  async prepare(request: BashSandboxRequest): Promise<BashSandboxPreparation> {
    if (request.allowedHosts !== undefined && request.allowedHosts.length > 0) {
      return { kind: 'denied', message: hostRestrictionDenialMessage(request.allowedHosts) };
    }
    const mode = this.options.mode?.() ?? resolveBashSandboxMode();
    if (mode === 'off') return { kind: 'direct' };
    const permissionMode = this.options.permissionMode?.() ?? this.modeService.mode;
    const availability = await this.availability();
    const selection = selectSandboxBackend({ permissionMode, availability });
    if (!selection.enabled || selection.backend === null || selection.availability === null) {
      if (mode === 'required') return { kind: 'denied', message: selection.message };
      return { kind: 'direct', reason: selection.message };
    }
    const result = createSandboxExecutionPlan({
      backend: selection.backend,
      availability: selection.availability,
      permissionMode,
      policy: {
        workspace: request.workspace,
        cwd: request.cwd,
        env: request.env,
        shareNetwork: sandboxNetworkShared(),
        sharePid: false,
        shareIpc: false,
        ...(request.writeAllowlist === undefined ? {} : { writeAllowlist: request.writeAllowlist }),
      },
      request: { command: request.command, mode: 'shell' },
      shellPolicy: {
        mode: 'shell',
        allowShell: true,
        shellPath: request.shellPath,
      },
    });
    if (result.ok) return { kind: 'sandbox', plan: result.value };
    if (mode === 'required') return { kind: 'denied', message: result.message };
    return { kind: 'direct', reason: result.message };
  }

  private availability(): Promise<readonly SandboxAvailability[]> {
    const probing =
      this.probing ??
      (this.options.probe ?? (() => probeSandboxBackends()))().catch((error: unknown) => {
        this.probing = undefined;
        throw error;
      });
    this.probing = probing;
    return probing;
  }
}

registerScopedService(LifecycleScope.Agent, IBashSandboxService, BashSandboxService, ScopeActivation.OnDemand, 'os');
