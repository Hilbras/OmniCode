import { isPreservedEnvKey } from '#/human/test/llm/cassette';

for (const key of Object.keys(process.env)) {
  if (key.startsWith('OMNICODE_') && !isPreservedEnvKey(key)) {
    delete process.env[key];
  }
}

process.env['OMNICODE_PERSISTENCE_MINIDB_READMODEL'] = 'false';

import '@hilbras/omnicode-addons';
import '@hilbras/omnicode-tools';
