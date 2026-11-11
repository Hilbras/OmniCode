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
