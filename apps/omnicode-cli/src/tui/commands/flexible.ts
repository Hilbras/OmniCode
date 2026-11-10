import { CommandRegistry, type CommandCompletionItem, type CommandDefinition } from '@omnicode/cli-commands';

import { BUILTIN_SLASH_COMMANDS } from './registry';

export function createFlexibleCommandRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  const legacyCommands = BUILTIN_SLASH_COMMANDS as readonly {
    readonly name: string;
    readonly aliases: readonly string[];
    readonly description: string;
    readonly priority?: number;
    readonly experimentalFlag?: string;
    readonly availability?: CommandDefinition['availability'];
    readonly completeArgs?: (prefix: string) => readonly CommandCompletionItem[] | null;
  }[];
  for (const command of legacyCommands) {
    const definition: CommandDefinition = {
      name: command.name,
      aliases: command.aliases,
      description: command.description,
      priority: command.priority,
      experimentalFlag: command.experimentalFlag,
      availability: command.availability,
      category: 'builtin',
      completeArgs: command.completeArgs
        ? (prefix) => command.completeArgs?.(prefix) as readonly CommandCompletionItem[] | null
        : undefined,
    };
    registry.register(definition);
  }
  return registry;
}
