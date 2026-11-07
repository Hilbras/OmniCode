import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';

export interface IWorkspaceAliases {
  readonly _serviceBrand: undefined;

  resolveAliasIds(id: string): Promise<readonly string[]>;
}

export const IWorkspaceAliases: ServiceIdentifier<IWorkspaceAliases> =
  createDecorator<IWorkspaceAliases>('workspaceAliases');
