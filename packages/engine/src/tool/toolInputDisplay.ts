export type ToolInputDisplay =
  | {
      kind: 'command';
      command: string;
      cwd?: string | undefined;
      description?: string | undefined;
      language?: 'bash' | undefined;
      /**
       * Narrowest exec-policy prefix an "always allow" approval would persist
       * for this command, with the preview form shown in approval UIs.
       * Undefined when no rule can be derived; the approval then falls back to
       * the exact-command rule.
       */
      suggestedRule?: { readonly prefix: readonly string[]; readonly display: string } | undefined;
    }
  | {
      kind: 'file_io';
      operation: 'read' | 'write' | 'edit' | 'glob' | 'grep';
      path: string;
      detail?: string | undefined;
      content?: string | undefined;
      before?: string | undefined;
      after?: string | undefined;
    }
  | {
      kind: 'diff';
      path: string;
      before: string;
      after: string;
      hunks?: number | undefined;
    }
  | {
      kind: 'search';
      query: string;
      scope?: string | undefined;
    }
  | {
      kind: 'url_fetch';
      url: string;
      method?: string | undefined;
    }
  | {
      kind: 'agent_call';
      agent_name: string;
      prompt: string;
      background?: boolean | undefined;
    }
  | {
      kind: 'skill_call';
      skill_name: string;
      args?: string | undefined;
    }
  | {
      kind: 'todo_list';
      items: { title: string; status: string }[];
    }
  | {
      kind: 'task';
      task_id: string;
      status: string;
      description: string;
      task_kind?: string | undefined;
    }
  | {
      kind: 'task_stop';
      task_id: string;
      task_description: string;
    }
  | {
      kind: 'plan_review';
      plan: string;
      path?: string | undefined;
      options?: readonly { label: string; description: string }[] | undefined;
    }
  | {
      kind: 'goal_start';
      objective: string;
      completionCriterion?: string | undefined;
      mode: 'manual' | 'yolo';
    }
  | {
      kind: 'generic';
      summary: string;
      detail?: unknown;
    };
