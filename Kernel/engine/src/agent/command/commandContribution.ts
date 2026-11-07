import { collection } from '@hilbras/omnicode-base/di/collection';
import type { ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';

export interface CommandRunContext {
  readonly args: string;
  get<T>(id: ServiceIdentifier<T>): T;
}

export interface CommandContribution {
  readonly name: string;
  readonly description?: string;
  readonly run: (ctx: CommandRunContext) => void | Promise<void>;
}

export const CommandContribution = collection<CommandContribution>('command');
