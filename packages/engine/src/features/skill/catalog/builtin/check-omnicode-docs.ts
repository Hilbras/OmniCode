import type { SkillDefinition } from '#/features/skill/catalog/types';
import { parseSkillText } from '#/features/skill/catalog/parser';
import CHECK_OMNICODE_DOCS_BODY from './check-omnicode-docs.md?raw';

const PSEUDO_PATH = 'builtin://check-omnicode-docs';

const parsed = parseSkillText({
  skillMdPath: '/builtin/skills/check-omnicode-docs.md',
  skillDirName: 'check-omnicode-docs',
  source: 'builtin',
  text: CHECK_OMNICODE_DOCS_BODY,
});

export const CHECK_OMNICODE_DOCS_SKILL: SkillDefinition = {
  ...parsed,
  path: PSEUDO_PATH,
  dir: PSEUDO_PATH,
  metadata: {
    ...parsed.metadata,
    type: parsed.metadata.type ?? 'inline',
  },
  productSpecific: true,
};
