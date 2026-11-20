import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { AppQuestionRequest, QuestionResponse } from '@hilbras/app-core/api';

import { useApi } from '../api/provider';
import { useQueryClient } from '@tanstack/react-query';

type Selections = Record<number, string[]>;

/**
 * Question card for the ask-user flow. Single- and multi-select questions
 * render as option buttons; `allowOther` adds a free-text row. The response
 * keys answers by question text (the daemon's answer contract).
 */
export function QuestionDialog({
  sessionId,
  question,
}: {
  sessionId: string;
  question: AppQuestionRequest;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [selections, setSelections] = useState<Selections>({});
  const [otherText, setOtherText] = useState<Record<number, string>>({});

  const respond = useMutation({
    mutationFn: (response: QuestionResponse) =>
      api.respondQuestion(sessionId, question.questionId, response),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  const pick = (index: number, optionId: string, multi: boolean) => {
    setSelections((prev) => {
      const current = prev[index] ?? [];
      if (!multi) return { ...prev, [index]: [optionId] };
      const next = current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId];
      return { ...prev, [index]: next };
    });
  };

  const buildResponse = (): QuestionResponse => {
    const answers: QuestionResponse['answers'] = {};
    question.questions.forEach((item, index) => {
      const chosen = selections[index] ?? [];
      const other = (otherText[index] ?? '').trim();
      if (chosen.length > 0 && other.length > 0) {
        answers[item.question] = { kind: 'multiWithOther', optionIds: chosen, otherText: other };
        return;
      }
      if (chosen.length > 1) {
        answers[item.question] = { kind: 'multi', optionIds: chosen };
        return;
      }
      if (chosen.length === 1) {
        answers[item.question] = { kind: 'single', optionId: chosen[0] ?? '' };
        return;
      }
      if (other.length > 0 && item.allowOther) {
        answers[item.question] = { kind: 'other', text: other };
      }
    });
    return { answers, method: 'click' };
  };

  const complete = question.questions.every((item, index) => {
    const chosen = selections[index] ?? [];
    const other = (otherText[index] ?? '').trim();
    return chosen.length > 0 || (item.allowOther === true && other.length > 0);
  });

  return (
    <div className="panel sticky top-0 z-10 mb-2 p-3" style={{ borderColor: 'var(--gold)' }}>
      <span className="eyebrow"><span className="eyebrow-dot" />Question</span>
      <div className="mt-2 flex flex-col gap-3">
        {question.questions.map((item, index) => (
          <div key={item.id}>
            <p className="text-sm font-medium">{item.question}</p>
            {item.body !== undefined && <p className="mt-1 text-xs muted">{item.body}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {item.options.map((option) => {
                const chosen = (selections[index] ?? []).includes(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={chosen ? 'btn-gold' : 'btn-ghost'}
                    onClick={() => pick(index, option.id, item.multiSelect === true)}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            {item.allowOther === true && (
              <input
                value={otherText[index] ?? ''}
                onChange={(e) => setOtherText((prev) => ({ ...prev, [index]: e.target.value }))}
                placeholder={item.otherLabel ?? 'Other…'}
                className="mt-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  border: '1px solid var(--line-strong)',
                }}
              />
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          className="btn-gold"
          disabled={!complete || respond.isPending}
          onClick={() => respond.mutate(buildResponse())}
        >
          {respond.isPending ? 'Sending…' : 'Answer'}
        </button>
      </div>
    </div>
  );
}
