/**
 * The Kernel's public surface.
 *
 * Consumers — the CLI, the inspector, and anything else outside the Kernel —
 * import from here and nowhere else. The SDK behind it is an implementation
 * detail, so it can be split, relocated, or replaced without a consumer edit.
 */
export * from '@hilbras/omnicode-sdk';