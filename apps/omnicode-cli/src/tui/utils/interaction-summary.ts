/**
 * Short human summary of an interaction resolution, for status lines shown
 * when a pending approval/question was answered from another surface.
 */
export function summarizeInteractionResponse(response: unknown): string {
  if (response === null || response === undefined) return 'dismissed';
  if (typeof response === 'string') return response.slice(0, 80);
  if (typeof response !== 'object') {
    const rendered = JSON.stringify(response);
    return rendered === undefined ? 'answered' : rendered.slice(0, 80);
  }
  const record = response as Record<string, unknown>;
  if (record['cancelled'] === true) {
    const reason = record['reason'];
    return typeof reason === 'string' && reason.length > 0
      ? `dismissed (${reason})`
      : 'dismissed';
  }
  if (typeof record['decision'] === 'string') {
    const label =
      typeof record['selectedLabel'] === 'string' && record['selectedLabel'].length > 0
        ? ` (${record['selectedLabel']})`
        : '';
    const feedback =
      typeof record['feedback'] === 'string' && record['feedback'].length > 0
        ? ` — ${record['feedback'].slice(0, 80)}`
        : '';
    return `${record['decision']}${label}${feedback}`;
  }
  if (record['answers'] !== undefined && typeof record['answers'] === 'object') {
    const answers = Object.entries(record['answers'] as Record<string, unknown>);
    if (answers.length === 0) return 'answered';
    const rendered = answers
      .map(([question, answer]) => `${question}: ${renderAnswer(answer)}`)
      .join('; ');
    return rendered.slice(0, 160);
  }
  return 'answered';
}

function renderAnswer(answer: unknown): string {
  if (typeof answer === 'string') return answer;
  const rendered = JSON.stringify(answer);
  return rendered === undefined ? '' : rendered.slice(0, 80);
}
