#!/usr/bin/env node
// Patch @microsoft/api-extractor 7.60.1's AstSymbolTable to tolerate the
// TypeScript 6 const-assertion keyword. The bundled analyzer throws
// "Unable to follow symbol for const" / "tryGetEntityForIdentifier() called
// for an identifier that was not analyzed" whenever it walks an `as const`
// literal, which is ordinary TS 6 output, so the SDK's declaration build
// cannot run unpatched. Runs after every install so the fix survives a clean
// `pnpm install`; it is idempotent and a no-op on other extractor versions.
import { globSync, readFileSync, writeFileSync } from 'node:fs';

const pattern = 'node_modules/.pnpm/@microsoft+api-extractor@7.60.1*/node_modules/@microsoft/api-extractor/lib-commonjs/analyzer/AstSymbolTable.js';
let patched = 0;
let skipped = 0;

for (const file of globSync(pattern)) {
  const source = readFileSync(file, 'utf8');
  if (source.includes("identifierNode.getText() === 'const'")) {
    skipped += 1;
    continue;
  }

  let updated = source;
  const hunk1 =
    'let referencedAstEntity = this.#entitiesByNode.get(identifierNode);\n' +
    '                        if (!referencedAstEntity) {';
  const fix1 =
    'let referencedAstEntity = this.#entitiesByNode.get(identifierNode);\n' +
    '                        if (!referencedAstEntity) {\n' +
    "                            if (identifierNode.getText() === 'const' || identifierNode.getText() === 'as') {\n" +
    '                                return;\n' +
    '                            }';
  const hunk2 =
    'if (!this.#entitiesByNode.has(identifier)) {\n' +
    '            throw new node_core_library_1.InternalError(' +
    "'tryGetEntityForIdentifier() called for an identifier that was not analyzed');\n" +
    '        }';
  const fix2 =
    'if (!this.#entitiesByNode.has(identifier)) {\n' +
    "            if (identifier.getText() === 'const' || identifier.getText() === 'as') {\n" +
    '                return undefined;\n' +
    '            }\n' +
    '            throw new node_core_library_1.InternalError(' +
    "'tryGetEntityForIdentifier() called for an identifier that was not analyzed');\n" +
    '        }';

  if (updated.includes(hunk1)) updated = updated.replace(hunk1, fix1);
  if (updated.includes(hunk2)) updated = updated.replace(hunk2, fix2);
  if (updated !== source) {
    writeFileSync(file, updated);
    patched += 1;
  } else {
    console.warn(`api-extractor patch: hunks not found in ${file} — extractor version changed?`);
    process.exitCode = 1;
  }
}

console.log(`api-extractor const-assertion patch: ${patched} patched, ${skipped} already patched`);
