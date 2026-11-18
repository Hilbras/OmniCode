import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import type { AgentTool } from '@hilbras/omnicode-engine/tool/toolContract';

import type { WorkflowInput } from './workflowTool';

export interface IWorkflowTool extends AgentTool<WorkflowInput> {
  readonly _serviceBrand: undefined;
}

export const IWorkflowTool = createDecorator<IWorkflowTool>('workflowTool');
