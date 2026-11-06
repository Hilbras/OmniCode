import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { imagePartOf } from '../bin/omnicode-telegram.mjs';

describe('imagePartOf', () => {
  it('takes the largest photo size', () => {
    const message = {
      photo: [
        { file_id: 'small', width: 90, height: 90 },
        { file_id: 'medium', width: 320, height: 320 },
        { file_id: 'large', width: 1280, height: 1280 },
      ],
    };

    assert.deepEqual(imagePartOf(message), {
      fileId: 'large',
      mediaType: 'image/jpeg',
      name: 'telegram-photo.jpg',
    });
  });

  it('accepts an image document with its own mime type and name', () => {
    const message = { document: { file_id: 'doc1', mime_type: 'image/png', file_name: 'shot.png' } };

    assert.deepEqual(imagePartOf(message), { fileId: 'doc1', mediaType: 'image/png', name: 'shot.png' });
  });

  it('falls back to a default name for an image document without one', () => {
    const message = { document: { file_id: 'doc2', mime_type: 'image/webp' } };

    assert.equal(imagePartOf(message).name, 'telegram-image');
  });

  it('refuses documents that are not images', () => {
    assert.equal(imagePartOf({ document: { file_id: 'pdf', mime_type: 'application/pdf' } }), undefined);
    assert.equal(imagePartOf({ document: { file_id: 'bin' } }), undefined);
  });

  it('returns nothing for messages without media', () => {
    assert.equal(imagePartOf({ text: 'hello' }), undefined);
    assert.equal(imagePartOf({ photo: [] }), undefined);
    assert.equal(imagePartOf({ photo: [{ width: 1 }] }), undefined);
  });
});