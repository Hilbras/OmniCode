// T8.4 driver: create session with explicit id, twice concurrently in same process.
import { createOmnicodeHarness, type OmnicodeHarness } from '@hilbras/omnicode-sdk';

const workDir = process.argv[2]!;
const homeDir = process.argv[3]!;
const sessionId = process.argv[4]!;

const identity: any = { productName: 'omnicode-cli', version: '0.0.1-test', platform: 'omnicode_code_cli' };
const harnessA = createOmnicodeHarness({ identity, homeDir });
const harnessB = createOmnicodeHarness({ identity, homeDir });

async function run(label: string, h: OmnicodeHarness): Promise<void> {
  try {
    const s = await h.createSession({ workDir, id: sessionId, model: 'omnicode/omnicode-for-coding' });
    console.log(JSON.stringify({ label, ok: true, id: s.id, dir: s.summary?.sessionDir }));
  } catch (error: any) {
    console.log(JSON.stringify({ label, ok: false, msg: String(error.message ?? error), code: error.code ?? error.cause?.code }));
  } finally {
    await h.close();
  }
}

await Promise.all([run('A', harnessA), run('B', harnessB)]);
