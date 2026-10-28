import { renderPrompt } from '#/_base/utils/render-prompt';

import compactionInstructionTemplate from './compaction-instruction.md?raw';

export interface CompactionInstructionInput {
  readonly customInstruction?: string;
}

export const REQUIRED_SUMMARY_HEADINGS: readonly string[] = compactionInstructionTemplate
  .split('\n')
  .filter((line) => line.startsWith('## '))
  .map((line) => line.trim());

export function renderCompactionInstruction(input: CompactionInstructionInput): string {
  const customInstruction = input.customInstruction?.trim() ?? '';
  return renderPrompt(compactionInstructionTemplate, {
    custom_instruction_block:
      customInstruction.length > 0 ? `\nOptional user instruction:\n${customInstruction}\n` : '',
  }).trimEnd();
}

export function summaryHasRequiredHeadings(text: string): boolean {
  const lines = new Set(text.split('\n').map((line) => line.trim()));
  return REQUIRED_SUMMARY_HEADINGS.some((heading) => lines.has(heading));
}
