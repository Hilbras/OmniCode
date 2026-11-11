import type { AttachmentKind } from './text';

export interface AttachmentEntry {
  attId: string;
  /** Dedup identity: file://<normalized absolute path> for path-backed
   *  entries (a folder's ends with '/'), blob:<attId> for pasted bytes. */
  key: string;
  kind: AttachmentKind;
  name: string;
  size?: number;
  /** The file's MIME (File.type at pill insert, the server's mediaType once
   *  the upload lands) — echoed into the submit payload's file part. Files
   *  only; folders carry no media type. */
  mediaType?: string;
  /** File.lastModified at pill insert (ms epoch) — the version marker for
   *  the path-reuse check: re-dropping the same path with a different size
   *  or mtime means the bytes on disk CHANGED, and the entry must re-upload
   *  instead of silently sending its old fileId. Files only. */
  lastModified?: number;
  /** Add-order stamp from the window-global counter (nextAttachmentSeq) —
   *  the submit payload's file/media interleave key: the payload must
   *  reflect the user's add order across the two families (file pills and
   *  media chips), while file-file relative order stays the wire's 1..N
   *  index contract. */
  seq?: number;
  /** The real absolute path — path-backed entries only. */
  path?: string;
  /** How many attachment nodes in the doc carry this attId. Owned by the
   *  reconcile pass — meta commands never set it. */
  refCount: number;
  uploading: boolean;
  fileId?: string;
  error?: string;
}

let attachmentSeqCounter = 0;

export function nextAttachmentSeq(): number {
  attachmentSeqCounter += 1;
  return attachmentSeqCounter;
}

/** Fast-forward the counter past a stamp adopted from a store (the draft
 *  sidecar, a clipboard flavor) so fresh stamps never collide with
 *  restored ones. */
export function noteAttachmentSeq(n: number): void {
  if (n > attachmentSeqCounter) attachmentSeqCounter = n;
}

/** A fresh attachment id: 8 base36 chars — short, bare-destination-safe
 *  (serializeAttachment writes the id verbatim into the link destination),
 *  and collision-free in practice; mergePastedEntries still re-mints on a
 *  real collision. */
export function newAttId(): string {
  let id = '';
  for (let i = 0; i < 8; i++) id += Math.floor(Math.random() * 36).toString(36);
  return id;
}

/** Lexical path normalization for registry keys — no fs access (this module
 *  is DOM-free): separators unify to '/', duplicate separators collapse,
 *  '.'/'..' segments resolve lexically (symlinks are NOT resolved), and the
 *  trailing separator is dropped (attachmentKeyFor re-adds the folder's).
 *  Case is preserved — case-insensitivity is a filesystem property, not a
 *  path property. */
export function normalizeAttachmentPath(path: string): string {
  let p = path.replace(/\\/g, '/');
  let prefix = '';
  if (/^[a-zA-Z]:\//.test(p)) {
    // A Windows drive root ('C:/…') keeps its letter as-is.
    prefix = p.slice(0, 3);
    p = p.slice(3);
  } else if (p.startsWith('//')) {
    // A '//server/share' (UNC) root keeps its double slash.
    prefix = '//';
    p = p.slice(2);
  } else if (p.startsWith('/')) {
    prefix = '/';
    p = p.slice(1);
  }
  const segments: string[] = [];
  for (const segment of p.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      // An absolute path clamps at its root; a relative path keeps the '..'.
      if (segments.length > 0 && segments[segments.length - 1] !== '..') segments.pop();
      else if (prefix === '') segments.push('..');
      continue;
    }
    segments.push(segment);
  }
  return prefix + segments.join('/');
}

/** The registry dedup key for an attachment: a path-backed entry keys on its
 *  normalized absolute path (a folder's ends with '/', so a file and a folder
 *  never share a key); a pathless entry (pasted bytes) keys on its own id —
 *  two pastes of the same bytes never dedup, matching the chip-era
 *  behavior. */
export function attachmentKeyFor(args: { kind: AttachmentKind; path?: string; attId: string }): string {
  if (!args.path) return `blob:${args.attId}`;
  const normalized = normalizeAttachmentPath(args.path);
  return `file://${args.kind === 'folder' ? `${normalized}/` : normalized}`;
}

/** The doc's attachment attIds in first-mention order, deduplicated — the
 *  ordering source for the submit payload and the index rewrite (NOT the
 *  registry map's insertion order, which tracks entry creation). */
