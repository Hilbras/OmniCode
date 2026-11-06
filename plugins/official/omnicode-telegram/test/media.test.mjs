import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { imagePartOf, videoPartOf } from '../bin/omnicode-telegram.mjs';

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

describe('videoPartOf', () => {
  it('accepts a video attachment', () => {
    const message = { video: { file_id: 'v1', mime_type: 'video/mp4', file_name: 'clip.mp4' } };

    assert.deepEqual(videoPartOf(message), { fileId: 'v1', mediaType: 'video/mp4', name: 'clip.mp4' });
  });

  it('defaults the name when the video has none', () => {
    assert.equal(videoPartOf({ video: { file_id: 'v2' } }).name, 'telegram-video.mp4');
  });

  it('accepts a video document', () => {
    const message = { document: { file_id: 'v3', mime_type: 'video/quicktime', file_name: 'screen.mov' } };

    assert.deepEqual(videoPartOf(message), { fileId: 'v3', mediaType: 'video/quicktime', name: 'screen.mov' });
  });

  it('accepts gifs and round video notes', () => {
    assert.equal(videoPartOf({ animation: { file_id: 'a1', mime_type: 'video/mp4' } }).fileId, 'a1');
    assert.equal(videoPartOf({ video_note: { file_id: 'n1' } }).fileId, 'n1');
  });

  it('ignores images and other documents', () => {
    assert.equal(videoPartOf({ photo: [{ file_id: 'p' }] }), undefined);
    assert.equal(videoPartOf({ document: { file_id: 'pdf', mime_type: 'application/pdf' } }), undefined);
    assert.equal(videoPartOf({ text: 'hi' }), undefined);
  });
});