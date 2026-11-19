import { describe, expect, it } from 'vitest';

import {
  VisionBridge,
  decideVisionBridge,
  formatVisionNotice,
  type VisionMedia,
  type VisionModel,
} from '#/agent/media/visionBridge';

const media = (bytes = 16, mimeType = 'image/png'): VisionMedia => ({
  mimeType,
  bytes: new Uint8Array(bytes),
  path: '/repo/diagram.png',
});

describe('decideVisionBridge', () => {
  it('is ready with a model and ordinary media', () => {
    expect(decideVisionBridge(media(), { model: { describe: async () => undefined } })).toEqual({
      shouldQuery: true, reason: 'ready',
    });
  });

  it('degrades without a model, for empty media, and for oversized media', () => {
    const model: VisionModel = { describe: async () => undefined };
    expect(decideVisionBridge(media(), {}).reason).toBe('no-model');
    expect(decideVisionBridge(media(0), { model }).reason).toBe('empty-media');
    expect(decideVisionBridge(undefined, { model }).reason).toBe('empty-media');
    expect(decideVisionBridge(media(100), { model, maxBytes: 10 }).reason).toBe('too-large');
  });
});

describe('formatVisionNotice', () => {
  it('labels the notice as a secondary description', () => {
    const notice = formatVisionNotice('  A flowchart with three boxes. ', '/repo/diagram.png');
    expect(notice).toContain('/repo/diagram.png');
    expect(notice).toContain('A flowchart with three boxes.');
    expect(notice).toContain('did not view the media directly');
  });
});

describe('VisionBridge', () => {
  it('returns an honest notice from a stub vision model', async () => {
    let seenPrompt = '';
    const bridge = new VisionBridge({
      model: {
        describe: async (input) => {
          seenPrompt = input.prompt;
          return 'The screenshot shows a failing test.';
        },
      },
    });
    const result = await bridge.describe(media());
    expect(result).toContain('The screenshot shows a failing test.');
    expect(seenPrompt).toContain('transcribe it exactly');
  });

  it('degrades silently when the model is absent, empty, or throws', async () => {
    expect(await new VisionBridge({}).describe(media())).toBeUndefined();
    expect(await new VisionBridge({ model: { describe: async () => '  ' } }).describe(media()))
      .toBeUndefined();
    expect(await new VisionBridge({
      model: { describe: async () => { throw new Error('provider down'); } },
    }).describe(media())).toBeUndefined();
  });
});
