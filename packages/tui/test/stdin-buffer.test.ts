/**
 * Tests for StdinBuffer
 *
 * Based on code from OpenTUI (https://github.com/anomalyco/opentui)
 * MIT License - Copyright (c) 2025 opentui
 */

import assert from "node:assert";
import { beforeEach, describe, it } from "node:test";
import { matchesKey } from "../src/keys";
import { StdinBuffer } from "../src/stdin-buffer";

describe("StdinBuffer", () => {
	let buffer: StdinBuffer;
	let emittedSequences: string[];

	beforeEach(() => {
		buffer = new StdinBuffer({ timeout: 10 });

		// Collect emitted sequences
		emittedSequences = [];
		buffer.on("data", (sequence) => {
			emittedSequences.push(sequence);
		});
	});

	// Helper to process data through the buffer
	function processInput(data: string | Buffer): void {
		buffer.process(data);
	}

	// Helper to wait for async operations
	async function wait(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	describe("Regular Characters", () => {
		it("should pass through regular characters immediately", () => {
			processInput("a");
			assert.deepStrictEqual(emittedSequences, ["a"]);
		});

		it("should pass through multiple regular characters", () => {
			processInput("abc");
			assert.deepStrictEqual(emittedSequences, ["a", "b", "c"]);
		});

		it("should handle unicode characters", () => {
			processInput("hello 世界");
			assert.deepStrictEqual(emittedSequences, ["h", "e", "l", "l", "o", " ", "世", "界"]);
		});
	});

	describe("Complete Escape Sequences", () => {
		it("should pass through complete mouse SGR sequences", () => {
			const mouseSeq = "\u001b[<35;20;5m";
			processInput(mouseSeq);
			assert.deepStrictEqual(emittedSequences, [mouseSeq]);
		});

		it("should pass through complete arrow key sequences", () => {
			const upArrow = "\x1B[A";
			processInput(upArrow);
			assert.deepStrictEqual(emittedSequences, [upArrow]);
		});

		it("should pass through complete function key sequences", () => {
			const f1 = "\u001b[11~";
			processInput(f1);
			assert.deepStrictEqual(emittedSequences, [f1]);
		});

		it("should pass through meta key sequences", () => {
			const metaA = "\x1Ba";
			processInput(metaA);
			assert.deepStrictEqual(emittedSequences, [metaA]);
		});

		it("should pass through SS3 sequences", () => {
			const ss3 = "\u001bOA";
			processInput(ss3);
			assert.deepStrictEqual(emittedSequences, [ss3]);
		});
	});

	describe("Partial Escape Sequences", () => {
		it("should buffer incomplete mouse SGR sequence", async () => {
			processInput("\x1B");
			assert.deepStrictEqual(emittedSequences, []);
			assert.strictEqual(buffer.getBuffer(), "\x1B");

			processInput("[<35");
			assert.deepStrictEqual(emittedSequences, []);
			assert.strictEqual(buffer.getBuffer(), "\x1B[<35");

			processInput(";20;5m");
			assert.deepStrictEqual(emittedSequences, ["\x1B[<35;20;5m"]);
			assert.strictEqual(buffer.getBuffer(), "");
		});

		it("should buffer incomplete CSI sequence", () => {
			processInput("\x1B[");
			assert.deepStrictEqual(emittedSequences, []);

			processInput("1;");
			assert.deepStrictEqual(emittedSequences, []);

			processInput("5H");
			assert.deepStrictEqual(emittedSequences, ["\x1B[1;5H"]);
		});

		it("should buffer split across many chunks", () => {
			processInput("\x1B");
			processInput("[");
			processInput("<");
			processInput("3");
			processInput("5");
			processInput(";");
			processInput("2");
			processInput("0");
			processInput(";");
			processInput("5");
			processInput("m");

			assert.deepStrictEqual(emittedSequences, ["\x1B[<35;20;5m"]);
		});

		it("should flush incomplete sequence after timeout", async () => {
			processInput("\x1B[<35");
			assert.deepStrictEqual(emittedSequences, []);

			// Wait for timeout
			await wait(15);

			assert.deepStrictEqual(emittedSequences, ["\x1B[<35"]);
		});

		it("should flush a lone ESC as Escape when CR arrives after the timeout", async () => {
			// Legacy-mode Alt+Enter is ESC + CR; when the terminal/transport splits
			// the bytes further apart than the timeout, ESC is flushed alone and the
			// host sees Escape (interrupt) instead of Alt+Enter. This locks in the
			// behavior so the configurable timeout in ProcessTerminal stays honest.
			processInput("\x1B");
			await wait(20); // buffer timeout is 10ms in beforeEach
			processInput("\r");

			assert.deepStrictEqual(emittedSequences, ["\x1B", "\r"]);
			assert.equal(matchesKey(emittedSequences[0] ?? "", "escape"), true);
		});

		it("should merge ESC + CR split across chunks within a larger timeout", async () => {
			buffer = new StdinBuffer({ escapeTimeout: 100 });
			emittedSequences = [];
			buffer.on("data", (sequence) => {
				emittedSequences.push(sequence);
			});

			processInput("\x1B");
			await wait(20); // > 10ms default escapeTimeout, < 100ms configured escapeTimeout
			processInput("\r");

			assert.deepStrictEqual(emittedSequences, ["\x1B\r"]);
			assert.equal(matchesKey(emittedSequences[0] ?? "", "alt+enter"), true);
		});

		it("does not apply the sequence timeout to a lone ESC", async () => {
			buffer = new StdinBuffer({ timeout: 100 });
			emittedSequences = [];
			buffer.on("data", (sequence) => {
				emittedSequences.push(sequence);
			});

			processInput("\x1B");
			await wait(20);
			processInput("\r");

			assert.deepStrictEqual(emittedSequences, ["\x1B", "\r"]);
			assert.equal(matchesKey(emittedSequences[0] ?? "", "escape"), true);
		});

		it("keeps fragmented mouse sequences buffered across delayed chunks by default", async () => {
			const delayedBuffer = new StdinBuffer();
			const delayedSequences: string[] = [];
			delayedBuffer.on("data", (sequence) => delayedSequences.push(sequence));

			delayedBuffer.process("\x1B[");
			await wait(20);
			assert.deepStrictEqual(delayedSequences, []);
			delayedBuffer.process("<65;48;39M");
			assert.deepStrictEqual(delayedSequences, ["\x1B[<65;48;39M"]);
			delayedBuffer.destroy();
		});
	});

	describe("Mixed Content", () => {
		it("should handle characters followed by escape sequence", () => {
			processInput("abc\x1B[A");
			assert.deepStrictEqual(emittedSequences, ["a", "b", "c", "\x1B[A"]);
		});

		it("should handle escape sequence followed by characters", () => {
			processInput("\x1B[Aabc");
			assert.deepStrictEqual(emittedSequences, ["\x1B[A", "a", "b", "c"]);
		});

		it("should handle multiple complete sequences", () => {
			processInput("\u001b[A\u001b[B\u001b[C");
			assert.deepStrictEqual(emittedSequences, ["\x1B[A", "\x1B[B", "\u001b[C"]);
		});

		it("should handle partial sequence with preceding characters", () => {
			processInput("abc\x1B[<35");
			assert.deepStrictEqual(emittedSequences, ["a", "b", "c"]);
			assert.strictEqual(buffer.getBuffer(), "\x1B[<35");

			processInput(";20;5m");
			assert.deepStrictEqual(emittedSequences, ["a", "b", "c", "\x1B[<35;20;5m"]);
		});
	});

	describe("Kitty Keyboard Protocol", () => {
		it("should handle Kitty CSI u press events", () => {
			// Press 'a' in Kitty protocol
			processInput("\x1B[97u");
			assert.deepStrictEqual(emittedSequences, ["\x1B[97u"]);
		});

		it("should handle Kitty CSI u release events", () => {
			// Release 'a' in Kitty protocol
			processInput("\x1B[97;1:3u");
			assert.deepStrictEqual(emittedSequences, ["\x1B[97;1:3u"]);
		});

		it("should handle batched Kitty press and release", () => {
			// Press 'a', release 'a' batched together (common over SSH)
			processInput("\x1B[97u\x1B[97;1:3u");
			assert.deepStrictEqual(emittedSequences, ["\x1B[97u", "\x1B[97;1:3u"]);
		});

		it("should handle multiple batched Kitty events", () => {
			// Press 'a', release 'a', press 'b', release 'b'
			processInput("\x1B[97u\x1B[97;1:3u\x1B[98u\x1B[98;1:3u");
			assert.deepStrictEqual(emittedSequences, ["\x1B[97u", "\x1B[97;1:3u", "\x1B[98u", "\x1B[98;1:3u"]);
		});

		it("should handle Kitty arrow keys with event type", () => {
			// Up arrow press with event type
			processInput("\x1B[1;1:1A");
			assert.deepStrictEqual(emittedSequences, ["\x1B[1;1:1A"]);
		});

		it("should handle Kitty functional keys with event type", () => {
			// Delete key release
			processInput("\x1B[3;1:3~");
			assert.deepStrictEqual(emittedSequences, ["\x1B[3;1:3~"]);
		});

		it("should split ESC+ESC+CSI into standalone ESC and the CSI sequence (WezTerm Escape key regression)", () => {
			// WezTerm with enable_kitty_keyboard sends Escape key press as raw \x1b
			// and the release as a full Kitty CSI-u sequence, concatenated.
			// The buffer must not treat \x1b\x1b as a complete meta-key when the
			// following byte starts a new escape sequence.
			processInput("\u001b\u001b[27;129:3u");
			assert.deepStrictEqual(emittedSequences, ["\x1B", "\x1B[27;129:3u"]);
		});

		it("should split ESC+ESC+CSI with no modifier (no num_lock)", () => {
			processInput("\x1B\x1B[27;1:3u");
			assert.deepStrictEqual(emittedSequences, ["\x1B", "\u001b[27;1:3u"]);
		});

		it("should still emit ESC+ESC as a single sequence when not followed by a new escape", () => {
			// \x1b\x1b alone (no following CSI) stays as-is — e.g. ctrl+alt+[
			processInput("\x1B\x1B");
			assert.deepStrictEqual(emittedSequences, ["\x1B\x1B"]);
		});

		it("should handle plain characters mixed with Kitty sequences", () => {
			// Plain 'a' followed by Kitty release
			processInput("a\x1B[97;1:3u");
			assert.deepStrictEqual(emittedSequences, ["a", "\u001b[97;1:3u"]);
		});

		it("should drop raw duplicate character after matching Kitty printable sequence", () => {
			processInput("\x1B[224uà");
			assert.deepStrictEqual(emittedSequences, ["\x1B[224u"]);
		});

		it("should drop raw duplicate character after matching Kitty printable sequence across chunks", () => {
			processInput("\x1B[64u");
			processInput("@");
			assert.deepStrictEqual(emittedSequences, ["\x1B[64u"]);
		});

		it("should keep non-matching plain character after Kitty printable sequence", () => {
			processInput("\u001b[97ub");
			assert.deepStrictEqual(emittedSequences, ["\x1B[97u", "b"]);
		});

		it("should keep raw character after modified Kitty printable sequence", () => {
			processInput("\u001b[64;3u@");
			assert.deepStrictEqual(emittedSequences, ["\x1B[64;3u", "@"]);
		});

		it("should handle rapid typing simulation with Kitty protocol", () => {
			// Simulates typing "hi" quickly with releases interleaved
			processInput("\x1B[104u\x1B[104;1:3u\x1B[105u\x1B[105;1:3u");
			assert.deepStrictEqual(emittedSequences, ["\x1B[104u", "\x1B[104;1:3u", "\x1B[105u", "\u001b[105;1:3u"]);
		});
	});

	describe("Mouse Events", () => {
		it("should handle mouse press event", () => {
			processInput("\u001b[<0;10;5M");
			assert.deepStrictEqual(emittedSequences, ["\x1B[<0;10;5M"]);
		});

		it("should handle mouse release event", () => {
			processInput("\x1B[<0;10;5m");
			assert.deepStrictEqual(emittedSequences, ["\x1B[<0;10;5m"]);
		});

		it("should handle mouse move event", () => {
			processInput("\x1B[<35;20;5m");
			assert.deepStrictEqual(emittedSequences, ["\u001b[<35;20;5m"]);
		});

		it("should handle split mouse events", () => {
			processInput("\x1B[<3");
			processInput("5;1");
			processInput("5;");
			processInput("10m");
			assert.deepStrictEqual(emittedSequences, ["\x1B[<35;15;10m"]);
		});

		it("should handle multiple mouse events", () => {
			processInput("\x1B[<35;1;1m\x1B[<35;2;2m\x1B[<35;3;3m");
			assert.deepStrictEqual(emittedSequences, ["\x1B[<35;1;1m", "\x1B[<35;2;2m", "\u001b[<35;3;3m"]);
		});

		it("should handle old-style mouse sequence (ESC[M + 3 bytes)", () => {
			processInput("\x1B[M abc");
			assert.deepStrictEqual(emittedSequences, ["\x1B[M ab", "c"]);
		});

		it("should buffer incomplete old-style mouse sequence", () => {
			processInput("\x1B[M");
			assert.strictEqual(buffer.getBuffer(), "\x1B[M");

			processInput(" a");
			assert.strictEqual(buffer.getBuffer(), "\u001b[M a");

			processInput("b");
			assert.deepStrictEqual(emittedSequences, ["\x1B[M ab"]);
		});
	});

	describe("Edge Cases", () => {
		it("should handle empty input", () => {
			processInput("");
			// Empty string emits an empty data event
			assert.deepStrictEqual(emittedSequences, [""]);
		});

		it("should handle lone escape character with timeout", async () => {
			processInput("\x1B");
			assert.deepStrictEqual(emittedSequences, []);

			// After timeout, should emit
			await wait(15);
			assert.deepStrictEqual(emittedSequences, ["\x1B"]);
		});

		it("flushes a lone escape promptly with the longer default sequence timeout", async () => {
			const defaultBuffer = new StdinBuffer();
			const defaultSequences: string[] = [];
			defaultBuffer.on("data", (sequence) => defaultSequences.push(sequence));

			defaultBuffer.process("\u001b");
			await wait(20);
			assert.deepStrictEqual(defaultSequences, ["\x1B"]);
			defaultBuffer.destroy();
		});

		it("should handle lone escape character with explicit flush", () => {
			processInput("\x1B");
			assert.deepStrictEqual(emittedSequences, []);

			const flushed = buffer.flush();
			assert.deepStrictEqual(flushed, ["\x1B"]);
		});

		it("should handle buffer input", () => {
			processInput(Buffer.from("\x1B[A"));
			assert.deepStrictEqual(emittedSequences, ["\x1B[A"]);
		});

		it("should handle very long sequences", () => {
			const longSeq = `\x1B[${"1;".repeat(50)}H`;
			processInput(longSeq);
			assert.deepStrictEqual(emittedSequences, [longSeq]);
		});
	});

	describe("Flush", () => {
		it("should flush incomplete sequences", () => {
			processInput("\x1B[<35");
			const flushed = buffer.flush();
			assert.deepStrictEqual(flushed, ["\x1B[<35"]);
			assert.strictEqual(buffer.getBuffer(), "");
		});

		it("should return empty array if nothing to flush", () => {
			const flushed = buffer.flush();
			assert.deepStrictEqual(flushed, []);
		});

		it("should emit flushed data via timeout", async () => {
			processInput("\x1B[<35");
			assert.deepStrictEqual(emittedSequences, []);

			// Wait for timeout to flush
			await wait(15);

			assert.deepStrictEqual(emittedSequences, ["\x1B[<35"]);
		});
	});

	describe("Clear", () => {
		it("should clear buffered content without emitting", () => {
			processInput("\x1B[<35");
			assert.strictEqual(buffer.getBuffer(), "\x1B[<35");

			buffer.clear();
			assert.strictEqual(buffer.getBuffer(), "");
			assert.deepStrictEqual(emittedSequences, []);
		});
	});

	describe("Bracketed Paste", () => {
		let emittedPaste: string[] = [];

		beforeEach(() => {
			buffer = new StdinBuffer({ timeout: 10 });

			// Collect emitted sequences
			emittedSequences = [];
			buffer.on("data", (sequence) => {
				emittedSequences.push(sequence);
			});

			// Collect paste events
			emittedPaste = [];
			buffer.on("paste", (data) => {
				emittedPaste.push(data);
			});
		});

		it("should emit paste event for complete bracketed paste", () => {
			const pasteStart = "\x1B[200~";
			const pasteEnd = "\x1B[201~";
			const content = "hello world";

			processInput(pasteStart + content + pasteEnd);

			assert.deepStrictEqual(emittedPaste, ["hello world"]);
			assert.deepStrictEqual(emittedSequences, []); // No data events during paste
		});

		it("should handle paste arriving in chunks", () => {
			processInput("\x1B[200~");
			assert.deepStrictEqual(emittedPaste, []);

			processInput("hello ");
			assert.deepStrictEqual(emittedPaste, []);

			processInput("world\x1B[201~");
			assert.deepStrictEqual(emittedPaste, ["hello world"]);
			assert.deepStrictEqual(emittedSequences, []);
		});

		it("should handle paste with input before and after", () => {
			processInput("a");
			processInput("\u001b[200~pasted\u001b[201~");
			processInput("b");

			assert.deepStrictEqual(emittedSequences, ["a", "b"]);
			assert.deepStrictEqual(emittedPaste, ["pasted"]);
		});

		it("should handle paste with newlines", () => {
			processInput("\x1B[200~line1\nline2\nline3\x1B[201~");

			assert.deepStrictEqual(emittedPaste, ["line1\nline2\nline3"]);
			assert.deepStrictEqual(emittedSequences, []);
		});

		it("should handle paste with unicode", () => {
			processInput("\x1B[200~Hello 世界 🎉\x1B[201~");

			assert.deepStrictEqual(emittedPaste, ["Hello 世界 🎉"]);
			assert.deepStrictEqual(emittedSequences, []);
		});
	});

	describe("Destroy", () => {
		it("should clear buffer on destroy", () => {
			processInput("\x1B[<35");
			assert.strictEqual(buffer.getBuffer(), "\x1B[<35");

			buffer.destroy();
			assert.strictEqual(buffer.getBuffer(), "");
		});

		it("should clear pending timeouts on destroy", async () => {
			processInput("\x1B[<35");
			buffer.destroy();

			// Wait longer than timeout
			await wait(15);

			// Should not have emitted anything
			assert.deepStrictEqual(emittedSequences, []);
		});
	});
});
