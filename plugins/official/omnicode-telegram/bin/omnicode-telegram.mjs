#!/usr/bin/env node
// Telegram bridge for Omnicode.
//
// Long-polls Telegram and drives your local Omnicode server over loopback, so a
// chat can list sessions, pick one, send prompts, and change the model,
// profile, thinking level, permission mode and plan mode for the next prompt.
//
// Self-contained on purpose: no workspace dependencies, so it runs straight from
// a plugin install. Configuration lives in ~/.omnicode/telegram.json:
//
//   { "botToken": "<from @BotFather>", "allowedChatIds": [123456789] }
//
// The bot fails closed: with no allowedChatIds it answers only with the sender's
// chat id and refuses every other command.

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HOME = process.env.OMNICODE_HOME ?? path.join(homedir(), '.omnicode');
const CONFIG_PATH = path.join(HOME, 'telegram.json');
const STATE_PATH = path.join(HOME, 'telegram-state.json');
const INSTANCES_DIR = path.join(HOME, 'server', 'instances');
const TOKEN_PATH = path.join(HOME, 'server.token');
const POLL_TIMEOUT_S = 25;
const SESSIONS_PAGE = 100;

const state = { offset: 0, selection: {}, overrides: {}, notify: {}, notified: {}, view: {}, provider: {}, models: {}, interactions: {}, pendingQuestion: {}, progress: {}, profilePhotoHash: undefined };

function log(message) {
  process.stdout.write(`[omnicode-telegram] ${message}\n`);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function loadConfig() {
  const config = await readJson(CONFIG_PATH, undefined);
  if (config === undefined) {
    await writeJson(CONFIG_PATH, { botToken: '', allowedChatIds: [], note: 'Fill botToken and allowedChatIds, then restart the bot.' });
    throw new Error(`no config at ${CONFIG_PATH} — a template was written; fill it in and restart`);
  }
  const token = process.env.TELEGRAM_BOT_TOKEN ?? config.botToken ?? '';
  if (token === '') throw new Error(`botToken is empty in ${CONFIG_PATH} (or set TELEGRAM_BOT_TOKEN)`);
  return { botToken: token, allowedChatIds: (config.allowedChatIds ?? []).map(Number) };
}

// --- Omnicode server discovery -------------------------------------------------

async function discoverServer() {
  const entries = existsSync(INSTANCES_DIR) ? await readdir(INSTANCES_DIR) : [];
  let best;
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const info = await readJson(path.join(INSTANCES_DIR, name), undefined);
    if (info === undefined || typeof info.port !== 'number') continue;
    if (!existsSync(`/proc/${info.pid}`)) continue;
    if (best === undefined || (info.heartbeat_at ?? 0) > (best.heartbeat_at ?? 0)) best = info;
  }
  if (best === undefined) throw new Error('no running Omnicode server found (start the desktop app or omnicode server)');
  const token = (await readFile(TOKEN_PATH, 'utf8')).trim();
  return { baseUrl: `http://${best.host}:${best.port}`, token, version: best.host_version };
}

// --- Omnicode API -------------------------------------------------------------

async function api(server, method, route, body) {
  let response;
  try {
    response = await fetch(`${server.baseUrl}${route}`, {
      method,
      headers: {
        authorization: `Bearer ${server.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    forgetServer();
    throw error;
  }
  const text = await response.text();
  let payload;
  try {
    payload = text === '' ? {} : JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  if (!response.ok || (typeof payload.code === 'number' && payload.code !== 0)) {
    throw new Error(payload.msg ?? `HTTP ${response.status}`);
  }
  return payload.data;
}

const trim = (value, max) => {
  const text = String(value ?? '').replaceAll(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

async function listSessions(server) {
  const data = await api(server, 'GET', `/api/v2/sessions?page_size=${SESSIONS_PAGE}`);
  const items = Array.isArray(data?.items) ? data.items : [];
  return items
    .map((item) => ({
      id: item.id,
      title: trim(item.meta?.title || item.meta?.last_prompt || 'untitled', 48),
      updatedAt: item.meta?.updated_at ?? 0,
      project: projectName(item),
      status: typeof item.activity?.status === 'string' ? item.activity.status : '',
      workspaceId: typeof item.workspace?.id === 'string' ? item.workspace.id : '',
      cwd: typeof item.workspace?.cwd === 'string' ? item.workspace.cwd : '',
    }))
    .toSorted((a, b) => b.updatedAt - a.updatedAt);
}

async function lastReply(server, sessionId) {
  const data = await api(server, 'GET', `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages?limit=20`);
  const items = Array.isArray(data?.items) ? data.items : [];
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const message = items[i];
    if (message.role !== 'assistant') continue;
    const text = (message.content ?? [])
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('')
      .trim();
    if (text !== '') return text;
  }
  return undefined;
}

function formatDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function projectName(item) {
  const source = item !== null && typeof item === 'object' ? item : {};
  const cwd =
    typeof source.workspace?.cwd === 'string'
      ? source.workspace.cwd
      : typeof source.metadata?.cwd === 'string'
        ? source.metadata.cwd
        : '';
  if (cwd === '') return '';
  const parts = cwd.split(/[\\/]+/).filter((part) => part !== '');
  return parts.length === 0 ? '' : parts[parts.length - 1];
}

function chunkText(text, limit) {
  const chunks = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current !== '' && current.length + line.length + 1 > limit) {
      chunks.push(current);
      current = line;
      continue;
    }
    current = current === '' ? line : `${current}\n${line}`;
  }
  if (current !== '') chunks.push(current);
  return chunks;
}

function groupSessionsByProject(sessions) {
  const groups = new Map();
  for (const session of sessions) {
    const project = session.project === '' ? 'unknown project' : session.project;
    const list = groups.get(project) ?? [];
    list.push(session);
    groups.set(project, list);
  }
  return [...groups.entries()];
}

function sessionMarks(session, chatId) {
  const parts = [];
  if (session.status === 'running') parts.push('running');
  if (session.id === selectionFor(chatId)) parts.push('selected');
  return parts.length === 0 ? '' : ` (${parts.join(', ')})`;
}

function commandButton(text, command) {
  return { text: String(text).slice(0, 60), callback_data: `cmd|${command}` };
}

function chunkRows(buttons, perRow) {
  const rows = [];
  for (let index = 0; index < buttons.length; index += perRow) rows.push(buttons.slice(index, index + perRow));
  return rows;
}

function projectsKeyboard(groups) {
  const buttons = groups.slice(0, 40).map(([project], index) => commandButton(project, `/project ${index + 1}`));
  return buttons.length === 0 ? undefined : { inline_keyboard: chunkRows(buttons, 2) };
}

function sessionsKeyboard(list) {
  const buttons = list.slice(0, 40).map((session, index) => commandButton(session.title, `/use ${index + 1}`));
  return buttons.length === 0 ? undefined : { inline_keyboard: chunkRows(buttons, 2) };
}

function modelsKeyboard(shown) {
  const buttons = shown.slice(0, 25).map((model, index) => commandButton(modelLabel(model), `/models ${index + 1}`));
  return buttons.length === 0 ? undefined : { inline_keyboard: chunkRows(buttons, 2) };
}

function sendPlain(config, chatId, text, keyboard) {
  return tg(config, 'sendMessage', {
    chat_id: chatId,
    text,
    ...(keyboard === undefined ? undefined : { reply_markup: keyboard }),
    disable_web_page_preview: true,
  });
}

function projectsReport(sessions, chatId) {
  const groups = groupSessionsByProject(sessions);
  const lines = [`Projects (${groups.length}) · ${sessions.length} sessions`, ''];
  groups.forEach(([project, list], index) => {
    const running = list.filter((session) => session.status === 'running').length;
    const selected = list.some((session) => session.id === selectionFor(chatId)) ? ' ← selected' : '';
    const activity = running === 0 ? '' : ` · ${running} running`;
    lines.push(`${index + 1}. ${project} — ${list.length}${activity}${selected}`);
  });
  lines.push('', 'Open a project with /project <n>.');
  return lines.join('\n');
}

function projectReport(entry, chatId) {
  const [project, list] = entry;
  const lines = [`${project} — ${list.length} sessions`];
  const cwd = list[0]?.cwd ?? '';
  if (cwd !== '') lines.push(cwd);
  lines.push('');
  list.forEach((session, index) => {
    lines.push(`${index + 1}. ${session.title}${sessionMarks(session, chatId)}`);
  });
  lines.push('', 'Select with /use <n>, or create one with /new <title>.');
  return lines.join('\n');
}

function shortPath(file) {
  const parts = file.split(/[\\/]+/).filter((part) => part !== '');
  if (parts.length >= 2) {
    const tail = parts.slice(-2).join('/');
    return tail.length <= 60 ? `…/${tail}` : `…/${tail.slice(-58)}`;
  }
  return file.length <= 60 ? file : `…${file.slice(-59)}`;
}

function sessionLabel(item) {
  const title = typeof item.title === 'string' && item.title.trim() !== '' ? item.title : item.last_prompt;
  const text = typeof title === 'string' && title.trim() !== '' ? title.trim() : String(item.id);
  return text.length <= 48 ? text : `${text.slice(0, 47)}…`;
}

function finalTextOf(turn) {
  let final;
  for (const step of turn.steps ?? []) {
    for (const frame of step.frames ?? []) {
      if (frame.kind === 'text' && typeof frame.text === 'string' && frame.text.trim() !== '') {
        final = frame.text.trim();
      }
    }
  }
  return final;
}

function turnFacts(turn) {
  const counts = new Map();
  const files = new Set();
  let tools = 0;
  for (const step of turn.steps ?? []) {
    for (const frame of step.frames ?? []) {
      if (frame.kind !== 'tool') continue;
      tools += 1;
      const name = typeof frame.name === 'string' ? frame.name : 'tool';
      counts.set(name, (counts.get(name) ?? 0) + 1);
      const input = frame.input ?? {};
      if ((name === 'Edit' || name === 'Write') && typeof input.path === 'string') files.add(input.path);
    }
  }
  return { counts, files, tools, steps: (turn.steps ?? []).length };
}

function summarizeTurn(turn, meta, includeBody = true) {
  const { counts, files, tools } = turnFacts(turn);
  const duration = formatDuration(turn.durationMs);
  const lines = [duration === '' ? '<b>✅ Finished</b>' : `<b>✅ Finished</b> · ${duration}`];
  const where = [];
  if (meta !== undefined && meta.project !== '') where.push(escapeHtml(meta.project));
  if (meta !== undefined) where.push(escapeHtml(meta.title));
  if (where.length > 0) lines.push(`<i>${where.join(' · ')}</i>`);
  lines.push('', `▸ <b>${String((turn.steps ?? []).length)} steps</b> · ${String(tools)} tools`);
  if (tools > 0) {
    const breakdown = [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 6)
      .map(([name, count]) => `${escapeHtml(name)}×${String(count)}`)
      .join(' · ');
    lines.push(`▸ ${breakdown}`);
  }
  if (files.size > 0) {
    const listed = [...files].slice(0, 5).map((file) => `<code>${escapeHtml(shortPath(file))}</code>`);
    if (files.size > 5) listed.push(`<i>+${String(files.size - 5)} more</i>`);
    lines.push('', '<b>Files</b>', ...listed);
  }
  if (!includeBody) return lines.join('\n');
  const final = finalTextOf(turn);
  if (final === undefined) {
    lines.push('', '<i>no final message</i>');
  } else {
    const body = final.length > REPORT_MAX_CHARS ? `${final.slice(0, REPORT_MAX_CHARS)}\n...(truncated)` : final;
    lines.push('', '<blockquote>', markdownToHtml(body), '</blockquote>');
  }
  return lines.join('\n');
}

async function statusReport(info, chatId) {
  const data = await api(info, 'GET', '/api/v1/sessions?page_size=100');
  const items = Array.isArray(data?.items) ? data.items : [];
  const working = items.filter((item) => item.busy === true || item.main_turn_active === true);
  const selected = selectionFor(chatId);
  if (working.length === 0) {
    return `Nothing is working right now.\n${String(items.length)} session(s) in total.`;
  }
  const lines = [`Working now (${String(working.length)}):`];
  for (const item of working.slice(0, 10)) {
    const parts = [];
    const project = projectName(item);
    if (project !== '') parts.push(project);
    parts.push(sessionLabel(item));
    let line = `• ${parts.join(' · ')}`;
    try {
      const turn = await newestTurn(info, item.id);
      const started = turn === undefined || typeof turn.startedAt !== 'string' ? Number.NaN : Date.parse(turn.startedAt);
      if (Number.isFinite(started)) line += ` · ${formatDuration(Date.now() - started)}`;
    } catch {
      // an unreadable session simply shows without elapsed time
    }
    if (item.id === selected) {
      try {
        const [approvals, questions] = await Promise.all([pendingApprovals(info, item.id), pendingQuestions(info, item.id)]);
        if (approvals.length > 0) line += ' · waiting for approval';
        else if (questions.length > 0) line += ' · waiting for an answer';
      } catch {
        // the status line still renders without the wait hint
      }
      line += ' ← selected';
    }
    lines.push(line, `  ${String(item.id)}`);
  }
  if (working.length > 10) lines.push(`…and ${String(working.length - 10)} more.`);
  return lines.join('\n');
}

async function pendingApprovals(info, sessionId) {
  const data = await api(info, 'GET', `/api/v1/sessions/${encodeURIComponent(sessionId)}/approvals?status=pending`);
  return Array.isArray(data?.items) ? data.items : [];
}

async function pendingQuestions(info, sessionId) {
  const data = await api(info, 'GET', `/api/v1/sessions/${encodeURIComponent(sessionId)}/questions?status=pending`);
  return Array.isArray(data?.items) ? data.items : [];
}

function approvalText(approval) {
  let preview = '';
  try {
    preview = JSON.stringify(approval.tool_input_display ?? {}).slice(0, 300);
  } catch {
    preview = '';
  }
  const head = typeof approval.action === 'string' && approval.action !== '' ? `${String(approval.tool_name)} · ${approval.action}` : String(approval.tool_name ?? 'tool');
  const lines = ['🔐 Approval needed', '', head];
  if (preview !== '' && preview !== '{}') lines.push('', preview);
  lines.push('', 'Allow it?');
  return lines.join('\n');
}

function approvalKeyboard(approval) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Allow', callback_data: `apv|${approval.approval_id}|approved` },
        { text: '⛔ Deny', callback_data: `apv|${approval.approval_id}|rejected` },
      ],
      [{ text: '♾ Allow for this session', callback_data: `apv|${approval.approval_id}|approved|session` }],
    ],
  };
}

function questionText(question) {
  const lines = ['❓ Question', ''];
  for (const item of question.questions ?? []) {
    if (typeof item.header === 'string' && item.header !== '') lines.push(`— ${item.header} —`);
    lines.push(item.question);
    (item.options ?? []).forEach((option, index) => {
      const description = typeof option.description === 'string' && option.description !== '' ? ` — ${option.description}` : '';
      lines.push(`  ${index + 1}. ${option.label}${description}`);
    });
    if (item.multi_select === true) lines.push('  (multi-select: reply with numbers, e.g. 1,3)');
    lines.push('');
  }
  lines.push('Pick a button, reply with the number, or send any other text as the answer.');
  return lines.join('\n');
}

function questionKeyboard(question) {
  const rows = [];
  for (const item of question.questions ?? []) {
    if (item.multi_select === true) continue;
    for (const option of item.options ?? []) {
      rows.push([{ text: String(option.label).slice(0, 60), callback_data: `q|${question.question_id}|${item.id}|${option.id}` }]);
    }
  }
  return rows.length === 0 ? undefined : { inline_keyboard: rows.slice(0, 8) };
}

async function pollInteractions(config) {
  const info = await server();
  for (const chatId of Object.keys(state.selection)) {
    const sessionId = state.selection[chatId];
    if (typeof sessionId !== 'string' || sessionId === '') continue;
    let approvals;
    let questions;
    try {
      approvals = await pendingApprovals(info, sessionId);
      questions = await pendingQuestions(info, sessionId);
    } catch {
      continue;
    }
    const seen = new Map(Object.entries(state.interactions[chatId] ?? {}));
    let changed = false;
    for (const approval of approvals) {
      if (typeof approval.approval_id !== 'string' || seen.has(approval.approval_id)) continue;
      seen.set(approval.approval_id, sessionId);
      changed = true;
      try {
        await tg(config, 'sendMessage', {
          chat_id: Number(chatId),
          text: approvalText(approval),
          reply_markup: approvalKeyboard(approval),
          disable_web_page_preview: true,
        });
      } catch (error) {
        log(`approval notice failed: ${error.message}`);
      }
    }
    for (const question of questions) {
      if (typeof question.question_id !== 'string' || seen.has(question.question_id)) continue;
      seen.set(question.question_id, sessionId);
      changed = true;
      state.pendingQuestion[chatId] = {
        questionId: question.question_id,
        sessionId,
        questions: question.questions ?? [],
      };
      const keyboard = questionKeyboard(question);
      try {
        await tg(config, 'sendMessage', {
          chat_id: Number(chatId),
          text: questionText(question),
          ...(keyboard === undefined ? undefined : { reply_markup: keyboard }),
          disable_web_page_preview: true,
        });
      } catch (error) {
        log(`question notice failed: ${error.message}`);
      }
    }
    const live = new Set([...approvals.map((a) => a.approval_id), ...questions.map((q) => q.question_id)]);
    const kept = Object.fromEntries([...seen].filter(([id]) => live.has(id)));
    if (Object.keys(kept).length !== seen.size) changed = true;
    if (changed) {
      state.interactions[chatId] = kept;
      await saveState();
    }
  }
}

async function handleCallback(config, query) {
  const chatId = query?.message?.chat?.id;
  const messageId = query?.message?.message_id;
  const parts = typeof query?.data === 'string' ? query.data.split('|') : [];
  const kind = parts[0];
  const id = parts[1];
  const say = async (text) => {
    if (typeof messageId === 'number' && typeof chatId === 'number') {
      try {
        await tg(config, 'editMessageText', { chat_id: chatId, message_id: messageId, text, disable_web_page_preview: true });
        return;
      } catch {
        // fall through to a fresh message when the edit is not allowed
      }
    }
    if (typeof chatId === 'number') await send(config, chatId, text).catch(() => undefined);
  };
  try {
    if (kind === 'cmd') {
      await handle(config, chatId, decodeURIComponent(id));
      return;
    }
    const recorded = state.interactions[chatId]?.[id];
    const sessionId = typeof recorded === 'string' && recorded !== '' ? recorded : state.selection[chatId];
    if (typeof sessionId !== 'string') throw new Error('no session selected in this chat');
    if (kind === 'apv') {
      const decision = parts[2];
      const scope = parts[3] === 'session' ? 'session' : undefined;
      const body = scope === undefined ? { decision } : { decision, scope };
      const result = await api(await server(), 'POST', `/api/v1/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(id)}`, body);
      const verb = decision === 'approved' ? 'Allowed' : decision === 'rejected' ? 'Denied' : 'Cancelled';
      await say(result?.resolved === false ? '⚠️ Already answered elsewhere.' : `✅ ${verb}${scope === 'session' ? ' for this session' : ''}.`);
      return;
    }
    if (kind === 'q') {
      const itemId = parts[2];
      const optionId = parts[3];
      await api(await server(), 'POST', `/api/v1/sessions/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(id)}`, {
        answers: { [itemId]: { kind: 'single', option_id: optionId } },
        method: 'click',
      });
      delete state.pendingQuestion[chatId];
      await saveState();
      await say('✅ Answered.');
      return;
    }
    await say('Unknown action.');
  } catch (error) {
    await say(`Could not answer: ${error.message}`);
  } finally {
    try {
      await tg(config, 'answerCallbackQuery', { callback_query_id: query.id });
    } catch {
      // the spinner expiring on its own is harmless
    }
  }
}

async function answerQuestionByText(config, chatId, pending, text) {
  const item = pending.questions?.[0];
  if (pending.questions.length > 1 || item === undefined) {
    await send(config, chatId, 'This question has several parts — answer it in the app.');
    return;
  }
  const options = item.options ?? [];
  const tokens = text.split(/[\s,]+/).filter((token) => token !== '');
  const numbers = tokens.map((token) => Number.parseInt(token, 10));
  const allNumbers = numbers.length > 0 && numbers.every((value) => Number.isInteger(value) && value >= 1 && value <= options.length);
  let answer;
  if (allNumbers) {
    const ids = numbers.map((value) => options[value - 1].id).filter((value) => typeof value === 'string');
    if (ids.length === 1) answer = { kind: 'single', option_id: ids[0] };
    else if (ids.length > 1) answer = { kind: 'multi', option_ids: ids };
  }
  if (answer === undefined) answer = { kind: 'other', text };
  try {
    await api(await server(), 'POST', `/api/v1/sessions/${encodeURIComponent(pending.sessionId)}/questions/${encodeURIComponent(pending.questionId)}`, {
      answers: { [item.id]: answer },
      method: 'enter',
    });
    delete state.pendingQuestion[chatId];
    await saveState();
    await send(config, chatId, '✅ Answered.');
  } catch (error) {
    await send(config, chatId, `Could not answer: ${error.message}`);
  }
}

const MAX_IMAGE_BYTES = 5_000_000;

function promptOverrides(chatId) {
  const overrides = overridesFor(chatId);
  const body = {};
  for (const key of ['model', 'profile', 'thinking', 'permission_mode']) {
    if (overrides[key] !== undefined) body[key] = overrides[key];
  }
  if (overrides.plan_mode !== undefined) body.plan_mode = overrides.plan_mode === true || overrides.plan_mode === 'true';
  return body;
}

async function downloadTelegramFile(config, fileId) {
  const file = await tg(config, 'getFile', { file_id: fileId });
  const filePath = typeof file?.file_path === 'string' ? file.file_path : '';
  if (filePath === '') throw new Error('telegram did not return a file path');
  const response = await fetch(`https://api.telegram.org/file/bot${config.botToken}/${filePath}`, {
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`download failed with HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function imagePartOf(message) {
  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const largest = message.photo[message.photo.length - 1];
    return typeof largest?.file_id === 'string'
      ? { fileId: largest.file_id, mediaType: 'image/jpeg', name: 'telegram-photo.jpg' }
      : undefined;
  }
  const document = message.document;
  if (document === undefined || typeof document.file_id !== 'string') return undefined;
  const mime = typeof document.mime_type === 'string' ? document.mime_type : '';
  if (!mime.startsWith('image/')) return undefined;
  return { fileId: document.file_id, mediaType: mime, name: typeof document.file_name === 'string' ? document.file_name : 'telegram-image' };
}

async function handleMedia(config, chatId, message) {
  const sessionId = selectionFor(chatId);
  if (sessionId === undefined) {
    await send(config, chatId, 'No session selected. Use /sessions then /use <n>.');
    return;
  }
  const image = imagePartOf(message);
  if (image === undefined) {
    await send(config, chatId, 'Only images are supported right now.');
    return;
  }
  const bytes = await downloadTelegramFile(config, image.fileId);
  if (bytes.length > MAX_IMAGE_BYTES) {
    await send(config, chatId, `That image is ${(bytes.length / 1_000_000).toFixed(1)} MB; the limit is 5 MB.`);
    return;
  }
  const caption = typeof message.caption === 'string' && message.caption.trim() !== '' ? message.caption.trim() : 'Please look at this image.';
  const body = {
    content: [
      { type: 'image', source: { kind: 'base64', media_type: image.mediaType, data: bytes.toString('base64'), name: image.name } },
      { type: 'text', text: caption },
    ],
    ...promptOverrides(chatId),
  };
  await api(await server(), 'POST', `/api/v1/sessions/${encodeURIComponent(sessionId)}/prompts`, body);
  await send(config, chatId, `Sent ${image.name} to the session.`);
}

function formatTokens(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US') : '0';
}

async function usageReport(info, sessionId) {
  const data = await api(info, 'GET', `/api/v1/sessions/${encodeURIComponent(sessionId)}/transcript?agent_id=main&page_size=5`);
  const turns = (Array.isArray(data?.items) ? data.items : []).filter((item) => item?.kind === 'turn');
  if (turns.length === 0) return 'No turns yet.';
  const totals = { inputOther: 0, output: 0, inputCacheRead: 0, inputCacheCreation: 0 };
  let steps = 0;
  for (const turn of turns) {
    for (const step of turn.steps ?? []) {
      const usage = step.usage ?? {};
      steps += 1;
      for (const key of Object.keys(totals)) {
        if (typeof usage[key] === 'number') totals[key] += usage[key];
      }
    }
  }
  return [
    `Usage · last ${String(turns.length)} turn(s) · ${String(steps)} steps`,
    '',
    `new input     ${formatTokens(totals.inputOther)}`,
    `output        ${formatTokens(totals.output)}`,
    `cache read    ${formatTokens(totals.inputCacheRead)}`,
    `cache write   ${formatTokens(totals.inputCacheCreation)}`,
  ].join('\n');
}

function gitIn(cwd, args) {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', cwd, ...args],
      { timeout: 10000, maxBuffer: 1024 * 1024 },
      (error, stdout) => resolve({ ok: error === null, stdout: String(stdout ?? '') }),
    );
  });
}

async function diffReport(cwd) {
  if (cwd === '') return 'This session has no workspace path.';
  const status = await gitIn(cwd, ['status', '--short']);
  if (!status.ok) return `Not a git working tree: ${cwd}`;
  const lines = [`Git · ${cwd}`, ''];
  const changed = status.stdout.trim();
  lines.push(changed === '' ? '(clean)' : changed.split('\n').slice(0, 30).join('\n'));
  const stat = await gitIn(cwd, ['diff', '--stat']);
  const statText = stat.stdout.trim();
  if (statText !== '') lines.push('', ...statText.split('\n').slice(0, 12));
  return lines.join('\n').slice(0, 3500);
}

async function filesReport(info, sessionId) {
  const turn = await newestTurn(info, sessionId);
  if (turn === undefined) return 'No turns yet.';
  const { files } = turnFacts(turn);
  if (files.size === 0) return 'The last turn changed no files.';
  return ['Files changed in the last turn', '', ...[...files].slice(0, 20).map((file) => `• ${file}`)].join('\n');
}

function normalizeInteractions(saved) {
  const out = {};
  for (const [chatId, value] of Object.entries(saved ?? {})) {
    if (Array.isArray(value)) out[chatId] = Object.fromEntries(value.map((id) => [String(id), '']));
    else if (value !== null && typeof value === 'object') out[chatId] = { ...value };
  }
  return out;
}

const NOTIFY_INTERVAL_MS = 3000;
const REPORT_MAX_CHARS = 3500;

async function newestTurn(server, sessionId) {
  const data = await api(server, 'GET', `/api/v1/sessions/${encodeURIComponent(sessionId)}/transcript?agent_id=main&page_size=1`);
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.find((item) => item !== null && typeof item === 'object' && item.kind === 'turn');
}

function reportsEnabled(chatId) {
  return state.notify[chatId] !== false;
}

async function rememberNewestTurn(chatId, sessionId) {
  try {
    const turn = await newestTurn(await server(), sessionId);
    if (turn !== undefined && turn.state === 'completed') state.notified[chatId] = turn.turnId;
  } catch {
    // a session that cannot be read now simply announces its next finished turn
  }
}

async function primeReports() {
  for (const chatId of Object.keys(state.selection)) {
    if (state.notified[chatId] !== undefined) continue;
    await rememberNewestTurn(chatId, state.selection[chatId]);
  }
  await saveState();
}

let reporting = false;

const HTML_MESSAGE_LIMIT = 3800;

function progressLine(turn) {
  const { tools, steps } = turnFacts(turn);
  const lastStep = (turn.steps ?? []).at(-1);
  const names = (lastStep?.frames ?? [])
    .filter((frame) => frame.kind === 'tool')
    .map((frame) => frame.name)
    .filter((name) => typeof name === 'string');
  const started = typeof turn.startedAt === 'string' ? Date.parse(turn.startedAt) : Number.NaN;
  const elapsed = Number.isFinite(started) ? formatDuration(Date.now() - started) : '';
  const parts = ['⏳ <b>Working</b>'];
  if (steps > 0) parts.push(`step ${String(steps)}`);
  if (names.length > 0) parts.push(escapeHtml(names[names.length - 1]));
  if (tools > 0) parts.push(`${String(tools)} tools`);
  if (elapsed !== '') parts.push(elapsed);
  return parts.join(' · ');
}

async function showProgress(config, chatId, turn, progress) {
  const line = progressLine(turn);
  if (progress === undefined || progress.turnId !== turn.turnId || typeof progress.messageId !== 'number') {
    try {
      const sent = await tg(config, 'sendMessage', { chat_id: Number(chatId), text: line, parse_mode: 'HTML', disable_web_page_preview: true });
      state.progress[chatId] = { turnId: turn.turnId, messageId: sent?.message_id, lastLine: line };
      await saveState();
    } catch (error) {
      log(`progress message failed: ${error.message}`);
    }
    return;
  }
  if (progress.lastLine === line) return;
  try {
    await tg(config, 'editMessageText', {
      chat_id: Number(chatId),
      message_id: progress.messageId,
      text: line,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    progress.lastLine = line;
  } catch {
    // a throttled or rejected edit is harmless; the next tick tries again
  }
}

async function sendReportFile(config, chatId, head, body) {
  const content = [head.replace(/<[^>]+>/g, ''), '', body].join('\n');
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('document', new Blob([content], { type: 'text/markdown' }), 'report.md');
  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendDocument`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  const payload = await response.json();
  if (payload.ok !== true) throw new Error(payload.description ?? 'sendDocument failed');
  return payload.result?.message_id;
}

async function deliverReport(config, chatId, turn, meta, progress) {
  const full = summarizeTurn(turn, meta, true);
  const bodyText = finalTextOf(turn) ?? '';
  const oversize = full.length > HTML_MESSAGE_LIMIT || bodyText.length > REPORT_MAX_CHARS;
  const reuse =
    progress !== undefined && progress.turnId === turn.turnId && typeof progress.messageId === 'number' ? progress.messageId : undefined;
  if (!oversize) {
    if (reuse !== undefined) {
      try {
        await tg(config, 'editMessageText', {
          chat_id: chatId,
          message_id: reuse,
          text: full,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });
        return { via: 'edited', messageId: reuse };
      } catch {
        // fall through to a fresh message
      }
    }
    const sent = await sendHtml(config, chatId, full);
    return { via: 'sent', messageId: sent?.message_id };
  }
  const head = summarizeTurn(turn, meta, false);
  const body = finalTextOf(turn) ?? '';
  let messageId;
  if (reuse !== undefined) {
    try {
      await tg(config, 'editMessageText', {
        chat_id: chatId,
        message_id: reuse,
        text: `${head}\n\n<i>full report attached.</i>`,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
      messageId = reuse;
    } catch {
      const sent = await sendHtml(config, chatId, head);
      messageId = sent?.message_id;
    }
  } else {
    const sent = await sendHtml(config, chatId, head);
    messageId = sent?.message_id;
  }
  const documentMessageId = await sendReportFile(config, chatId, head, body);
  return { via: 'document', messageId, documentMessageId };
}

async function reportFinishedTurns(config) {
  if (reporting) return;
  reporting = true;
  try {
    const info = await server();
    for (const chatId of Object.keys(state.selection)) {
      const sessionId = state.selection[chatId];
      if (typeof sessionId !== 'string' || !reportsEnabled(chatId)) continue;
      let turn;
      try {
        turn = await newestTurn(info, sessionId);
      } catch {
        continue;
      }
      if (turn === undefined) continue;
      const progress = state.progress[chatId];
      if (turn.state === 'running') {
        await showProgress(config, chatId, turn, progress);
        continue;
      }
      if (turn.turnId === state.notified[chatId]) continue;
      state.notified[chatId] = turn.turnId;
      await saveState();
      if (turn.state !== 'completed') {
        delete state.progress[chatId];
        await saveState();
        continue;
      }
      const sessions = await listSessions(info).catch(() => []);
      const meta = sessions.find((session) => session.id === sessionId);
      try {
        await deliverReport(config, Number(chatId), turn, meta, progress);
      } catch (error) {
        log(`report to ${String(chatId)} failed: ${error.message}`);
      }
      delete state.progress[chatId];
      await saveState();
    }
  } finally {
    reporting = false;
  }
}

// --- Telegram -----------------------------------------------------------------

let serverPromise;
let serverCheckedAt = 0;
const SERVER_CACHE_MS = 5000;

function server() {
  const now = Date.now();
  if (serverPromise === undefined || now - serverCheckedAt >= SERVER_CACHE_MS) {
    serverCheckedAt = now;
    serverPromise = discoverServer().catch((error) => {
      serverPromise = undefined;
      throw error;
    });
  }
  return serverPromise;
}

function forgetServer() {
  serverPromise = undefined;
  serverCheckedAt = 0;
}

async function tg(config, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const payload = await response.json();
  if (payload.ok !== true) throw new Error(payload.description ?? `telegram ${method} failed`);
  return payload.result;
}

const send = (config, chatId, text) => tg(config, 'sendMessage', { chat_id: chatId, text, disable_web_page_preview: true });

const escapeHtml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function markdownToHtml(text) {
  const codeBlocks = [];
  const staged = text.replace(/```[^\n]*\n([\s\S]*?)```/g, (_match, code) => {
    codeBlocks.push(`<pre>${escapeHtml(String(code).replace(/\n$/, ''))}</pre>`);
    return `\u0000${String(codeBlocks.length - 1)}\u0000`;
  });
  let html = escapeHtml(staged);
  html = html.replace(/`([^`\n]+)`/g, (_match, code) => `<code>${code}</code>`);
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  html = html.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');
  html = html.replace(/^\s*[-*]\s+/gm, '• ');
  return html.replace(/\u0000(\d+)\u0000/g, (_match, index) => codeBlocks[Number(index)] ?? '');
}

async function sendHtml(config, chatId, html) {
  try {
    return await tg(config, 'sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true });
  } catch {
    const plain = html
      .replace(/<[^>]+>/g, '')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&amp;', '&');
    return send(config, chatId, plain);
  }
}

const COMMANDS_BROWSE = [
  { command: 'sessions', description: 'projects, with their latest sessions' },
  { command: 'project', description: 'open a project and list all its sessions' },
  { command: 'new', description: 'create a session in the open project' },
  { command: 'use', description: 'select a session by number' },
  { command: 'status', description: 'which sessions are working right now' },
  { command: 'help', description: 'show the command list' },
];

const COMMANDS_SESSION = [
  { command: 'new', description: 'create another session in this project' },
  { command: 'models', description: 'pick the model for the next prompt' },
  { command: 'provider', description: 'narrow the models to one provider' },
  { command: 'model', description: 'set a model by alias, or clear it' },
  { command: 'thinking', description: 'thinking level for the next prompt' },
  { command: 'profile', description: 'profile for the next prompt' },
  { command: 'permission', description: 'permission mode for the next prompt' },
  { command: 'plan', description: 'plan mode on or off' },
  { command: 'last', description: 'newest assistant reply' },
  { command: 'usage', description: 'tokens used by this session' },
  { command: 'diff', description: 'git status and diffstat of the workspace' },
  { command: 'files', description: 'files the last turn changed' },
  { command: 'stop', description: 'cancel the running turn' },
  { command: 'current', description: 'show the selection and overrides' },
  { command: 'notify', description: 'report each turn when it finishes' },
  { command: 'sessions', description: 'back to the project list' },
  { command: 'help', description: 'show the command list' },
];

const SHORT_DESCRIPTION = 'Drive Omnicode from chat: pick a session, send prompts, switch model.';

const DESCRIPTION = [
  'Omnicode from Telegram.',
  '',
  'List your sessions, pick one, and send prompts to it. Model, profile, thinking level, permission mode and plan mode can be overridden per prompt.',
].join('\n');

const AVATAR_PATH = path.join(import.meta.dirname, '..', 'assets', 'avatar.jpg');

async function uploadProfilePhoto(config) {
  const bytes = await readFile(AVATAR_PATH);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (state.profilePhotoHash === digest) return 'photo unchanged';
  const form = new FormData();
  form.append('photo', JSON.stringify({ type: 'static', photo: 'attach://avatar.jpg' }));
  form.append('avatar.jpg', new Blob([bytes], { type: 'image/jpeg' }), 'avatar.jpg');
  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/setMyProfilePhoto`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  const payload = await response.json();
  if (payload.ok !== true) throw new Error(payload.description ?? 'setMyProfilePhoto failed');
  state.profilePhotoHash = digest;
  return 'photo uploaded';
}

async function waitForServer() {
  for (;;) {
    try {
      return await server();
    } catch (error) {
      log(`waiting for the Omnicode server: ${error.message}`);
      await new Promise((resolve) => {
        setTimeout(resolve, 5000);
      });
    }
  }
}

async function applyBotProfile(config) {
  const attempts = [
    ['commands', () => tg(config, 'setMyCommands', { commands: COMMANDS_BROWSE })],
    ['menu', () => tg(config, 'setChatMenuButton', { menu_button: { type: 'commands' } })],
    ['short description', () => tg(config, 'setMyShortDescription', { short_description: SHORT_DESCRIPTION })],
    ['description', () => tg(config, 'setMyDescription', { description: DESCRIPTION })],
    ['photo', () => uploadProfilePhoto(config)],
  ];
  const outcomes = [];
  for (const [label, run] of attempts) {
    try {
      const result = await run();
      outcomes.push(typeof result === 'string' ? `${label}: ${result}` : `${label}: ok`);
    } catch (error) {
      outcomes.push(`${label}: ${error.message}`);
    }
  }
  await saveState();
  log(`bot profile — ${outcomes.join(', ')}`);
}

async function setMenu(config, chatId, commands) {
  try {
    await tg(config, 'setMyCommands', { commands, scope: { type: 'chat', chat_id: chatId } });
  } catch (error) {
    log(`menu for ${String(chatId)} not updated: ${error.message}`);
  }
}

let announcedFor = '';

async function announceConnection(config, info) {
  if (announcedFor === info.baseUrl) return;
  announcedFor = info.baseUrl;
  const line = `✅ Connected to OmniCode\n${info.baseUrl} (omnicode ${info.version ?? '?'})`;
  for (const chatId of config.allowedChatIds) {
    try {
      await send(config, chatId, line);
    } catch (error) {
      log(`connect notice to ${String(chatId)} failed: ${error.message}`);
    }
  }
}

async function watchServer(config) {
  let info;
  try {
    info = await server();
  } catch {
    announcedFor = '';
    return;
  }
  await announceConnection(config, info);
}

async function modelCatalog(info) {
  const data = await api(info, 'GET', '/api/v1/models');
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.filter((item) => typeof item.model === 'string' && item.model !== '');
}

function providerCounts(models) {
  const counts = new Map();
  for (const model of models) {
    const provider = typeof model.provider === 'string' ? model.provider : '';
    if (provider === '') continue;
    counts.set(provider, (counts.get(provider) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}

function modelLabel(model) {
  const display = typeof model.display_name === 'string' && model.display_name !== '' ? model.display_name : model.model;
  return `${display} (${String(model.provider ?? '')})`;
}

const HELP = [
  'Omnicode from Telegram',
  '',
  '/sessions — projects, with their latest sessions',
  '/project <n|name> — open a project and list all its sessions',
  '/new <title> — create a session in the open project',
  '/status — sessions working right now',
  '/use <n> — select one by number',
  '/current — show the selection and pending overrides',
  '/last — show the newest assistant reply',
  '/usage — tokens used by this session',
  '/diff — git status and diffstat of the workspace',
  '/files — files the last turn changed',
  '/notify <on|off> — report each turn when it finishes',
  '/stop — cancel the running turn',
  '',
  'Send any other text to prompt the selected session.',
  '',
  'Per-prompt overrides (apply to the next prompt):',
  '/model <alias|clear>',
  '/profile <name|clear>',
  '/thinking <level|clear>',
  '/permission <mode|clear>',
  '/plan <on|off|clear>',
  '/models — pick a model by number (after /provider)',
  '/provider — narrow the model list to one provider',
  '/settings — list the model catalog to pick from',
].join('\n');

function selectionFor(chatId) {
  return state.selection[chatId];
}

function overridesFor(chatId) {
  state.overrides[chatId] ??= {};
  return state.overrides[chatId];
}

function describeOverrides(chatId) {
  const overrides = overridesFor(chatId);
  const keys = ['model', 'profile', 'thinking', 'permission_mode', 'plan_mode'];
  const shown = keys.filter((key) => overrides[key] !== undefined).map((key) => `${key}=${overrides[key]}`);
  return shown.length === 0 ? 'none' : shown.join(', ');
}

async function handle(config, chatId, text) {
  const trimmed = text.trim();
  if (trimmed === '' ) return;
  if (!trimmed.startsWith('/')) {
    const pending = state.pendingQuestion[chatId];
    if (pending !== undefined && (pending.questions?.length ?? 0) > 0) {
      await answerQuestionByText(config, chatId, pending, trimmed);
      return;
    }
    const sessionId = selectionFor(chatId);
    if (sessionId === undefined) {
      await send(config, chatId, 'No session selected. Use /sessions then /use <n>.');
      return;
    }
    const body = { content: [{ type: 'text', text: trimmed }], ...promptOverrides(chatId) };
    try {
      await api(await server(), 'POST', `/api/v1/sessions/${encodeURIComponent(sessionId)}/prompts`, body);
      await send(config, chatId, `Sent to ${trimmed.slice(0, 40)}…\nUse /last to read the reply.`);
    } catch (error) {
      await send(config, chatId, `Prompt failed: ${error.message}`);
    }
    return;
  }

  const [rawCommand, ...rest] = trimmed.split(/\s+/);
  const command = rawCommand.split('@')[0];
  const argument = rest.join(' ').trim();

  switch (command) {
    case '/start':
    case '/help':
      await send(config, chatId, HELP);
      return;
    case '/status':
      await send(config, chatId, await statusReport(await server(), chatId));
      return;
    case '/sessions': {
      const sessions = await listSessions(await server());
      if (sessions.length === 0) {
        await send(config, chatId, 'No sessions.');
        return;
      }
      const chunks = chunkText(projectsReport(sessions, chatId), 3800);
      state.view[chatId] = { project: '', workspaceId: '', cwd: '', ids: [] };
      await saveState();
      await setMenu(config, chatId, COMMANDS_BROWSE);
      const keyboard = projectsKeyboard(groupSessionsByProject(sessions));
      for (let i = 0; i < chunks.length; i += 1) {
        const tail = chunks.length > 1 && i < chunks.length - 1 ? `\n\n(${i + 1}/${chunks.length})` : '';
        await sendPlain(config, chatId, `${chunks[i]}${tail}`, i === chunks.length - 1 ? keyboard : undefined);
      }
      return;
    }
    case '/project': {
      const sessions = await listSessions(await server());
      const groups = groupSessionsByProject(sessions);
      if (groups.length === 0) {
        await send(config, chatId, 'No sessions.');
        return;
      }
      const wanted = Number.parseInt(argument, 10);
      let entry;
      if (Number.isInteger(wanted) && wanted >= 1 && wanted <= groups.length) {
        entry = groups[wanted - 1];
      } else if (argument !== '') {
        const needle = argument.toLowerCase();
        entry = groups.find(([project]) => project.toLowerCase().includes(needle));
      }
      if (entry === undefined) {
        await send(config, chatId, 'Use /sessions first, then /project <n> or /project <name>.');
        return;
      }
      const [projectName_, list] = entry;
      state.view[chatId] = {
        project: projectName_,
        workspaceId: list[0]?.workspaceId ?? '',
        cwd: list[0]?.cwd ?? '',
        ids: list.map((session) => session.id),
      };
      await saveState();
      await setMenu(config, chatId, COMMANDS_BROWSE);
      const projectChunks = chunkText(projectReport(entry, chatId), 3800);
      const sessionKeyboard = sessionsKeyboard(list);
      for (let i = 0; i < projectChunks.length; i += 1) {
        const tail = projectChunks.length > 1 && i < projectChunks.length - 1 ? `\n\n(${i + 1}/${projectChunks.length})` : '';
        await sendPlain(config, chatId, `${projectChunks[i]}${tail}`, i === projectChunks.length - 1 ? sessionKeyboard : undefined);
      }
      return;
    }
    case '/new': {
      const view = state.view[chatId];
      const sessions = await listSessions(await server());
      const selected = sessions.find((session) => session.id === selectionFor(chatId));
      const workspaceId = view?.workspaceId || selected?.workspaceId || '';
      if (workspaceId === '') {
        await send(config, chatId, 'Open a project first: /sessions, then /project <n>.');
        return;
      }
      const title = argument === '' ? 'New session' : argument;
      try {
        const created = await api(await server(), 'POST', '/api/v1/sessions', { workspace_id: workspaceId, title });
        const id = typeof created?.id === 'string' ? created.id : '';
        if (id === '') throw new Error('the server did not return a session id');
        state.selection[chatId] = id;
        if (view !== undefined) view.ids = [id, ...view.ids];
        delete state.notified[chatId];
        await saveState();
        await setMenu(config, chatId, COMMANDS_SESSION);
        await send(config, chatId, `Created and selected: ${title}\n${id}`);
      } catch (error) {
        await send(config, chatId, `Could not create the session: ${error.message}`);
      }
      return;
    }
    case '/use': {
      const index = Number.parseInt(argument, 10);
      const view = state.view[chatId];
      if (view === undefined || view.ids.length === 0) {
        await send(config, chatId, 'Open a project first: /sessions, then /project <n>.');
        return;
      }
      const id = view.ids[index - 1];
      if (id === undefined) {
        await send(config, chatId, `Use a number from the open project (1-${String(view.ids.length)}).`);
        return;
      }
      const sessions = await listSessions(await server());
      const picked = sessions.find((session) => session.id === id);
      state.selection[chatId] = id;
      delete state.notified[chatId];
      await rememberNewestTurn(chatId, id);
      await saveState();
      await setMenu(config, chatId, COMMANDS_SESSION);
      await send(config, chatId, `Selected: ${picked === undefined ? id : picked.title}`);
      return;
    }
    case '/current': {
      const sessionId = selectionFor(chatId);
      await send(config, chatId, `session: ${sessionId ?? 'none'}\noverrides: ${describeOverrides(chatId)}`);
      return;
    }
    case '/notify': {
      const mode = argument.toLowerCase();
      if (mode !== 'on' && mode !== 'off') {
        await send(config, chatId, 'Use /notify on or /notify off.');
        return;
      }
      state.notify[chatId] = mode === 'on';
      await saveState();
      await send(config, chatId, `Finish reports ${mode === 'on' ? 'on' : 'off'}.`);
      return;
    }
    case '/last': {
      const sessionId = selectionFor(chatId);
      if (sessionId === undefined) {
        await send(config, chatId, 'No session selected.');
        return;
      }
      try {
        const reply = await lastReply(await server(), sessionId);
        await send(config, chatId, reply === undefined ? 'No assistant reply yet.' : reply.slice(0, 3500));
      } catch (error) {
        await send(config, chatId, `Could not read the reply: ${error.message}`);
      }
      return;
    }
    case '/stop': {
      const sessionId = selectionFor(chatId);
      if (sessionId === undefined) {
        await send(config, chatId, 'No session selected.');
        return;
      }
      try {
        await api(await server(), 'POST', `/api/v1/sessions/${encodeURIComponent(sessionId)}/prompts/cancel`, {});
        await send(config, chatId, 'Cancel requested.');
      } catch (error) {
        await send(config, chatId, `Cancel failed: ${error.message}`);
      }
      return;
    }
    case '/model':
    case '/profile':
    case '/thinking':
    case '/permission':
    case '/plan': {
      const key = { '/model': 'model', '/profile': 'profile', '/thinking': 'thinking', '/permission': 'permission_mode', '/plan': 'plan_mode' }[command];
      const overrides = overridesFor(chatId);
      if (argument === '' ) {
        await send(config, chatId, `${key} = ${overrides[key] ?? 'default'}`);
        return;
      }
      if (argument === 'clear') {
        delete overrides[key];
      } else if (key === 'plan_mode') {
        overrides[key] = argument === 'on' || argument === 'true';
      } else {
        overrides[key] = argument;
      }
      await saveState();
      await send(config, chatId, `${key} = ${overrides[key] ?? 'default'}`);
      return;
    }
    case '/provider': {
      const models = await modelCatalog(await server());
      const counts = providerCounts(models);
      if (counts.length === 0) {
        await send(config, chatId, 'No models are configured.');
        return;
      }
      if (argument === '') {
        const lines = counts.slice(0, 30).map(([name, count], index) => `${index + 1}. ${name} — ${count} models`);
        lines.push('', 'Pick one with /provider <n|name>, then /models.');
        await send(config, chatId, lines.join('\n'));
        return;
      }
      const wanted = Number.parseInt(argument, 10);
      const picked =
        Number.isInteger(wanted) && wanted >= 1 && wanted <= counts.length
          ? counts[wanted - 1][0]
          : counts.map(([name]) => name).find((name) => name.toLowerCase().includes(argument.toLowerCase()));
      if (picked === undefined) {
        await send(config, chatId, 'Unknown provider. Run /provider for the list.');
        return;
      }
      state.provider[chatId] = picked;
      delete state.models[chatId];
      await saveState();
      await send(config, chatId, `Provider: ${picked}\nPick a model with /models.`);
      return;
    }
    case '/usage': {
      const sessionId = selectionFor(chatId);
      if (sessionId === undefined) {
        await send(config, chatId, 'No session selected.');
        return;
      }
      await send(config, chatId, await usageReport(await server(), sessionId));
      return;
    }
    case '/diff': {
      const sessionId = selectionFor(chatId);
      const sessions = await listSessions(await server());
      const picked = sessions.find((session) => session.id === sessionId);
      await send(config, chatId, await diffReport(picked?.cwd ?? ''));
      return;
    }
    case '/files': {
      const sessionId = selectionFor(chatId);
      if (sessionId === undefined) {
        await send(config, chatId, 'No session selected.');
        return;
      }
      await send(config, chatId, await filesReport(await server(), sessionId));
      return;
    }
    case '/settings':
    case '/models': {
      const models = await modelCatalog(await server());
      const provider = state.provider[chatId];
      const scoped = provider === undefined ? models : models.filter((model) => model.provider === provider);
      if (scoped.length === 0) {
        await send(config, chatId, provider === undefined ? 'No models are configured.' : `No models for ${provider}. Run /provider to switch.`);
        return;
      }
      if (argument === '') {
        const shown = scoped.slice(0, 30);
        state.models[chatId] = shown.map((model) => model.model);
        await saveState();
        const lines = shown.map((model, index) => `${index + 1}. ${modelLabel(model)}`);
        lines.push('', provider === undefined ? 'Pick with /models <n>, or narrow first with /provider.' : `Provider ${provider} · pick with /models <n>.`);
        await sendPlain(config, chatId, lines.join('\n'), modelsKeyboard(shown));
        return;
      }
      const wanted = Number.parseInt(argument, 10);
      let picked;
      if (Number.isInteger(wanted) && wanted >= 1) {
        const id = (state.models[chatId] ?? [])[wanted - 1];
        picked = scoped.find((model) => model.model === id) ?? scoped[wanted - 1];
      } else {
        picked =
          scoped.find((model) => model.model === argument) ??
          scoped.find((model) => typeof model.display_name === 'string' && model.display_name.toLowerCase().includes(argument.toLowerCase()));
      }
      if (picked === undefined) {
        await send(config, chatId, 'Unknown model. Run /models for the list.');
        return;
      }
      overridesFor(chatId).model = picked.model;
      await saveState();
      await send(config, chatId, `Model for the next prompt: ${modelLabel(picked)}`);
      return;
    }
    default:
      await send(config, chatId, `Unknown command ${command}.\n\n${HELP}`);
  }
}

// The pid and heartbeat let a reader (the Connectors settings page) tell a
// live bridge from a file left behind by a crashed one.
async function saveState() {
  await writeJson(STATE_PATH, { ...state, pid: process.pid, heartbeatAt: Date.now() });
}

async function main() {
  const config = await loadConfig();
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  const saved = await readJson(STATE_PATH, undefined);
  if (saved !== undefined) {
    state.offset = saved.offset ?? 0;
    state.selection = saved.selection ?? {};
    state.overrides = saved.overrides ?? {};
    state.notify = saved.notify ?? {};
    state.notified = saved.notified ?? {};
    state.view = saved.view ?? {};
    state.provider = saved.provider ?? {};
    state.models = saved.models ?? {};
    state.interactions = normalizeInteractions(saved.interactions);
    state.pendingQuestion = saved.pendingQuestion ?? {};
    state.progress = saved.progress ?? {};
    state.profilePhotoHash = saved.profilePhotoHash;
  }
  const info = await waitForServer();
  await saveState();
  log(`connected to ${info.baseUrl} (omnicode ${info.version ?? '?'})`);
  log(config.allowedChatIds.length === 0
    ? 'no allowedChatIds yet — message the bot to learn your chat id, add it, then restart'
    : `serving ${config.allowedChatIds.length} allowed chat(s)`);
  await applyBotProfile(config);
  for (const [chatId, sessionId] of Object.entries(state.selection)) {
    if (typeof sessionId === 'string' && sessionId !== '') {
      await setMenu(config, Number(chatId), COMMANDS_SESSION);
    }
  }
  await primeReports();
  await watchServer(config);
  setInterval(() => {
    pollInteractions(config).catch((error) => log(`interaction poll failed: ${error.message}`));
  }, NOTIFY_INTERVAL_MS);
  setInterval(() => {
    watchServer(config).catch((error) => log(`connection watch failed: ${error.message}`));
  }, 10000);
  setInterval(() => {
    reportFinishedTurns(config).catch((error) => log(`finish report failed: ${error.message}`));
  }, NOTIFY_INTERVAL_MS);

  let backoffMs = 3000;
  for (;;) {
    let updates;
    try {
      updates = await tg(config, 'getUpdates', { offset: state.offset, timeout: POLL_TIMEOUT_S, allowed_updates: ['message', 'callback_query'] });
      backoffMs = 3000;
    } catch (error) {
      log(`poll failed: ${error.message}; retrying in ${Math.round(backoffMs / 1000)}s`);
      await new Promise((resolve) => {
        setTimeout(resolve, backoffMs);
      });
      backoffMs = Math.min(backoffMs * 2, 30000);
      continue;
    }
    for (const update of updates) {
      state.offset = update.update_id + 1;
      try {
        if (update.callback_query !== undefined) {
          await handleCallback(config, update.callback_query);
          continue;
        }
        const message = update.message;
        if (message === undefined) continue;
        if (typeof message.text !== 'string') {
          const chatIdForMedia = message.chat?.id;
          if (typeof chatIdForMedia === 'number' && config.allowedChatIds.includes(chatIdForMedia)) {
            if (Array.isArray(message.photo) || message.document !== undefined) {
              try {
                await handleMedia(config, chatIdForMedia, message);
              } catch (error) {
                await send(config, chatIdForMedia, `Could not send that image: ${error.message}`);
              }
            }
          }
          continue;
        }
        const chatId = message.chat.id;
        if (!config.allowedChatIds.includes(chatId)) {
          await send(config, chatId, `This chat is not allowed to control Omnicode.\nYour chat id: ${chatId}\nAdd it to allowedChatIds in ${CONFIG_PATH} and restart the bot.`);
          continue;
        }
        try {
          await handle(config, chatId, message.text);
        } catch (error) {
          await send(config, chatId, `Error: ${error.message}`);
        }
      } catch (error) {
        log(`update ${String(update.update_id)} failed: ${error.message}`);
      }
    }
    await saveState();
  }
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

export { api, discoverServer, listSessions, lastReply, handle, loadConfig, state, tg, statusReport, summarizeTurn, projectsReport, projectReport, groupSessionsByProject, markdownToHtml, modelCatalog, providerCounts, modelLabel, server, approvalText, approvalKeyboard, questionText, questionKeyboard, pendingApprovals, pendingQuestions, projectsKeyboard, sessionsKeyboard, modelsKeyboard, usageReport, diffReport, filesReport, formatDuration, chunkText, progressLine, handleCallback, imagePartOf, handleMedia, deliverReport };

if (isEntryPoint) {
  main().catch((error) => {
    log(`fatal: ${error.message}`);
    process.exit(1);
  });
}
