import {
  assertUniqueTargets,
  type PatchHunk,
  type PatchOperation,
} from './patchOperations';

/**
 * Incremental parser for Codex-style patch text.
 *
 * A patch body arrives from a model stream one chunk at a time. This parser
 * consumes complete lines as they become available and exposes the operations
 * it has finished, so a caller can show progress or validate a partially
 * received patch without holding the whole text. `parsePatch` is the
 * whole-string wrapper over the same state machine.
 */
export class PatchStreamParser {
  private lineBuffer = '';
  private carryCR = false;
  private started = false;
  private ended = false;
  private mode: 'outside' | 'add' | 'update' = 'outside';
  private readonly completed: PatchOperation[] = [];
  private addPath = '';
  private addLines: string[] = [];
  private updatePath = '';
  private updateHunks: PatchHunk[] = [];
  private hunk: { oldLines: string[]; newLines: string[] } | undefined;

  /** Feed a chunk of patch text. Throws on a malformed line that is complete. */
  push(chunk: string): void {
    if (this.ended) return;
    let text = chunk;
    // A CRLF split across chunks must stay a single newline, not two lines.
    if (this.carryCR) {
      text = `\r${text}`;
      this.carryCR = false;
    }
    if (text.endsWith('\r')) {
      this.carryCR = true;
      text = text.slice(0, -1);
    }
    this.lineBuffer += text.replace(/\r\n/g, '\n');
    let newline = this.lineBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.lineBuffer.slice(0, newline);
      this.lineBuffer = this.lineBuffer.slice(newline + 1);
      this.consumeLine(line);
      if (this.ended) {
        this.lineBuffer = '';
        return;
      }
      newline = this.lineBuffer.indexOf('\n');
    }
  }

  /** Operations completed so far, in patch order. */
  operations(): readonly PatchOperation[] {
    return [...this.completed];
  }

  get done(): boolean {
    return this.ended;
  }

  /** Flush the trailing line and require a closed, unique-target patch. */
  finish(): readonly PatchOperation[] {
    if (!this.ended) {
      // A bare CR at the very end of the text is content of the final line,
      // not a line break: it must reach consumeLine or the whole-string parse
      // and the streamed parse would disagree on that line's content.
      if (this.carryCR) {
        this.lineBuffer += '\r';
        this.carryCR = false;
      }
      if (this.lineBuffer.length > 0) {
        const line = this.lineBuffer;
        this.lineBuffer = '';
        this.consumeLine(line);
      }
      if (!this.started) throw new Error('patch must start with *** Begin Patch');
      if (!this.ended) throw new Error('patch is missing *** End Patch');
    }
    return [...this.completed];
  }

  private consumeLine(line: string): void {
    if (!this.started) {
      if (line.trim() !== '*** Begin Patch') {
        throw new Error('patch must start with *** Begin Patch');
      }
      this.started = true;
      return;
    }
    if (this.ended) return;

    if (this.mode === 'add') {
      if (line.startsWith('***')) {
        this.commitAdd();
        this.mode = 'outside';
        this.consumeDirective(line);
        return;
      }
      if (!line.startsWith('+')) throw new Error(`add-file line must start with +: ${line}`);
      this.addLines.push(line.slice(1));
      return;
    }

    if (this.mode === 'update') {
      if (line.startsWith('@@')) {
        this.closeHunk();
        this.hunk = { oldLines: [], newLines: [] };
        return;
      }
      if (line.startsWith('***')) {
        this.closeHunk();
        this.commitUpdate();
        this.mode = 'outside';
        this.consumeDirective(line);
        return;
      }
      if (this.hunk === undefined) return;
      this.consumeHunkLine(line);
      return;
    }

    this.consumeDirective(line);
  }

  private consumeDirective(line: string): void {
    if (line.trim() === '*** End Patch') {
      assertUniqueTargets(this.completed);
      this.ended = true;
      return;
    }
    if (line.startsWith('*** Add File: ')) {
      this.addPath = line.slice('*** Add File: '.length).trim();
      this.addLines = [];
      this.mode = 'add';
      return;
    }
    if (line.startsWith('*** Move to: ')) {
      // A `*** Move to:` line follows the update it belongs to, so it attaches
      // to the last completed operation.
      const previous = this.completed[this.completed.length - 1];
      if (previous === undefined || previous.kind !== 'update') {
        throw new Error('*** Move to must follow an update');
      }
      if (previous.move !== undefined) throw new Error(`duplicate *** Move to for ${previous.path}`);
      const to = line.slice('*** Move to: '.length).trim();
      if (to.length === 0) throw new Error('*** Move to needs a destination');
      this.completed[this.completed.length - 1] = { ...previous, move: to };
      return;
    }
    if (line.startsWith('*** Delete File: ')) {
      this.completed.push({ kind: 'delete', path: line.slice('*** Delete File: '.length).trim() });
      return;
    }
    if (line.startsWith('*** Update File: ')) {
      this.updatePath = line.slice('*** Update File: '.length).trim();
      this.updateHunks = [];
      this.hunk = undefined;
      this.mode = 'update';
    }
  }

  private consumeHunkLine(line: string): void {
    const hunk = this.hunk!;
    if (line.startsWith(' ')) {
      hunk.oldLines.push(line.slice(1));
      hunk.newLines.push(line.slice(1));
    } else if (line.startsWith('-')) {
      hunk.oldLines.push(line.slice(1));
    } else if (line.startsWith('+')) {
      hunk.newLines.push(line.slice(1));
    } else if (line.length === 0) {
      hunk.oldLines.push('');
      hunk.newLines.push('');
    } else {
      throw new Error(`invalid hunk line: ${line}`);
    }
  }

  private closeHunk(): void {
    if (this.hunk === undefined) return;
    this.updateHunks.push(this.hunk);
    this.hunk = undefined;
  }

  private commitAdd(): void {
    const content = this.addLines;
    this.completed.push({
      kind: 'add',
      path: this.addPath,
      content: content.join('\n') + (content.length > 0 ? '\n' : ''),
    });
    this.addLines = [];
    this.addPath = '';
  }

  private commitUpdate(): void {
    this.completed.push({ kind: 'update', path: this.updatePath, hunks: this.updateHunks });
    this.updateHunks = [];
    this.updatePath = '';
  }
}