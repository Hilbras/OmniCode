export interface SuspicionAnalysis {
  readonly suspicious: boolean;
  readonly reasons: readonly string[];
}

export interface SuspicionRule {
  readonly id: string;
  readonly pattern: RegExp;
}

const SUSPICION_RULES: readonly SuspicionRule[] = [
  { id: 'override_instruction', pattern: /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|earlier|above|all|any)\b[^.\n]{0,20}\b(instruction|prompt|rule|direction|context)s?\b/i },
  { id: 'persona_reassignment', pattern: /\byou\s+are\s+now\b|\bfrom\s+now\s+on\s+you\b|\bact\s+as\s+(if\s+you\s+(are|were)\s+)?(a\s+)?(different|new|another)\b/i },
  { id: 'prompt_exfiltration', pattern: /\b(reveal|print|repeat|show|output|dump)\b[^.\n]{0,30}\b(system\s+prompt|your\s+instructions|hidden\s+instructions|developer\s+message)\b/i },
  { id: 'authority_claim', pattern: /\b(the\s+)?(user|developer|admin|administrator|owner|security\s+team)\b[^.\n]{0,25}\b(approved|authorised|authorized|confirmed|requested|asked)\b[^.\n]{0,25}\b(so|therefore|thus|hence)?\s*(you\s+)?(must|should|can|may|will)\b/i },
  {
    id: 'persistent_directive',
    pattern:
      /\b(?:from\s+now\s+on|going\s+forward|for\s+the\s+rest\s+of\s+(?:this|the)\s+(?:conversation|session|task))\b[^.\n]{0,60}\b(?:you\s+must|you\s+will|always|never|do\s+not\s+ask|without\s+asking)\b/i,
  },
  { id: 'permission_bypass', pattern: /\b(skip|bypass|disable|turn\s+off|suppress|override)\b[^.\n]{0,30}\b(permission|approval|confirmation|safety|security|guardrail|sandbox|permission\s+prompt)s?\b/i },
  { id: 'command_execution', pattern: /\b(run|execute|exec)\b[^\n]{0,20}(rm\s+-rf|curl\b[^\n]{0,60}\|\s*(ba)?sh|npm\s+publish|git\s+push\s+--force)/i },
  { id: 'data_exfiltration', pattern: /\b(send|post|upload|exfiltrate|transmit)\b[^.\n]{0,40}\b(api[_ -]?key|token|credential|secret|\.env|private\s+key|password)s?\b/i },
  { id: 'system_frame_spoof', pattern: /<\/?(?:system-reminder|system|assistant|human)\b|\[\/?INST\]|<\|im_(start|end)\|>|^#{1,6}\s*(system|developer)\s+(message|instructions?)\s*$/im },
  {
    id: 'tool_call_spoof',
    pattern: /<\s*tool_call\s*>|##\s*TOOL\s*CALL|\{\s*"name"\s*:\s*"(?:bash|shell|write|edit)"/im,
  },
];

export function analyzeMemoryContent(content: string): SuspicionAnalysis {
  const reasons: string[] = [];
  for (const rule of SUSPICION_RULES) {
    if (rule.pattern.test(content)) reasons.push(rule.id);
  }
  return { suspicious: reasons.length > 0, reasons };
}

export const SUSPICION_RULE_IDS: readonly string[] = SUSPICION_RULES.map((rule) => rule.id);