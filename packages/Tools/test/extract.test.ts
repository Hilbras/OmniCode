import { describe, expect, it } from 'vitest';

import { extractableFormat } from '#/os/read/extract/extract';
import { extractRtfText } from '#/os/read/extract/rtf';

describe('extractableFormat', () => {
  it('maps document suffixes case-insensitively', () => {
    expect(extractableFormat('Report.PDF')).toBe('pdf');
    expect(extractableFormat('notes.rtf')).toBe('rtf');
    expect(extractableFormat('book.epub')).toBe('epub');
    expect(extractableFormat('sheet.ods')).toBe('odf');
    expect(extractableFormat('slides.pptx')).toBe('pptx');
    expect(extractableFormat('book.xlsx')).toBe('xlsx');
    expect(extractableFormat('doc.docx')).toBe('docx');
  });

  it('returns undefined for non-document suffixes and names without a dot', () => {
    expect(extractableFormat('README')).toBeUndefined();
    expect(extractableFormat('archive.zip')).toBeUndefined();
    expect(extractableFormat('notes.txt')).toBeUndefined();
  });
});

describe('extractRtfText', () => {
  it('returns undefined when the source is not RTF', () => {
    expect(extractRtfText('plain text')).toBeUndefined();
  });

  it('extracts visible text and ignores formatting control words', () => {
    expect(extractRtfText('{\\rtf1\\ansi Hello {\\b world}}')).toBe('Hello world');
  });

  it('skips destination groups such as the font table', () => {
    expect(extractRtfText('{\\rtf1{\\fonttbl{\\f0 Arial}}Hello}')).toBe('Hello');
  });

  it('decodes cp1252 hex escapes', () => {
    expect(extractRtfText("{\\rtf1 caf\\'e9}")).toBe('café');
  });
});
