import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';
import type { IDisposable } from '@hilbras/omnicode-base/di/lifecycle';

export interface IGoalDeadlineScheduler {
  readonly _serviceBrand: undefined;

  now(): number;
  schedule(delayMs: number, callback: () => void): IDisposable;
}

export const IGoalDeadlineScheduler: ServiceIdentifier<IGoalDeadlineScheduler> =
  createDecorator<IGoalDeadlineScheduler>('goalDeadlineScheduler');
