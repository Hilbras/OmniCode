export interface ContextSection {
  readonly id: string;
  readonly title?: string;
  readonly content: string;
}

export interface ContextSectionChange {
  readonly id: string;
  readonly title?: string;
  readonly content: string;
}

export interface ContextSectionDelta {
  readonly added: readonly ContextSectionChange[];
  readonly updated: readonly ContextSectionChange[];
  readonly removed: readonly ContextSectionChange[];
}

export interface ContextProjection {
  readonly delta: ContextSectionDelta;
  readonly text: string;
  readonly changed: boolean;
}

export function diffContextSections(
  previous: readonly ContextSection[],
  current: readonly ContextSection[],
): ContextSectionDelta {
  const before = new Map(previous.map((section) => [section.id, section]));
  const after = new Map(current.map((section) => [section.id, section]));
  const added: ContextSectionChange[] = [];
  const updated: ContextSectionChange[] = [];
  const removed: ContextSectionChange[] = [];
  for (const section of current) {
    const prior = before.get(section.id);
    if (prior === undefined) added.push(toChange(section));
    else if (prior.content !== section.content || prior.title !== section.title) updated.push(toChange(section));
  }
  for (const section of previous) {
    if (!after.has(section.id)) removed.push(toChange(section));
  }
  return { added, updated, removed };
}

export function renderContextSectionDelta(delta: ContextSectionDelta): string {
  const lines: string[] = [];
  for (const section of delta.added) lines.push(renderChange('ADD', section));
  for (const section of delta.updated) lines.push(renderChange('UPDATE', section));
  for (const section of delta.removed) lines.push(renderChange('REMOVE', section));
  return lines.join('\n\n');
}

export function projectContextSections(
  previous: readonly ContextSection[],
  current: readonly ContextSection[],
): ContextProjection {
  const delta = diffContextSections(previous, current);
  const text = renderContextSectionDelta(delta);
  return { delta, text, changed: text.length > 0 };
}

function toChange(section: ContextSection): ContextSectionChange {
  return {
    id: section.id,
    content: section.content,
    ...(section.title === undefined ? {} : { title: section.title }),
  };
}

function renderChange(kind: 'ADD' | 'UPDATE' | 'REMOVE', section: ContextSectionChange): string {
  const title = section.title === undefined ? '' : ` ${section.title}`;
  return `<context-section action="${kind}" id="${section.id}"${title ? ` title="${escapeAttribute(section.title!)}"` : ''}>\n${section.content}\n</context-section>`;
}

function escapeAttribute(value: string): string {
  return value.replace(/"/g, '&quot;').replace(/\n/g, ' ');
}
