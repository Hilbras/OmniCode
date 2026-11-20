import { useMutation } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import type { AppApprovalRequest, ApprovalResponse } from '@hilbras/app-core/api';

import { useApi } from '../api/provider';
import { useQueryClient } from '@tanstack/react-query';

function displaySummary(display: unknown): string | undefined {
  if (typeof display !== 'object' || display === null) return undefined;
  const record = display as Record<string, unknown>;
  if (record['kind'] !== 'generic') return undefined;
  const summary = record['summary'];
  return typeof summary === 'string' && summary.length > 0 ? summary : undefined;
}

/**
 * Approval card pinned to the top of the transcript while an approval is
 * pending. Decision goes straight to the daemon; the session event stream
 * clears it via approvalResolved.
 */
export function ApprovalDialog({
  sessionId,
  approval,
}: {
  sessionId: string;
  approval: AppApprovalRequest;
}) {
  const api = useApi();
  const queryClient = useQueryClient();

  const respond = useMutation({
    mutationFn: (response: ApprovalResponse) =>
      api.respondApproval(sessionId, approval.approvalId, response),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  const summary = displaySummary(approval.display);

  return (
    <div className="panel sticky top-0 z-10 mb-2 p-3" style={{ borderColor: 'var(--gold)' }}>
      <div className="flex items-center gap-2">
        <span className="eyebrow"><span className="eyebrow-dot" />Approval needed</span>
        <span className="mono-label ml-auto">
          {approval.toolName} · {approval.action}
        </span>
      </div>
      {summary !== undefined && (
        <p className="mt-2 text-sm">{summary}</p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          className="btn-gold"
          disabled={respond.isPending}
          onClick={() => respond.mutate({ decision: 'approved' })}
        >
          <Check size={15} />
          Approve
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={respond.isPending}
          onClick={() => respond.mutate({ decision: 'rejected' })}
        >
          <X size={15} />
          Reject
        </button>
        <span className="mono-label ml-auto">expires {new Date(approval.expiresAt).toLocaleTimeString()}</span>
      </div>
    </div>
  );
}
