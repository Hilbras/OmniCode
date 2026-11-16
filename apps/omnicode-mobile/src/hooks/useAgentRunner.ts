import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AgentStep, planTurn } from '@/lib/agent';
import { uid } from '@/lib/format';
import { createMessage, createSession } from '@/lib/state';
import { useStore } from '@/lib/store';
import type { Attachment, Message } from '@/lib/types';

interface RunHandle {
  cancelled: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface AgentRunner {
  running: boolean;
  send: (text: string, attachments?: Attachment[]) => void;
  stop: () => void;
  resolveApproval: (messageId: string, approvalId: string, allowed: boolean) => void;
}

export function useAgentRunner(): AgentRunner {
  const { state, dispatch } = useStore();
  const stateRef = useRef(state);

  const runRef = useRef<RunHandle | null>(null);
  const resolversRef = useRef(new Map<string, (allowed: boolean) => void>());
  const [running, setRunning] = useState(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const resolvers = resolversRef.current;
    return () => {
      if (runRef.current) runRef.current.cancelled = true;
      resolvers.forEach((resolve) => resolve(false));
      resolvers.clear();
    };
  }, []);

  const stop = useCallback(() => {
    if (runRef.current) runRef.current.cancelled = true;
    resolversRef.current.forEach((resolve) => resolve(false));
    resolversRef.current.clear();
  }, []);

  const resolveApproval = useCallback(
    (messageId: string, approvalId: string, allowed: boolean) => {
      const resolver = resolversRef.current.get(approvalId);
      if (resolver) {
        resolversRef.current.delete(approvalId);
        resolver(allowed);
      }
      void messageId;
    },
    [],
  );

  const send = useCallback(
    (text: string, attachments: Attachment[] = []) => {
      const trimmed = text.trim();
      if (trimmed.length === 0 && attachments.length === 0) return;
      if (runRef.current && !runRef.current.cancelled) return;

      const snapshot = stateRef.current;
      let sessionId = snapshot.activeSessionId;
      if (!sessionId || !snapshot.sessions.some((s) => s.id === sessionId)) {
        const session = createSession(snapshot.settings.providerId, snapshot.settings.model);
        dispatch({ type: 'newSession', session });
        sessionId = session.id;
      }

      const userMessage = createMessage('user', trimmed);
      if (attachments.length > 0) userMessage.attachments = attachments;
      dispatch({ type: 'addMessage', sessionId, message: userMessage });

      const assistant: Message = { ...createMessage('assistant', ''), streaming: true };
      dispatch({ type: 'addMessage', sessionId, message: assistant });

      const handle: RunHandle = { cancelled: false };
      runRef.current = handle;
      setRunning(true);

      const steps = planTurn(trimmed, attachments.map((a) => a.name));
      const streamingEnabled = snapshot.settings.streaming;
      const hapticsEnabled = snapshot.settings.haptics;

      const finalize = (stopped: boolean) => {
        dispatch({
          type: 'patchMessage',
          sessionId,
          messageId: assistant.id,
          patch: { streaming: false, stopped },
        });
        setRunning(false);
        runRef.current = null;
      };

      const run = async () => {
        await sleep(450);
        let denied = false;

        for (const step of steps) {
          if (handle.cancelled) break;

          if (step.kind === 'tool') {
            const toolCall = {
              id: uid('tc'),
              tool: step.tool,
              args: step.args,
              status: 'running' as const,
            };
            dispatch({ type: 'addToolCall', sessionId, messageId: assistant.id, toolCall });

            if (step.needsApproval) {
              const approval = {
                id: uid('apr'),
                tool: step.tool,
                args: step.args,
                status: 'pending' as const,
              };
              dispatch({ type: 'setApproval', sessionId, messageId: assistant.id, approval });
              if (hapticsEnabled) {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
                  () => undefined,
                );
              }
              const allowed = await new Promise<boolean>((resolve) => {
                resolversRef.current.set(approval.id, resolve);
              });
              dispatch({
                type: 'setApproval',
                sessionId,
                messageId: assistant.id,
                approval: { ...approval, status: allowed ? 'allowed' : 'denied' },
              });
              if (!allowed || handle.cancelled) {
                dispatch({
                  type: 'patchToolCall',
                  sessionId,
                  messageId: assistant.id,
                  toolCallId: toolCall.id,
                  patch: { status: 'denied' },
                });
                denied = true;
                break;
              }
            }

            await sleep(step.durationMs);
            if (handle.cancelled) {
              dispatch({
                type: 'patchToolCall',
                sessionId,
                messageId: assistant.id,
                toolCallId: toolCall.id,
                patch: { status: 'error', result: 'Stopped by user' },
              });
              break;
            }
            dispatch({
              type: 'patchToolCall',
              sessionId,
              messageId: assistant.id,
              toolCallId: toolCall.id,
              patch: { status: 'done', result: step.result, durationMs: step.durationMs },
            });
            continue;
          }

          const textStep: AgentStep = step;
          if (textStep.kind !== 'text') continue;
          if (streamingEnabled) {
            const text = textStep.text;
            let index = 0;
            while (index < text.length) {
              if (handle.cancelled) break;
              const size = 2 + Math.floor(Math.random() * 4);
              dispatch({
                type: 'appendText',
                sessionId,
                messageId: assistant.id,
                chunk: text.slice(index, index + size),
              });
              index += size;
              await sleep(14 + Math.random() * 18);
            }
          } else {
            await sleep(600);
            if (!handle.cancelled) {
              dispatch({
                type: 'patchMessage',
                sessionId,
                messageId: assistant.id,
                patch: { text: textStep.text },
              });
            }
          }
        }

        if (denied && !handle.cancelled) {
          const note =
            "Understood — I won't touch that file. Everything stays on your device unless you say otherwise.\n\nIf you'd like, pick a different file or tell me what you need and I'll find another way.";
          dispatch({
            type: 'patchMessage',
            sessionId,
            messageId: assistant.id,
            patch: { text: note },
          });
        }

        if (hapticsEnabled && !handle.cancelled) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
            () => undefined,
          );
        }
        finalize(handle.cancelled);
      };

      run().catch(() => finalize(true));
    },
    [dispatch],
  );

  return { running, send, stop, resolveApproval };
}
