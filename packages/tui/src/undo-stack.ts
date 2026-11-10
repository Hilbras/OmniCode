/**
 * Generic undo stack with clone-on-push semantics.
 *
 * Stores deep clones of state snapshots. Popped snapshots are returned
 * directly (no re-cloning) since they are already detached.
 */
export class UndoStack<S> {
	private stack: S[] = [];

	/**
	 * @param limit Maximum number of snapshots retained. When exceeded, the
	 *   oldest snapshots are dropped (how far back undo can reach).
	 */
	constructor(private readonly limit?: number) {}

	/** Push a deep clone of the given state onto the stack. */
	push(state: S): void {
		this.stack.push(structuredClone(state));
		if (this.limit !== undefined && this.stack.length > this.limit) {
			this.stack.splice(0, this.stack.length - this.limit);
		}
	}

	/** Pop and return the most recent snapshot, or undefined if empty. */
	pop(): S | undefined {
		return this.stack.pop();
	}

	/** Remove all snapshots. */
	clear(): void {
		this.stack.length = 0;
	}

	get length(): number {
		return this.stack.length;
	}
}
