import assert from "node:assert";
import { describe, it } from "node:test";
import { frameSignature, normalizeTerminalRow } from "../src/terminalVisualLane";

describe("normalizeTerminalRow", () => {
	it("turns ANSI colours into named style tokens", () => {
		assert.strictEqual(
			normalizeTerminalRow("\x1b[32mOK\x1b[0m done"),
			"|green:OK| done",
		);
	});

	it("collapses dynamic ids and timestamps", () => {
		const row = "run 1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d at 2026-11-19T12:34:56.789Z";
		assert.strictEqual(normalizeTerminalRow(row), "run <uuid> at <time>");
	});
});

describe("frameSignature", () => {
	it("produces a stable snapshot-friendly signature", () => {
		const frame = {
			cols: 20,
			rows: ["\x1b[1mHeader\x1b[0m", "body   "],
		};
		assert.strictEqual(frameSignature(frame), "|bold:Header\nbody·");
	});

	it("bounds oversized frames", () => {
		const frame = { cols: 10_000, rows: Array.from({ length: 300 }, () => "x".repeat(1_000)) };
		const signature = frameSignature(frame);
		assert.strictEqual(signature.split("\n").length, 200);
		assert.ok(signature.split("\n")[0]!.length <= 500);
	});
});
