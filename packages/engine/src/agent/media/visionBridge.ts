/**
 * Vision bridge (WS3.2 / S1.9).
 *
 * When media cannot be shown to the primary model, an optionally configured
 * vision model can describe it. The bridge is deliberately fail-soft: without
 * a model, on an oversized payload, or on any error it returns `undefined` and
 * today's placeholder behavior is unchanged. A successful description is
 * returned as an honest, labelled notice — never as if the primary model had
 * seen the image itself.
 */
export interface VisionMedia {
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly path?: string;
}

/** Minimal provider-trait seam; the adapter supplies the real implementation. */
export interface VisionModel {
  describe(input: {
    readonly media: VisionMedia;
    readonly prompt: string;
    readonly signal?: AbortSignal;
  }): Promise<string | undefined>;
}

export interface VisionBridgeConfig {
  readonly model?: VisionModel;
  readonly maxBytes?: number;
  readonly prompt?: string;
}

export const DEFAULT_VISION_MAX_BYTES = 8 * 1024 * 1024;
export const DEFAULT_VISION_PROMPT =
  'Describe this image or document faithfully for a coding agent. ' +
  'State only what is visible; if text is present, transcribe it exactly.';

export interface VisionBridgeDecision {
  readonly shouldQuery: boolean;
  readonly reason: 'no-model' | 'too-large' | 'empty-media' | 'ready';
}

export function decideVisionBridge(
  media: VisionMedia | undefined,
  config: VisionBridgeConfig,
): VisionBridgeDecision {
  if (config.model === undefined) return { shouldQuery: false, reason: 'no-model' };
  if (media === undefined || media.bytes.byteLength === 0) {
    return { shouldQuery: false, reason: 'empty-media' };
  }
  if (media.bytes.byteLength > (config.maxBytes ?? DEFAULT_VISION_MAX_BYTES)) {
    return { shouldQuery: false, reason: 'too-large' };
  }
  return { shouldQuery: true, reason: 'ready' };
}

export function formatVisionNotice(description: string, path?: string): string {
  const cleaned = description.trim();
  const subject = path === undefined ? 'unreadable media' : path;
  return (
    `[vision bridge] A separate vision model described ${subject}: ${cleaned}\n` +
    '(This is a secondary description; the primary model did not view the media directly.)'
  );
}

export class VisionBridge {
  constructor(private readonly config: VisionBridgeConfig) {}

  async describe(media: VisionMedia | undefined, signal?: AbortSignal): Promise<string | undefined> {
    const decision = decideVisionBridge(media, this.config);
    if (!decision.shouldQuery || media === undefined) return undefined;
    try {
      const description = await this.config.model!.describe({
        media,
        prompt: this.config.prompt ?? DEFAULT_VISION_PROMPT,
        ...(signal === undefined ? {} : { signal }),
      });
      return description === undefined || description.trim() === ''
        ? undefined
        : formatVisionNotice(description, media.path);
    } catch {
      return undefined;
    }
  }
}
