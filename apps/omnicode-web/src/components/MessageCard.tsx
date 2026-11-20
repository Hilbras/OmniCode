import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Wrench, Brain } from 'lucide-react';
import type { AppMessage, AppMessageContent } from '../api';

/**
 * One transcript entry: user bubbles, assistant markdown, collapsible
 * thinking sections and tool chips — styled with the Hilbras tokens.
 */
export const MessageCard = memo(function MessageCard({ message }: { message: AppMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`my-1 flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      <span className="mono-label mb-1">{isUser ? 'You' : 'Assistant'}</span>
      <div
        className={`flex max-w-[92%] flex-col gap-2 rounded-xl px-4 py-3 ${isUser ? 'panel' : 'node'}`}
        style={isUser ? undefined : { borderColor: 'var(--line)' }}
      >
        {message.content.map((part, index) => (
          <MessagePart key={index} part={part} isUser={isUser} />
        ))}
      </div>
    </div>
  );
});

function MessagePart({ part, isUser }: { part: AppMessageContent; isUser: boolean }) {
  if (part.type === 'text') {
    if (isUser) return <div className="whitespace-pre-wrap text-sm leading-relaxed">{part.text}</div>;
    return (
      <div className="text-sm leading-relaxed [&_a]:text-gold-text [&_a]:underline [&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.85em] [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_p]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:p-2 [&_pre]:font-mono [&_pre]:text-xs">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
      </div>
    );
  }
  if (part.type === 'thinking') return <ThinkingSection />;
  if (part.type === 'toolUse') return <ToolChip name={part.toolName} />;
  return null;
}

function ThinkingSection() {
  return (
    <details className="w-full">
      <summary className="mono-label flex cursor-pointer items-center gap-1.5 select-none">
        <Brain size={12} />
        thinking
      </summary>
      <div
        className="mt-1 rounded-lg px-2 py-1.5 text-xs leading-relaxed"
        style={{ background: 'var(--gold-soft)', color: 'var(--muted)' }}
      >
        [thinking omitted in this view]
      </div>
    </details>
  );
}

function ToolChip({ name }: { name: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5"
      style={{ background: 'var(--gold-soft)', color: 'var(--gold-text)' }}
    >
      <Wrench size={11} />
      <span className="node-label normal-case">{name}</span>
    </span>
  );
}
