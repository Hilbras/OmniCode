const { createHash } = require("node:crypto");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

(async () => {
let timer;
try {
	// Load the addon before the measurement window opens. `require` of a `.node` file is
	// a synchronous dlopen, and on a loaded host it alone can outlast the 200ms window —
	// which made a working clipboard look like it blocked the event loop because the
	// sampling had not started yet.
	const helper = require(process.argv[2]);
	let ticks = 0;
	timer = setInterval(() => ticks++, 10);
	const started = performance.now();
	const pending = helper[process.argv[3]]();
	assert.ok(pending instanceof Promise, "Native reads must return promises");
	const value = await pending;
	const elapsed = performance.now() - started;
	const bytes = typeof value === "string" || Buffer.isBuffer(value) ? Buffer.from(value) : undefined;
	// The stdout shape is a contract: callers compare it with `deepEqual`, so diagnostics
	// go in the assertion message (stderr), never in the payload.
	console.log(JSON.stringify({
		ok: true,
		value: value === null || (typeof value === "string" && value.length <= 100) ? value : undefined,
		unavailable: value === undefined || undefined,
		length: bytes?.length,
		hash: bytes && createHash("sha256").update(bytes).digest("hex"),
	}));
	// The window covers only the read, so the floor can be the plain one: a 10ms interval
	// over `elapsed` ms must have fired at least `elapsed / 200` times, so any read long
	// enough to sample (over 200ms) must show real turns rather than a blocked loop.
	if (elapsed > 200) {
		assert.ok(
			ticks >= Math.max(2, Math.floor(elapsed / 200)),
			`Clipboard I/O must not block the JS event loop (${ticks} ticks in ${Math.round(elapsed)}ms)`,
		);
	}
} catch (error) {
	console.log(JSON.stringify({ ok: false, error: String(error) }));
} finally {
	// A live interval keeps the process alive until `exec`'s timeout, which turns every
	// expected failure (disconnect, timeout, partial transfer) into a multi-second hang
	// instead of the quick error the test asserts. That is why this belongs here and not
	// on the success path only.
	if (timer !== undefined) clearInterval(timer);
	// Check before Node exits: process exit must not hide a leaked child or zombie.
	assert.equal(readFileSync(`/proc/self/task/${process.pid}/children`, "utf8").trim(), "");
}

})().catch((error) => { console.error(error); process.exitCode = 1; });
