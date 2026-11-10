import type {
  CommandCompletionItem,
  CommandContext,
  CommandDefinition,
  CommandListOptions,
  CommandResult,
} from './types.js';

export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>();
  private readonly aliases = new Map<string, string>();
  private readonly disabled = new Set<string>();

  register(command: CommandDefinition): this {
    const name = normalizeName(command.name);
    if (name === '') throw new Error('Command name cannot be empty');
    if (this.commands.has(name)) throw new Error(`Command already registered: ${name}`);
    for (const alias of command.aliases ?? []) {
      const normalizedAlias = normalizeName(alias);
      if (normalizedAlias === '') continue;
      if (this.commands.has(normalizedAlias) || this.aliases.has(normalizedAlias)) {
        throw new Error(`Command alias already registered: ${normalizedAlias}`);
      }
      this.aliases.set(normalizedAlias, name);
    }
    this.commands.set(name, command);
    if (command.enabled === false) this.disabled.add(name);
    return this;
  }

  registerMany(commands: readonly CommandDefinition[]): this {
    for (const command of commands) this.register(command);
    return this;
  }

  unregister(nameOrAlias: string): boolean {
    const name = this.resolveName(nameOrAlias);
    if (name === undefined) return false;
    this.commands.delete(name);
    this.disabled.delete(name);
    for (const [alias, target] of this.aliases) {
      if (target === name) this.aliases.delete(alias);
    }
    return true;
  }

  get(nameOrAlias: string): CommandDefinition | undefined {
    const name = this.resolveName(nameOrAlias);
    return name === undefined ? undefined : this.commands.get(name);
  }

  resolveName(nameOrAlias: string): string | undefined {
    const normalized = normalizeName(nameOrAlias);
    if (normalized === '') return undefined;
    if (this.commands.has(normalized)) return normalized;
    return this.aliases.get(normalized);
  }

  list(options: CommandListOptions = {}): CommandDefinition[] {
    const commands = Array.from(this.commands.values()).filter((command) => {
      if (!options.includeHidden && command.hidden === true) return false;
      if (!options.includeDisabled && this.disabled.has(command.name)) return false;
      if (options.category !== undefined && command.category !== options.category) return false;
      return true;
    });
    return commands.sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || left.name.localeCompare(right.name));
  }

  complete(argumentPrefix: string): CommandCompletionItem[] {
    const prefix = normalizeName(argumentPrefix);
    const items: CommandCompletionItem[] = [];
    for (const command of this.list()) {
      if (prefix === '' || command.name.startsWith(prefix)) {
        items.push({
          value: `/${command.name}`,
          label: `/${command.name}`,
          description: command.description,
        });
      }
    }
    return items;
  }

  completeArguments(nameOrAlias: string, argumentPrefix: string): readonly CommandCompletionItem[] | null {
    const command = this.get(nameOrAlias);
    if (command?.completeArgs === undefined) return null;
    return command.completeArgs(argumentPrefix);
  }

  setEnabled(nameOrAlias: string, enabled: boolean): boolean {
    const name = this.resolveName(nameOrAlias);
    if (name === undefined) return false;
    if (enabled) this.disabled.delete(name);
    else this.disabled.add(name);
    return true;
  }

  isEnabled(nameOrAlias: string): boolean {
    const name = this.resolveName(nameOrAlias);
    return name !== undefined && !this.disabled.has(name);
  }

  async execute(nameOrAlias: string, args: string, context: CommandContext): Promise<CommandResult> {
    const command = this.get(nameOrAlias);
    if (command === undefined) return { ok: false, message: `Unknown command: ${nameOrAlias}` };
    if (!this.isEnabled(nameOrAlias)) return { ok: false, message: `Command disabled: ${nameOrAlias}` };
    if (command.execute === undefined) return { ok: false, message: `Command has no handler: ${nameOrAlias}` };
    try {
      return await command.execute(args, context);
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }
}

export function normalizeName(value: string): string {
  return value.trim().replace(/^\/+/, '').toLowerCase();
}

export function createCommandRegistry(commands: readonly CommandDefinition[] = []): CommandRegistry {
  return new CommandRegistry().registerMany(commands);
}
