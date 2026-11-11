import { Schema, Slice, type Node as PMNode, type ResolvedPos } from 'prosemirror-model';
import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { type AttachmentAttrs, type MentionAttrs, type QuoteAttrs, quotePillLabel, quoteWireText, serializeAttachment, serializeMention, serializeQuote, splitInlineSegments } from './text';

function inlineSerializedLength(node: PMNode): number {
  if (node.isText) return node.text!.length;
  if (node.type === composerSchema.nodes.attachment) return serializeAttachment(node.attrs as AttachmentAttrs).length;
  if (node.type === composerSchema.nodes.quote) return serializeQuote(node.attrs as QuoteAttrs).length;
  return serializeMention(node.attrs as MentionAttrs).length;
}

// ---------------------------------------------------------------------------
export const composerSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }],
    },
    text: { group: 'inline' },
    mention: {
      group: 'inline',
      inline: true,
      atom: true,
      selectable: true,
      attrs: {
        kind: {},
        name: {},
        path: { default: '' },
      },
      // Serialized (plain-text/copy) form — textBetween consults this, so
      // docToText and the clipboard serializer stay in sync automatically.
      leafText: (node: PMNode) => serializeMention(node.attrs as MentionAttrs),
      // Rendered by a NodeView (icon + label); this toDOM only feeds PM's
      // clipboard HTML serializer, where the plain name is enough.
      toDOM: (node: PMNode) => {
        const attrs = node.attrs as MentionAttrs;
        return [
          'span',
          { class: `mention-pill mention-${attrs.kind}`, 'data-mention-path': attrs.path },
          attrs.name,
        ];
      },
    },
    attachment: {
      group: 'inline',
      inline: true,
      atom: true,
      selectable: true,
      attrs: {
        attId: {},
        name: {},
        kind: {},
      },
      // Same leafText contract as the mention: textBetween consults it, so
      // docToText and the clipboard serializer emit the link form.
      leafText: (node: PMNode) => serializeAttachment(node.attrs as AttachmentAttrs),
      // Rendered by a NodeView (icon + label); this toDOM only feeds PM's
      // clipboard HTML serializer and DOM fallbacks — the data attributes let
      // the message side / tooltip / copy paths recognize the pill without
      // the NodeView.
      toDOM: (node: PMNode) => {
        const attrs = node.attrs as AttachmentAttrs;
        return [
          'span',
          {
            class: `attachment-pill attachment-${attrs.kind}`,
            'data-attachment-id': attrs.attId,
            'data-attachment-kind': attrs.kind,
            'data-attachment-name': attrs.name,
          },
          attrs.name,
        ];
      },
    },
    quote: {
      group: 'inline',
      inline: true,
      atom: true,
      selectable: true,
      attrs: {
        text: {},
        // PM attributes without defaults are required at create time — an
        // absent comment/source normalizes to '', which every consumer treats
        // as absent (serialize/render/rewrite all gate on length > 0).
        comment: { default: '' },
        source: { default: '' },
      },
      // Same leafText contract as the mention/attachment: textBetween
      // consults it, so docToText and the clipboard serializer emit the link
      // form.
      leafText: (node: PMNode) => serializeQuote(node.attrs as QuoteAttrs),
      // Rendered by a NodeView (icon + label); this toDOM only feeds PM's
      // clipboard HTML serializer and DOM fallbacks — the data attributes
      // carry the full quote, the bundled comment and the source for the
      // tooltip.
      toDOM: (node: PMNode) => {
        const attrs = node.attrs as QuoteAttrs;
        const dataAttrs: Record<string, string> = { class: 'quote-pill', 'data-quote-text': attrs.text };
        if (typeof attrs.comment === 'string' && attrs.comment.length > 0) dataAttrs['data-quote-comment'] = attrs.comment;
        if (typeof attrs.source === 'string' && attrs.source.length > 0) dataAttrs['data-quote-source'] = attrs.source;
        return ['span', dataAttrs, quotePillLabel(attrs.text)];
      },
    },
  },
});

/** Build a mention node. */
export function mentionNode(attrs: MentionAttrs): PMNode {
  return composerSchema.nodes.mention!.create(attrs);
}

/** Transaction that replaces the char-offset range (the live @token) with a
 *  mention pill. A trailing space is added whenever the pill doesn't already
 *  sit before whitespace — it separates the pill from following text, keeps a
 *  later @token detectable (the token scan is whitespace-delimited), AND
 *  gives the caret a real text-node home (a paragraph ending in an atom
 *  otherwise forces PM's trailing <br>, which drops the caret onto a phantom
 *  line). The caret lands right after the inserted run. */
export function buildMentionInsertion(
  state: EditorState,
  attrs: MentionAttrs,
  range: { start: number; end: number },
): Transaction {
  const from = textOffsetToPos(state.doc, range.start);
  const to = textOffsetToPos(state.doc, range.end);
  const text = docToText(state.doc);
  const beforeChar = range.start > 0 ? text.charAt(range.start - 1) : '';
  const afterChar = text.charAt(range.end);
  const nodes: PMNode[] = [];
  // A pill inserted right after `!` serializes as the IMAGE construct
  // `![…](…)` — the wire parser rejects images wholesale, so the link
  // would never revive (the editor's own product would leak as literal
  // text). A pill right after `\` has its `[` escaped into a literal.
  // Break the prefix with a space.
  if (beforeChar === '!' || beforeChar === '\\') nodes.push(composerSchema.text(' '));
  nodes.push(mentionNode(attrs));
  if (afterChar === '' || !/\s/.test(afterChar)) nodes.push(composerSchema.text(' '));
  const tr = state.tr.replaceWith(from, to, nodes);
  tr.setSelection(TextSelection.create(tr.doc, from + nodes.reduce((size, node) => size + node.nodeSize, 0)));
  return tr.scrollIntoView();
}

/** Build an attachment node. */
export function attachmentNode(attrs: AttachmentAttrs): PMNode {
  return composerSchema.nodes.attachment!.create(attrs);
}

/** Transaction that inserts an attachment pill, either replacing a
 *  char-offset range or — with no range — the current selection. Same
 *  trailing-space and caret-placement contract as buildMentionInsertion. */
export function buildAttachmentInsertion(
  state: EditorState,
  attrs: AttachmentAttrs,
  range?: { start: number; end: number },
): Transaction {
  const start = range ? range.start : posToTextOffset(state.doc, state.selection.from);
  const end = range ? range.end : posToTextOffset(state.doc, state.selection.to);
  const from = textOffsetToPos(state.doc, start);
  const to = textOffsetToPos(state.doc, end);
  const text = docToText(state.doc);
  const beforeChar = start > 0 ? text.charAt(start - 1) : '';
  const afterChar = text.charAt(end);
  const nodes: PMNode[] = [];
  // A pill inserted right after `!` serializes as the IMAGE construct
  // `![…](…)` — the wire parser rejects images wholesale, so the link
  // would never revive (nor be rewritten at submit: the editor's own
  // product would leak the private attId into the transcript and the file
  // would silently misalign with the payload). A pill right after `\` has
  // its `[` escaped into a literal. Break the prefix with a space.
  if (beforeChar === '!' || beforeChar === '\\') nodes.push(composerSchema.text(' '));
  nodes.push(attachmentNode(attrs));
  if (afterChar === '' || !/\s/.test(afterChar)) nodes.push(composerSchema.text(' '));
  const tr = state.tr.replaceWith(from, to, nodes);
  tr.setSelection(TextSelection.create(tr.doc, from + nodes.reduce((size, node) => size + node.nodeSize, 0)));
  return tr.scrollIntoView();
}

/** Build a quote node. */
export function quoteNode(attrs: QuoteAttrs): PMNode {
  return composerSchema.nodes.quote!.create(attrs);
}

/** Transaction that appends a quote pill (and the 评论 flow's optional
 *  comment) at the END of the document, as ONE undoable step. The selection
 *  quote actions fire from the transcript — the composer's caret may be stale
 *  or mid-paragraph, and a blockquote-prefix wire form only composes as its
 *  own block anyway — so the pill always lands at the end: a non-empty doc
 *  gets exactly ONE empty paragraph of separation first (the '\n\n' join of
 *  the text-era appendText, keeping the submit rewrite's output
 *  byte-identical to it). A Shift+Enter tail already IS that separator — a
 *  trailing run of empty paragraphs is collapsed to one and reused, never
 *  stacked upon ('hello\n' would otherwise append as 'hello\n\n\n<quote>',
 *  each tail newline sending that much blank wire text). The comment rides
 *  INSIDE the pill (its attrs) — bundled with the quote as one atom, not
 *  appended as editable text. A trailing space follows the pill (same
 *  caret-home contract as buildMentionInsertion). The caret lands at the
 *  very end. */
export function buildQuoteInsertion(state: EditorState, attrs: QuoteAttrs, comment?: string): Transaction {
  const inline: PMNode[] = [quoteNode(comment !== undefined && comment.length > 0 ? { ...attrs, comment } : attrs), composerSchema.text(' ')];
  const last = state.doc.lastChild;
  if (docToText(state.doc).length === 0 && state.doc.childCount === 1 && last && last.content.size === 0) {
    // Empty draft: fill the single placeholder paragraph instead of leaving a
    // leading blank line.
    const tr = state.tr.insert(1, inline);
    tr.setSelection(TextSelection.atEnd(tr.doc));
    return tr.scrollIntoView();
  }
  // Count the trailing run of empty paragraphs (an empty paragraph's nodeSize
  // is 2 — open and close tokens only).
  let trailing = 0;
  for (let i = state.doc.childCount - 1; i >= 0; i -= 1) {
    const child = state.doc.child(i);
    if (child.type !== composerSchema.nodes.paragraph || child.content.size > 0) break;
    trailing += 1;
  }
  if (trailing > 0) {
    // Reuse exactly ONE trailing empty paragraph as the separator; extras die
    // with the insertion.
    const tr = state.tr;
    if (trailing > 1) {
      tr.delete(state.doc.content.size - (trailing - 1) * 2, state.doc.content.size);
    }
    tr.insert(tr.doc.content.size, composerSchema.node('paragraph', null, inline));
    tr.setSelection(TextSelection.atEnd(tr.doc));
    return tr.scrollIntoView();
  }
  const tr = state.tr.insert(state.doc.content.size, [
    composerSchema.node('paragraph'),
    composerSchema.node('paragraph', null, inline),
  ]);
  tr.setSelection(TextSelection.atEnd(tr.doc));
  return tr.scrollIntoView();
}

// ---------------------------------------------------------------------------
// text ↔ doc
// ---------------------------------------------------------------------------

/** micromark run with every CommonMark construct that is unrelated to links
 *  disabled — the composer wire format is plain text where ONLY the inline
 *  link is special, so emphasis, headings, HTML, blockquotes, lists, … must
 *  not consume syntax that is literal text to us. Kept on purpose:
 *  - labelStartLink / labelEnd (+ the resource machinery): the link itself.
 *  - labelStartImage, so `![alt](src)` tokenizes as ONE image construct that
 *    is rejected wholesale — with it off, the `[alt](src)` part would look
 *    like a link and image syntax would revive (an old-scanner bug).
 *  - characterEscape: `\[` must not start a label, `\(` in a destination
 *    must not close it — the wire format's own backslash semantics.
 *  - lineEnding / content: structural, the tokenizer cannot run without them.
 *  `definition` is disabled, so reference links (`[a][b]`, `[a][]`, `[a]`)
 *  never resolve and collapse back to literal data tokens; the only `label`
 *  tokens that survive postprocessing are inline links and image labels.
 *  `characterReference` is disabled so `&amp;` stays literal text — a real
 *  file can be named `a&amp;b.md` and its wire form must round-trip.
 *  `codeText` / `codeFenced` / `codeIndented` are disabled too: backticks and
 *  indent are literal text here, and the editor CAN insert a real mention
 *  atom between code delimiters — that is a legitimate document product whose
 *  link form MUST revive on reload (round-trip invariant), so code never
 *  shields links from this parser. */
function lineToInlineNodes(line: string): PMNode[] {
  if (!line) return [];
  return splitInlineSegments(line).map((segment) => {
    if (segment.type === 'mention') return mentionNode(segment.attrs);
    if (segment.type === 'attachment') return attachmentNode(segment.attrs);
    if (segment.type === 'quote') return quoteNode(segment.attrs);
    return composerSchema.text(segment.value);
  });
}

/** Plain text → doc. Every '\n' starts a new paragraph; an empty string is a
 *  single empty paragraph (the schema requires at least one block). With
 *  `reviveMentions` (the editor's load paths — draft restore, history recall,
 *  session/queue reload), our serialized link forms parse back into mention
 *  and attachment atoms, so pills survive persistence; clipboard paste leaves
 *  it off (pasted text never produces pills). */
export function textToDoc(text: string, opts?: { reviveMentions?: boolean }): PMNode {
  const lines = text.split('\n');
  return composerSchema.node(
    'doc',
    null,
    lines.map((line) => {
      if (!line) return composerSchema.node('paragraph');
      return composerSchema.node(
        'paragraph',
        null,
        opts?.reviveMentions ? lineToInlineNodes(line) : composerSchema.text(line),
      );
    }),
  );
}

/** Doc → plain text: paragraphs joined with '\n', mentions in their link
 *  form (via the node's leafText spec). */
export function docToText(doc: PMNode): string {
  return doc.textBetween(0, doc.content.size, '\n');
}

/** Serialized offset where the caret's inline text run begins — the lower
 *  bound for the @token scan, so it never crosses into a mention pill's
 *  serialized form.
 *
 *  Note the subtlety: `$pos.textOffset` is 0 not only between two nodes but
 *  ALSO at a text node's END boundary (PM treats that as "between nodes") —
 *  which is exactly where the caret lands after typing. So the text-node case
 *  must also consult `nodeBefore`. */
export function inlineRunStartOffset(doc: PMNode, $pos: ResolvedPos): number {
  if (!$pos.parent.isTextblock) return posToTextOffset(doc, $pos.pos);
  if ($pos.textOffset > 0) {
    // Inside a text node: the run starts at that node.
    return posToTextOffset(doc, $pos.pos - $pos.textOffset);
  }
  const before = $pos.nodeBefore;
  if (before && before.isText) {
    // At the end of a text node: the run is that node.
    return posToTextOffset(doc, $pos.pos - before.nodeSize);
  }
  // After an atom / at a paragraph start: the caret's run begins right here.
  return posToTextOffset(doc, $pos.pos);
}

// ---------------------------------------------------------------------------
// char offset ↔ PM position
// ---------------------------------------------------------------------------

/** Map a char offset in the serialized text to a PM position. An offset that
 *  lands exactly on a '\n' maps to the end of the preceding paragraph's text;
 *  an offset inside a mention's serialized form clamps to the mention's END
 *  (its start when the offset is exactly at the boundary); offsets past the
 *  end clamp to the document end. */
export function textOffsetToPos(doc: PMNode, offset: number): number {
  let remaining = Math.max(0, offset);
  let result = -1;
  doc.forEach((para, paraStart) => {
    if (result !== -1) return;
    let paraSerLen = 0;
    para.forEach((child) => {
      paraSerLen += inlineSerializedLength(child);
    });
    if (remaining > paraSerLen) {
      remaining -= paraSerLen + 1; // +1 for the '\n' between paragraphs
      return;
    }
    para.forEach((child, childOffset) => {
      if (result !== -1) return;
      const childPos = paraStart + 1 + childOffset;
      const len = inlineSerializedLength(child);
      if (remaining <= len) {
        if (child.isText) {
          result = childPos + remaining;
        } else {
          // Inside a mention's serialized form — clamp to an edge.
          result = remaining === 0 ? childPos : childPos + 1;
        }
        return;
      }
      remaining -= len;
    });
    // Past the inline content (or the paragraph was empty): paragraph end.
    if (result === -1) result = paraStart + 1 + para.content.size;
  });
  // Past the end: the last text position is one before the doc's closing tag.
  return result === -1 ? doc.content.size - 1 : result;
}

/** Map a PM position back to a char offset in the serialized text. */
export function posToTextOffset(doc: PMNode, pos: number): number {
  let offset = 0;
  let result = -1;
  doc.forEach((para, paraStart) => {
    if (result !== -1) return;
    const paraEnd = paraStart + para.nodeSize;
    if (pos > paraEnd) {
      para.forEach((child) => {
        offset += inlineSerializedLength(child);
      });
      offset += 1; // the '\n' between paragraphs
      return;
    }
    let inlineOffset = 0;
    para.forEach((child, childOffset) => {
      if (result !== -1) return;
      const childPos = paraStart + 1 + childOffset;
      if (child.isText) {
        const childEnd = childPos + child.nodeSize;
        if (pos <= childEnd) {
          result = offset + inlineOffset + Math.max(0, pos - childPos);
          return;
        }
        inlineOffset += child.text!.length;
      } else {
        // Atom: one position. Exactly before it → the serialized start;
        // exactly after → the serialized end; further along → keep walking.
        const atomEnd = childPos + 1;
        if (pos <= atomEnd) {
          result = offset + inlineOffset + (pos <= childPos ? 0 : inlineSerializedLength(child));
          return;
        }
        inlineOffset += inlineSerializedLength(child);
      }
    });
    // At the paragraph's end position.
    if (result === -1) result = offset + inlineOffset;
  });
  return result === -1 ? offset : result;
}

// ---------------------------------------------------------------------------
// Skill mention collection (submit-time activation decision)
// ---------------------------------------------------------------------------

export interface SkillMentionRef {
  name: string;
}

/** All skill mentions in the doc, in document order (the submit path activates
 *  on exactly one, degrades to plain references on two or more). */
export function collectSkillMentions(doc: PMNode): SkillMentionRef[] {
  const refs: SkillMentionRef[] = [];
  doc.forEach((para) => {
    para.forEach((child) => {
      if (!child.isText && child.type === composerSchema.nodes.mention && child.attrs.kind === 'skill') {
        refs.push({ name: child.attrs.name as string });
      }
    });
  });
  return refs;
}

/** Extend the selection to the textblock's start/end (macOS Cmd-Shift-Arrow
 *  line selection). prosemirror-commands only ships the collapsing
 *  selectTextblockStart/End, so the anchor-preserving variant lives here.
 *  One paragraph is one line in this doc model, so textblock start/end IS
 *  the line boundary. */
export function extendToTextblock(start: boolean) {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const $head = state.selection.$head;
    const pos = start ? $head.start() : $head.end();
    if (!dispatch) return true;
    dispatch(state.tr.setSelection(TextSelection.create(state.doc, state.selection.$anchor.pos, pos)).scrollIntoView());
    return true;
  };
}

// ---------------------------------------------------------------------------
// Clipboard single-newline contract
// ---------------------------------------------------------------------------

/** clipboardTextParser for the composer: split on SINGLE newlines (the doc
 *  model is one paragraph per line) so consecutive blank lines survive —
 *  PM's default parser splits on /\n+/, silently dropping them. \r\n is
 *  normalized first. Slice.maxOpen lets a paste merge with the paragraph it
 *  lands in. */
export function parseClipboardText(text: string, opts?: { reviveMentions?: boolean }): Slice {
  return Slice.maxOpen(textToDoc(text.replace(/\r\n?/g, '\n'), opts).content);
}

/** A quote atom's degrade for text/plain: its canonical `> ` blockquote
 *  lines with the bundled comment after a blank line and the provenance
 *  header when present (comment and source both ride the pill's attrs —
 *  degrading to the bare quote text would silently drop them). */
export function serializeClipboardSlice(slice: Slice): string {
  const serializeInline = (node: PMNode): string => {
    if (node.isText) return node.text ?? '';
    if (node.type === composerSchema.nodes.mention) return serializeMention(node.attrs as MentionAttrs);
    if (node.type === composerSchema.nodes.attachment) return (node.attrs as AttachmentAttrs).name;
    if (node.type === composerSchema.nodes.quote) return quoteWireText(node.attrs as QuoteAttrs);
    return node.textBetween(0, node.content.size, '');
  };
  const lines: string[] = [];
  slice.content.forEach((node) => {
    if (node.type === composerSchema.nodes.mention || node.type === composerSchema.nodes.attachment || node.type === composerSchema.nodes.quote) {
      lines.push(serializeInline(node));
    } else {
      let line = '';
      // A quote pill merged INTO a paragraph gets block-level blank lines
      // around its degrade (same boundary contract as the submit rewrite) —
      // but only where selected text actually neighbors it: a pill at the
      // paragraph's start or end pads nothing, so the copy never invents
      // blank lines the user didn't have. ONE leading space of the following
      // text is eaten (the pill's caret separator).
      let pendingBreak = false;
      node.forEach((child) => {
        if (child.type === composerSchema.nodes.quote) {
          const degrade = quoteWireText(child.attrs as QuoteAttrs);
          line = line.length > 0 ? `${line.replace(/ +$/, '')}\n\n${degrade}` : degrade;
          pendingBreak = true;
          return;
        }
        let text = serializeInline(child);
        if (pendingBreak) {
          text = text.replace(/^ /, '');
          line += '\n\n';
          pendingBreak = false;
        }
        line += text;
      });
      lines.push(line);
    }
  });
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Message-side segmentation
// ---------------------------------------------------------------------------


/** Segment a wire text into alternating text runs and mentions, in document
 *  order. This is the parse step of the message-side renderer (ComposerText):
 *  the component renders the returned sequence DIRECTLY into its final
 *  element tree — one parse per text change, no DOM post-processing. Mention
 *  segments carry the raw (still-encoded) destination alongside the decoded
 *  attrs, so action paths (mentionActionPath) and display paths stay
 *  distinct. Attachment links are NOT this function's concern: they classify
 *  as non-mentions and stay inside the text runs (legacy consumers see them
 *  as literal text) — splitInlineSegments is the dual-class version. */
