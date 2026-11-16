import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMessages, useSubmitPrompt, useAbortSession, useSessionStatus } from '../hooks/useSessions';
import type { AppMessage, AppMessageContent } from '../api';

function contentToText(content: AppMessageContent[]): string {
  return content
    .map((c) => (c.type === 'text' ? c.text : c.type === 'thinking' ? `[thinking]` : c.type === 'toolUse' ? `[tool: ${c.toolName}]` : ''))
    .filter(Boolean)
    .join('\n');
}

export function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: messages, isPending: msgPending } = useMessages(id);
  const submitPrompt = useSubmitPrompt(id);
  const abortSession = useAbortSession(id);
  const { data: status } = useSessionStatus(id);

  const isStreaming = submitPrompt.isPending || abortSession.isPending || (status?.contextUsage ?? 0) > 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages?.length, isStreaming]);

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
    <div className="flex h-full flex-col" style={{ background: 'var(--color-background)' }}>
      <div
        className="flex h-[44px] shrink-0 items-center gap-3 border-b px-4"
        style={{
          background: 'var(--color-header)',
          borderColor: 'var(--color-border)',
          borderBottomWidth: 1,
        }}
      >
        <button
          onClick={() => navigate('/')}
          className="rounded-md px-2 py-1 text-xs font-medium transition-colors"
          style={{
            background: 'var(--color-surface-hover)',
            color: 'var(--color-foreground-subtle)',
            border: '1px solid var(--color-border)',
            cursor: 'pointer',
          }}
        >
          ← Sessions
        </button>

        <span className="min-w-0 flex-1 truncate text-sm font-medium" style={{ color: 'var(--color-foreground)' }}>
          {id ? id.slice(0, 12) + '…' : ''}
        </span>

        {isStreaming && (
          <button
            onClick={() => abortSession.mutate()}
            className="rounded-md px-3 py-1 text-xs font-medium transition-colors"
            style={{
              background: 'var(--color-destructive-surface)',
              color: 'var(--color-destructive-surface-foreground)',
              border: '1px solid var(--color-destructive)',
              cursor: 'pointer',
            }}
          >
            Stop
          </button>
        )}
      </div>

      <div
        className="flex-1 overflow-y-auto px-4 py-4"
        style={{ background: 'var(--color-background)' }}
      >
        {msgPending && (
          <div className="text-center text-sm" style={{ color: 'var(--color-foreground-subtlest)' }}>
            Loading messages…
          </div>
        )}

        {(messages ?? []).map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={handleSend}
        className="shrink-0 border-t p-3"
        style={{
          background: 'var(--color-panel)',
          borderColor: 'var(--color-border)',
          borderTopWidth: 1,
        }}
      >
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message…"
            disabled={isStreaming}
            className="flex-1 rounded-lg px-3 py-2 text-sm outline-none transition-colors"
            style={{
              background: 'var(--color-input)',
              color: 'var(--color-foreground)',
              border: `1px solid ${isStreaming ? 'var(--color-interaction-ask-foreground)' : 'var(--color-input-border)'}`,
            }}
          />
          <button
            type="submit"
            disabled={!input.trim() || isStreaming}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-40"
            style={{
              background: 'var(--color-interaction-ask-surface)',
              color: 'var(--color-interaction-ask-foreground)',
              border: '1px solid var(--color-interaction-ask-foreground)',
              cursor: 'pointer',
            }}
          >
            Send
          </button>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-[11px]" style={{ color: 'var(--color-foreground-subtlest)' }}>
            {isStreaming ? 'Agent is thinking…' : 'Ready'}
          </span>
          {isStreaming && (
            <span
              className="h-1 w-1 rounded-full"
              style={{ background: 'var(--color-trajectory-assistant)', animation: 'pulse 1.6s var(--wf-ease) infinite' }}
            />
          )}
        </div>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: AppMessage }) {
  const isUser = message.role === 'user';
  const text = contentToText(message.content);

  return (
    <div
      className={`my-2 max-w-[85%] rounded-xl px-4 py-3 ${isUser ? 'ml-auto' : 'mr-auto'}`}
      style={{
        background: isUser ? 'var(--color-user-message-bubble)' : 'var(--color-surface)',
        border: `1px solid ${isUser ? 'var(--color-border)' : 'transparent'}`,
        animation: 'stream-text-in 0.2s var(--wf-ease)',
      }}
    >
      <div
        className="mb-1 text-[11px] font-semibold tracking-wide"
        style={{
          color: isUser ? 'var(--color-trajectory-user)' : 'var(--color-trajectory-assistant)',
        }}
      >
        {isUser ? 'YOU' : 'ASSISTANT'}
      </div>
      <div className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: 'var(--color-foreground)' }}>
        {text}
      </div>
    </div>
  );
}
