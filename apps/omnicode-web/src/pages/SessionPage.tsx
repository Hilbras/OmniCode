import { useState, useCallback, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useMessages, useSubmitPrompt, useAbortSession, useSessionStatus } from '../hooks/useSessions';
import { useSessionEvents } from '../hooks/useSessionEvents';
import type { AppMessage, AppMessageContent } from '../api';

function contentToText(content: AppMessageContent[]): string {
  return content
    .map((c) => (c.type === 'text' ? c.text : c.type === 'thinking' ? '[thinking]' : c.type === 'toolUse' ? `[tool: ${c.toolName}]` : ''))
    .filter(Boolean)
    .join('\n');
}

export function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: messages, isPending: msgPending } = useMessages(id);
  const submitPrompt = useSubmitPrompt(id);
  const abortSession = useAbortSession(id);
  const { data: status } = useSessionStatus(id);
  const live = useSessionEvents(id);

  const isStreaming =
    submitPrompt.isPending || abortSession.isPending || live.busy || (status?.contextUsage ?? 0) > 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages?.length, live.streamingText, isStreaming]);

  const handleSend = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const text = input.trim();
      if (!text || isStreaming) return;
      submitPrompt.mutate(text);
      setInput('');
    },
    [input, isStreaming, submitPrompt],
  );

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex flex-1 min-h-0 flex-col gap-3 overflow-y-auto px-4 py-4">
        {msgPending && <p className="text-center text-sm muted">Loading messages…</p>}
        {(messages ?? []).map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {live.streamingText.length > 0 && (
          <div className="my-1 flex flex-col items-start">
            <span className="mono-label mb-1">Assistant</span>
            <div className="panel max-w-[85%] rounded-xl px-4 py-3">
              <div className="whitespace-pre-wrap text-sm leading-relaxed">
                {live.streamingText}
              </div>
            </div>
          </div>
        )}
        {isStreaming && live.streamingText.length === 0 && (
          <div className="flex items-center gap-2 px-1">
            <span className="eyebrow-dot soft-pulse" />
            <span className="mono-label">thinking…</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="shrink-0 px-3 pb-3">
        <div className="panel flex flex-col gap-2 p-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const text = input.trim();
                if (text !== '' && !isStreaming) {
                  submitPrompt.mutate(text);
                  setInput('');
                }
              }
            }}
            placeholder="Message the agent…"
            disabled={isStreaming}
            rows={2}
            className="w-full resize-none rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              background: 'var(--surface)',
              color: 'var(--text)',
              border: `1px solid ${isStreaming ? 'var(--gold)' : 'var(--line-strong)'}`,
            }}
          />
          <div className="flex items-center gap-2">
            <span className="mono-label flex-1">
              {isStreaming ? 'Agent is thinking…' : 'Ready'}
            </span>
            {isStreaming ? (
              <button type="button" className="btn-ghost" onClick={() => abortSession.mutate()}>
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={input.trim() === ''}
                className="btn-gold"
              >
                Send
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: AppMessage }) {
  const isUser = message.role === 'user';
  const text = contentToText(message.content);

  return (
    <div className={`my-1 flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      <span className="mono-label mb-1">{isUser ? 'You' : 'Assistant'}</span>
      <div
        className={`max-w-[85%] rounded-xl px-4 py-3 ${isUser ? 'panel' : 'node'}`}
        style={isUser ? undefined : { borderColor: 'var(--line)' }}
      >
        <div className="whitespace-pre-wrap text-sm leading-relaxed">{text}</div>
      </div>
    </div>
  );
}
