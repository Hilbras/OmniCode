/**
 * The Kernel's public surface.
 *
 * Consumers — the CLI, the inspector, and anything else outside the Kernel —
 * import from here and nowhere else. Every package behind it is an
 * implementation detail, so any of them can be split, relocated, or replaced
 * without a consumer edit.
 *
 * Importing this module also activates the packages that register
 * themselves at load time: the SDK's tools and the Addons' features. Nothing
 * downstream needs a side-effect import of its own.
 *
 * ACP is the exception, and is exposed through `loadAcpServer` instead of a
 * static re-export: loading it eagerly would boot the ACP engine on every CLI
 * invocation, which the ACP subcommand deliberately avoids.
 */
export * from '@hilbras/omnicode-sdk';
export * from '@hilbras/omnicode-addons';
export * from '@hilbras/omnicode-tools';

export async function loadAcpServer(): Promise<typeof import('@hilbras/omnicode-acp')> {
  return import('@hilbras/omnicode-acp');
}