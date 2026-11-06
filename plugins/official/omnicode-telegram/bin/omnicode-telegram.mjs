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

import { readFile, writeFile, mkdir, readdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir, tmpdir } from 'node:os';
import { setDefaultResultOrder } from 'node:dns';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HOME = process.env.OMNICODE_HOME ?? path.join(homedir(), '.omnicode');
const CONFIG_PATH = path.join(HOME, 'telegram.json');
const STATE_PATH = path.join(HOME, 'telegram-state.json');
const LOCK_PATH = path.join(HOME, 'telegram-bridge.lock');
const LOCK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const INSTANCES_DIR = path.join(HOME, 'server', 'instances');
const TOKEN_PATH = path.join(HOME, 'server.token');
const POLL_TIMEOUT_S = 10;

// Telegram resolves to IPv6 on some machines whose IPv6 route is broken, which shows
// up as repeated "fetch failed" long-poll errors. Prefer IPv4 for every request.
setDefaultResultOrder('ipv4first');
const SESSIONS_PAGE = 100;

const state = { offset: 0, selection: {}, overrides: {}, notify: {}, notified: {}, view: {}, provider: {}, models: {}, interactions: {}, pendingQuestion: {}, progress: {}, sent: {}, incoming: {}, clearHinted: {}, watching: {}, otherNotified: {}, others: {}, header: {}, renameDisabled: undefined, botName: undefined, nameRetryAt: undefined, profilePhotoHash: undefined };

const recentLog = [];

function log(message) {
  const line = `[omnicode-telegram] ${message}`;
  process.stdout.write(`${line}\n`);
  recentLog.push(line);
  if (recentLog.length > 20) recentLog.shift();
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
  const temp = `${file}.${String(process.pid)}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, file);
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

let apiTransport;

function setApiTransport(next) {
  apiTransport = next ?? undefined;
}

function api(server, method, route, body) {
  if (apiTransport !== undefined) return apiTransport(server, method, route, body);
  return apiReal(server, method, route, body);
}

async function apiReal(server, method, route, body) {
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
  const data = await api(server, 'GET', `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages?page_size=20&role=assistant`);
  const items = Array.isArray(data?.items) ? data.items : [];
  for (const message of items) {
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

const PAGE_SIZE = 5;

function pageFromArgument(argument) {
  const parsed = Number.parseInt(argument, 10);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

function pageSlice(list, page) {
  const total = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const safe = Math.min(Math.max(1, page), total);
  const start = (safe - 1) * PAGE_SIZE;
  return { items: list.slice(start, start + PAGE_SIZE), start, total, page: safe };
}

function pageNavRows(slice, buildCommand) {
  const rows = [];
  const nav = [];
  if (slice.page > 1) nav.push(commandButton('‹ Back', buildCommand(slice.page - 1)));
  if (slice.page < slice.total) nav.push(commandButton(`▸ More (${String(slice.total - slice.page)} left)`, buildCommand(slice.page + 1)));
  if (nav.length > 0) rows.push(nav);
  return rows;
}

function projectsKeyboard(groups, page = 1) {
  const slice = pageSlice(groups, page);
  const buttons = slice.items.map(([project], offset) => commandButton(project, `/project ${slice.start + offset + 1}`));
  const rows = chunkRows(buttons, 2).concat(pageNavRows(slice, (next) => `/sessions ${String(next)}`));
  return rows.length === 0 ? undefined : { inline_keyboard: rows };
}

function sessionsKeyboard(list, page = 1, projectIndex = 1) {
  const slice = pageSlice(list, page);
  const buttons = slice.items.map((session) => ({
    text: String(session.title).slice(0, 60),
    callback_data: `use|${shortId('go', String(session.id))}`,
  }));
  const rows = chunkRows(buttons, 2)
    .concat(pageNavRows(slice, (next) => `/project ${String(projectIndex)} ${String(next)}`));
  return rows.length === 0 ? undefined : { inline_keyboard: rows };
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

function projectsReport(sessions, chatId, page = 1) {
  const groups = groupSessionsByProject(sessions);
  const slice = pageSlice(groups, page);
  const pageNote = slice.total > 1 ? ` · page ${String(slice.page)}/${String(slice.total)}` : '';
  const lines = [`Projects (${groups.length}) · ${sessions.length} sessions${pageNote}`, ''];
  slice.items.forEach(([project, list], offset) => {
    const running = list.filter((session) => session.status === 'running').length;
    const selected = list.some((session) => session.id === selectionFor(chatId)) ? ' ← selected' : '';
    const activity = running === 0 ? '' : ` · ${running} running`;
    lines.push(`${slice.start + offset + 1}. ${project} — ${list.length}${activity}${selected}`);
  });
  if (slice.total > 1) lines.push('', 'Tap ▸ More for the next projects.');
  lines.push('', 'Open a project with /project <n>.');
  return lines.join('\n');
}

function projectReport(entry, chatId, page = 1) {
  const [project, list] = entry;
  const slice = pageSlice(list, page);
  const pageNote = slice.total > 1 ? ` · page ${String(slice.page)}/${String(slice.total)}` : '';
  const lines = [`${project} — ${list.length} sessions${pageNote}`];
  const cwd = list[0]?.cwd ?? '';
  if (cwd !== '') lines.push(cwd);
  lines.push('');
  slice.items.forEach((session, offset) => {
    lines.push(`${slice.start + offset + 1}. ${session.title}${sessionMarks(session, chatId)}`);
  });
  if (slice.total > 1) lines.push('', 'Tap ▸ More for the next sessions.');
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

const CALLBACK_LIMIT_BYTES = 64;

function idPrefix(kind) {
  if (kind === 'apv') return 'approval_';
  if (kind === 'q') return 'question_';
  if (kind === 'go') return 'session_';
  return '';
}

function shortId(kind, id) {
  const prefix = idPrefix(kind);
  return prefix !== '' && id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

function longId(kind, id) {
  const prefix = idPrefix(kind);
  return prefix !== '' && !id.startsWith(prefix) ? `${prefix}${id}` : id;
}

function usableRows(rows) {
  const kept = [];
  for (const row of rows) {
    const button = row[0];
    if (typeof button?.callback_data === 'string' && Buffer.byteLength(button.callback_data, 'utf8') > CALLBACK_LIMIT_BYTES) {
      log(`button dropped: callback_data is ${String(Buffer.byteLength(button.callback_data, 'utf8'))} bytes (limit ${String(CALLBACK_LIMIT_BYTES)})`);
      continue;
    }
    kept.push(row);
  }
  return kept;
}

function approvalKeyboard(approval) {
  const id = shortId('apv', String(approval.approval_id));
  const rows = usableRows([
    [
      { text: '✅ Allow', callback_data: `apv|${id}|approved` },
      { text: '⛔ Deny', callback_data: `apv|${id}|rejected` },
    ],
    [{ text: '♾ Allow for this session', callback_data: `apv|${id}|approved|session` }],
  ]);
  return rows.length === 0 ? undefined : { inline_keyboard: rows };
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
  const items = question.questions ?? [];
  // buttons may only answer a single-item, single-choice question: one press resolves the
  // whole interaction, so a multi-item prompt would lose every item not tapped
  if (items.length !== 1 || items[0].multi_select === true) return undefined;
  const rows = [];
  const questionId = shortId('q', String(question.question_id));
  for (const item of items) {
    for (const option of item.options ?? []) {
      rows.push([{ text: String(option.label).slice(0, 60), callback_data: `q|${questionId}|${String(item.id)}|${String(option.id)}` }]);
    }
  }
  const kept = usableRows(rows).slice(0, 8);
  return kept.length === 0 ? undefined : { inline_keyboard: kept };
}

async function announcePending(config, chatId, sessionId, approvals, questions) {
  const seen = new Map(Object.entries(state.interactions[chatId] ?? {}));
  let chatChanged = false;
  for (const approval of approvals) {
    if (typeof approval.approval_id !== 'string' || seen.has(approval.approval_id)) continue;
    try {
      await tg(config, 'sendMessage', {
        chat_id: Number(chatId),
        text: approvalText(approval),
        reply_markup: approvalKeyboard(approval),
        disable_web_page_preview: true,
      });
      seen.set(approval.approval_id, sessionId);
      chatChanged = true;
    } catch (error) {
      log(`approval notice failed, will retry: ${error.message}`);
    }
  }
  for (const question of questions) {
    if (typeof question.question_id !== 'string' || seen.has(question.question_id)) continue;
    const keyboard = questionKeyboard(question);
    try {
      await tg(config, 'sendMessage', {
        chat_id: Number(chatId),
        text: questionText(question),
        ...(keyboard === undefined ? undefined : { reply_markup: keyboard }),
        disable_web_page_preview: true,
      });
      seen.set(question.question_id, sessionId);
      state.pendingQuestion[chatId] = {
        questionId: question.question_id,
        sessionId,
        questions: question.questions ?? [],
      };
      chatChanged = true;
    } catch (error) {
      log(`question notice failed, will retry: ${error.message}`);
    }
  }
  const live = new Set([...approvals.map((approval) => approval.approval_id), ...questions.map((question) => question.question_id)]);
  const kept = Object.fromEntries([...seen].filter(([id]) => live.has(id)));
  if (Object.keys(kept).length !== seen.size) chatChanged = true;
  if (chatChanged) state.interactions[chatId] = kept;
  return chatChanged;
}

async function refreshPending(config, chatId, sessionId) {
  const info = await server();
  let approvals;
  let questions;
  try {
    approvals = await pendingApprovals(info, sessionId);
    questions = await pendingQuestions(info, sessionId);
  } catch (error) {
    log(`pending fetch failed: ${describeError(error)}`);
    return;
  }
  log(`pending for ${sessionId}: ${String(approvals.length)} approval(s), ${String(questions.length)} question(s)`);
  if (await announcePending(config, chatId, sessionId, approvals, questions)) await saveState();
}

async function pollInteractions(config) {
  const info = await server();
  const watchersBySession = new Map();
  for (const chatId of Object.keys(state.selection)) {
    const sessionId = state.selection[chatId];
    if (typeof sessionId !== 'string' || sessionId === '') continue;
    if (!watchersBySession.has(sessionId)) watchersBySession.set(sessionId, new Set());
    watchersBySession.get(sessionId).add(chatId);
  }
  const ownersBySession = new Map();
  for (const chatId of Object.keys(state.pendingQuestion)) {
    const entry = state.pendingQuestion[chatId];
    if (typeof entry?.sessionId !== 'string' || entry.sessionId === '') continue;
    if (!ownersBySession.has(entry.sessionId)) ownersBySession.set(entry.sessionId, new Set());
    ownersBySession.get(entry.sessionId).add(chatId);
  }
  let changed = false;
  const sessions = new Set([...watchersBySession.keys(), ...ownersBySession.keys()]);
  for (const sessionId of sessions) {
    let approvals;
    let questions;
    try {
      approvals = await pendingApprovals(info, sessionId);
      questions = await pendingQuestions(info, sessionId);
    } catch {
      continue;
    }
    const liveQuestions = new Set(questions.map((question) => question.question_id));
    for (const chatId of ownersBySession.get(sessionId) ?? []) {
      const entry = state.pendingQuestion[chatId];
      if (entry !== undefined && !liveQuestions.has(entry.questionId)) {
        delete state.pendingQuestion[chatId];
        changed = true;
      }
    }
    const watchers = watchersBySession.get(sessionId);
    if (watchers === undefined) continue;
    for (const chatId of watchers) {
      if (await announcePending(config, chatId, sessionId, approvals, questions)) changed = true;
    }
  }
  if (changed) await saveState();
}

async function handleCallback(config, query) {
  const chatId = query?.message?.chat?.id;
  if (typeof chatId !== 'number' || !config.allowedChatIds.includes(chatId)) {
    log(`ignored a callback press from chat ${String(chatId)} — not in allowedChatIds`);
    return;
  }
  const messageId = query?.message?.message_id;
  const parts = typeof query?.data === 'string' ? query.data.split('|') : [];
  const kind = parts[0];
  const id = parts[1] === undefined ? undefined : longId(kind, parts[1]);
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
    if (kind === 'go' || kind === 'use') {
      const sessions = await listSessions(await server());
      const target = sessions.find((session) => session.id === id);
      if (target === undefined) throw new Error('that session is gone');
      state.selection[chatId] = target.id;
      delete state.notified[chatId];
      await rememberNewestTurn(chatId, target.id);
      await saveState();
      await setMenu(config, chatId, COMMANDS_SESSION);
      await syncChatOnSelection(config, chatId, target.id);
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
      const verb = decision === 'approved' ? 'Allowed' : 'Denied';
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
  const parts = pending.questions ?? [];
  const item = parts[0];
  if (parts.length !== 1 || item === undefined) {
    const listed = parts
      .slice(0, 4)
      .map((part, index) => `${String(index + 1)}. ${String(part.question ?? '').slice(0, 70)}`)
      .join('\n');
    await send(
      config,
      chatId,
      `That question has ${String(parts.length)} parts, so it needs the app:\n\n${listed}\n\nAnswer it there, or tap a button above if it has one.`,
    );
    return 'refused';
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
    return 'answered';
  } catch (error) {
    if (/not found|404|already resolved|409|no longer/i.test(String(error?.message))) {
      delete state.pendingQuestion[chatId];
      await saveState();
      log(`question ${pending.questionId} is gone: ${error.message}`);
      return 'gone';
    }
    await send(
      config,
      chatId,
      `Could not reach OmniCode to answer that (${error.message}). The question is still open — send your answer again.`,
    );
    return 'retry';
  }
}

const MAX_IMAGE_BYTES = 10_000_000;
const MAX_VIDEO_BYTES = 20_000_000;
const MAX_VIDEO_FRAMES = 6;

const FFMPEG_BINARY = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

function ffmpegCandidates() {
  const exeDir = path.dirname(process.execPath);
  const candidates = [
    process.env.OMNICODE_FFMPEG,
    process.env.OMNICODE_RESOURCES === undefined ? undefined : path.join(process.env.OMNICODE_RESOURCES, 'ffmpeg', FFMPEG_BINARY),
    path.join(exeDir, 'resources', 'ffmpeg', FFMPEG_BINARY),
    path.join(exeDir, '..', 'resources', 'ffmpeg', FFMPEG_BINARY),
    '/opt/Omnicode/resources/ffmpeg/ffmpeg',
  ];
  for (const dir of String(process.env.PATH ?? '').split(path.delimiter)) {
    if (dir !== '') candidates.push(path.join(dir, FFMPEG_BINARY));
  }
  return candidates;
}

const run = promisify(execFile);

function findFfmpeg() {
  for (const candidate of ffmpegCandidates()) {
    if (typeof candidate === 'string' && candidate !== '' && existsSync(candidate)) return candidate;
  }
  return undefined;
}

async function probeDurationSeconds(ffmpeg, input) {
  try {
    await run(ffmpeg, ['-i', input]);
    return undefined;
  } catch (error) {
    const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(String(error?.stderr ?? error?.message ?? ''));
    if (match === null) return undefined;
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  }
}

async function videoFrames(bytes, name) {
  const ffmpeg = findFfmpeg();
  if (ffmpeg === undefined) {
    return { frames: [], reason: `ffmpeg is not installed — looked for ${ffmpegCandidates().filter((entry) => typeof entry === 'string').slice(0, 4).join(', ')}` };
  }
  const dir = await mkdtemp(path.join(tmpdir(), 'omnicode-telegram-'));
  try {
    const input = path.join(dir, `input-${name.replaceAll(/[^\w.-]+/g, '_')}`);
    await writeFile(input, bytes);
    const duration = await probeDurationSeconds(ffmpeg, input);
    const stamps = [];
    if (duration !== undefined && duration > 0.5) {
      const window = duration / (MAX_VIDEO_FRAMES + 1);
      for (let index = 1; index <= MAX_VIDEO_FRAMES; index += 1) stamps.push(window * index);
    } else {
      stamps.push(0.2);
    }
    const frames = [];
    for (const [index, stamp] of stamps.entries()) {
      const out = path.join(dir, `frame-${String(index).padStart(2, '0')}.jpg`);
      try {
        await run(ffmpeg, ['-y', '-loglevel', 'error', '-ss', String(Math.max(0, stamp)), '-i', input, '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '4', out]);
        frames.push(await readFile(out));
      } catch (error) {
        log(`video frame at ${String(Math.round(stamp))}s skipped: ${String(error?.message ?? '')}`);
      }
    }
    return { frames, covered: duration, reason: frames.length === 0 ? 'ffmpeg could not decode a frame from this video' : '' };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function promptOverrides(chatId) {
  const overrides = overridesFor(chatId);
  const body = {};
  for (const key of ['model', 'profile', 'thinking', 'permission_mode']) {
    if (overrides[key] !== undefined) body[key] = overrides[key];
  }
  if (overrides.plan_mode !== undefined) body.plan_mode = overrides.plan_mode === true || overrides.plan_mode === 'true';
  return body;
}

async function downloadTelegramFile(config, fileId, limitBytes) {
  const file = await tg(config, 'getFile', { file_id: fileId });
  const size = typeof file?.file_size === 'number' ? file.file_size : undefined;
  if (limitBytes !== undefined && size !== undefined && size > limitBytes) {
    throw new Error(`the file is ${(size / 1_000_000).toFixed(1)} MB; the limit is ${String(Math.round(limitBytes / 1_000_000))} MB`);
  }
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

function videoPartOf(message) {
  const clip = message.video ?? message.animation ?? message.video_note;
  if (clip !== undefined && typeof clip.file_id === 'string') {
    return {
      fileId: clip.file_id,
      mediaType: typeof clip.mime_type === 'string' ? clip.mime_type : 'video/mp4',
      name: typeof clip.file_name === 'string' ? clip.file_name : 'telegram-video.mp4',
    };
  }
  const document = message.document;
  if (document === undefined || typeof document.file_id !== 'string') return undefined;
  const mime = typeof document.mime_type === 'string' ? document.mime_type : '';
  if (!mime.startsWith('video/')) return undefined;
  return { fileId: document.file_id, mediaType: mime, name: typeof document.file_name === 'string' ? document.file_name : 'telegram-video.mp4' };
}

function captionOf(message, fallback) {
  return typeof message.caption === 'string' && message.caption.trim() !== '' ? message.caption.trim() : fallback;
}

async function handleMedia(config, chatId, message) {
  const sessionId = selectionFor(chatId);
  if (sessionId === undefined) {
    await send(config, chatId, 'No session selected. Use /sessions then /use <n>.');
    return;
  }
  const image = imagePartOf(message);
  if (image !== undefined) {
    const bytes = await downloadTelegramFile(config, image.fileId, MAX_IMAGE_BYTES);
    if (bytes.length > MAX_IMAGE_BYTES) {
      await send(config, chatId, `That image is ${(bytes.length / 1_000_000).toFixed(1)} MB; the limit is ${String(MAX_IMAGE_BYTES / 1_000_000)} MB.`);
      return;
    }
    const body = {
      content: [
        { type: 'image', source: { kind: 'base64', media_type: image.mediaType, data: bytes.toString('base64'), name: image.name } },
        { type: 'text', text: captionOf(message, 'Please look at this image.') },
      ],
      ...promptOverrides(chatId),
    };
    await api(await server(), 'POST', `/api/v1/sessions/${encodeURIComponent(sessionId)}/prompts`, body);
    await send(config, chatId, `Sent ${image.name} to the session.`);
    return;
  }
  const video = videoPartOf(message);
  if (video === undefined) {
    await send(config, chatId, 'Only images and videos are supported here — send a photo, an image file, or a video.');
    return;
  }
  const bytes = await downloadTelegramFile(config, video.fileId, MAX_VIDEO_BYTES);
  if (bytes.length > MAX_VIDEO_BYTES) {
    await send(
      config,
      chatId,
      `That video is ${(bytes.length / 1_000_000).toFixed(1)} MB; Telegram lets a bot download at most ${String(MAX_VIDEO_BYTES / 1_000_000)} MB.`,
    );
    return;
  }
  const { frames, reason, covered } = await videoFrames(bytes, video.name);
  if (frames.length === 0) {
    await send(
      config,
      chatId,
      `Could not read that video: ${reason}\nSet OMNICODE_FFMPEG to a working ffmpeg binary to enable video.`,
    );
    return;
  }
  const parts = frames.map((frame, index) => ({
    type: 'image',
    source: { kind: 'base64', media_type: 'image/jpeg', data: frame.toString('base64'), name: `frame-${String(index + 1).padStart(2, '0')}.jpg` },
  }));
  const window = typeof covered === 'number' && covered > 0
    ? `covering the whole ${formatDuration(Math.round(covered * 1000))} clip`
    : 'from the start of the clip';
  parts.push({
    type: 'text',
    text: `${captionOf(message, 'Please look at this video.')}\n\n(${String(frames.length)} still frames from "${video.name}", ${window})`,
  });
  await api(await server(), 'POST', `/api/v1/sessions/${encodeURIComponent(sessionId)}/prompts`, { content: parts, ...promptOverrides(chatId) });
  await send(config, chatId, `Sent ${String(frames.length)} frames from ${video.name} to the session.`);
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

const SENDING_METHODS = new Set(['sendMessage', 'sendDocument']);
const MAX_TRACKED_MESSAGES = 1000;

let saveQueued = false;

function scheduleStateSave() {
  if (saveQueued) return;
  saveQueued = true;
  setTimeout(() => {
    saveQueued = false;
    void saveState().catch(() => undefined);
  }, 2000);
}

function rememberSent(chatId, messageId) {
  const list = state.sent[chatId] ?? [];
  list.push(messageId);
  state.sent[chatId] = list.slice(-MAX_TRACKED_MESSAGES);
  scheduleStateSave();
}

function forgetSent(chatId, messageId) {
  const list = state.sent[chatId];
  if (list === undefined) return;
  state.sent[chatId] = list.filter((id) => id !== messageId);
}

function rememberIncoming(chatId, messageId) {
  if (typeof messageId !== 'number') return;
  const list = state.incoming[chatId] ?? [];
  if (list.includes(messageId)) return;
  list.push(messageId);
  state.incoming[chatId] = list.slice(-MAX_TRACKED_MESSAGES);
  scheduleStateSave();
}

async function deleteMessages(config, chatId, ids) {
  let removed = 0;
  let stale = 0;
  const unique = [...new Set(ids)];
  for (const messageId of unique) {
    try {
      await tg(config, 'deleteMessage', { chat_id: chatId, message_id: messageId });
      removed += 1;
    } catch (error) {
      stale += 1;
      log(`message ${String(messageId)} not deleted: ${error.message}`);
    }
  }
  return { removed, stale, known: unique.length };
}

async function clearChatHistory(config, chatId) {
  const sent = state.sent[chatId] ?? [];
  const incoming = state.incoming[chatId] ?? [];
  const result = await deleteMessages(config, chatId, [...sent, ...incoming]);
  state.sent[chatId] = [];
  state.incoming[chatId] = [];
  state.interactions[chatId] = {};
  delete state.progress[chatId];
  delete state.header[chatId];
  delete state.pendingQuestion[chatId];
  await saveState();
  return result;
}

async function pinMessage(config, chatId, messageId) {
  await tg(config, 'unpinAllChatMessages', { chat_id: chatId }).catch(() => undefined);
  try {
    await tg(config, 'pinChatMessage', { chat_id: chatId, message_id: messageId, disable_notification: true });
    return true;
  } catch (error) {
    log(`pin failed: ${error.message}`);
    return false;
  }
}

function purgeUpperBound(knownIds) {
  const highest = knownIds.length === 0 ? 0 : Math.max(...knownIds);
  return highest === 0 ? 500 : highest + 100;
}

const headerStatus = new Map();

function statusWord(status) {
  if (status === 'running') return '⏳ working';
  if (status === 'approval') return '🔐 waiting for approval';
  if (status === 'question') return '❓ waiting for an answer';
  if (status === 'failed') return '⚠️ last turn failed';
  return '✅ idle';
}

function sessionHeaderText(meta, sessionId, status) {
  const project = typeof meta?.project === 'string' && meta.project !== '' ? meta.project : 'no project';
  const title = typeof meta?.title === 'string' && meta.title !== '' ? meta.title : 'untitled';
  return `📌 ${project} · ${title}\n${String(sessionId)}\n${statusWord(status)}`;
}

async function refreshHeader(config, chatId, sessionId, status) {
  const info = await server();
  const sessions = await listSessions(info).catch(() => []);
  const meta = sessions.find((session) => session.id === sessionId);
  const waiting = meta?.status === 'approval' || meta?.status === 'question' ? meta.status : undefined;
  const effective = waiting ?? status ?? meta?.status ?? '';
  const text = sessionHeaderText(meta, sessionId, effective);
  headerStatus.set(String(chatId), effective);
  const existing = state.header[chatId];
  if (typeof existing === 'number') {
    try {
      await tg(config, 'editMessageText', { chat_id: Number(chatId), message_id: existing, text, disable_web_page_preview: true });
      return existing;
    } catch (error) {
      if (/message is not modified/i.test(String(error?.message))) return existing;
      // otherwise the message is gone (the chat was cleared): post a fresh one below
    }
  }
  const sent = await send(config, Number(chatId), text);
  if (typeof sent?.message_id !== 'number') return undefined;
  state.header[chatId] = sent.message_id;
  await saveState();
  await pinMessage(config, chatId, sent.message_id);
  return sent.message_id;
}

async function purgeChat(config, chatId, note) {
  const known = [...(state.sent[chatId] ?? []), ...(state.incoming[chatId] ?? [])];
  const upper = purgeUpperBound(known);
  let removed = 0;
  const reasons = new Map();
  for (let messageId = 1; messageId <= upper; messageId += 1) {
    try {
      await tg(config, 'deleteMessage', { chat_id: chatId, message_id: messageId });
      removed += 1;
    } catch (error) {
      const reason = error.message.replace(/\d+/g, 'N');
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
    if (messageId % 25 === 0) {
      await note(`Purging… ${String(messageId)} of ${String(upper)} ids checked, ${String(removed)} deleted`);
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 40);
    });
  }
  for (const [reason, count] of reasons) log(`purge skipped ${String(count)} x ${reason}`);
  state.sent[chatId] = [];
  state.incoming[chatId] = [];
  state.interactions[chatId] = {};
  delete state.pendingQuestion[chatId];
  await saveState();
  return { removed, upper, skipped: [...reasons].map(([reason, count]) => `${String(count)} ${reason}`) };
}

function botNameFor(project, title) {
  const projectLabel = typeof project === 'string' ? project.trim() : '';
  const titleLabel = typeof title === 'string' ? title.trim() : '';
  const parts = [projectLabel, titleLabel].filter((part) => part !== '');
  const label = parts.length === 0 ? 'no session' : parts.join(' · ');
  const name = `OmniCode - ${label}`;
  return name.length <= 64 ? name : `${name.slice(0, 61)}...`;
}

function retryAfterMs(error) {
  const match = /retry after (\d+)/i.exec(String(error?.message ?? ''));
  return match === null ? 0 : Number(match[1]) * 1000;
}

async function applyBotName(config, sessionId) {
  const info = await server();
  const sessions = await listSessions(info).catch(() => []);
  const meta = sessions.find((session) => session.id === sessionId);
  const name = botNameFor(meta?.project ?? '', meta?.title ?? '');
  if (state.renameDisabled === true) return name;
  if (state.botName === name) return name;
  if (typeof state.nameRetryAt === 'number' && Date.now() < state.nameRetryAt) return name;
  try {
    await tg(config, 'setMyName', { name });
    state.botName = name;
    delete state.nameRetryAt;
    await saveState();
  } catch (error) {
    const wait = retryAfterMs(error);
    if (wait > 0) {
      state.nameRetryAt = Date.now() + wait;
      await saveState();
      log(`bot name is rate-limited for another ${String(Math.round(wait / 3600000))}h; keeping the current one`);
    } else {
      log(`bot name not changed: ${error.message}`);
    }
  }
  return name;
}

async function maybeRefreshName(config) {
  if (typeof state.nameRetryAt === 'number' && Date.now() < state.nameRetryAt) return;
  const sessionId = Object.values(state.selection).find((value) => typeof value === 'string' && value !== '');
  if (sessionId === undefined) return;
  const name = await applyBotName(config, sessionId);
  log(`bot name check: wanted "${name}", telegram holds "${String(state.botName)}"`);
}

async function sendLastReport(config, chatId, sessionId) {
  const info = await server();
  const data = await api(info, 'GET', `/api/v1/sessions/${encodeURIComponent(sessionId)}/transcript?agent_id=main&page_size=3`).catch(() => undefined);
  const turns = (Array.isArray(data?.items) ? data.items : []).filter((item) => item?.kind === 'turn');
  let reportId;
  const turn = turns.filter((item) => item.state === 'completed').at(-1);
  if (turn === undefined) {
    log(`no finished turn in ${sessionId}; nothing to report`);
  } else {
    const sessions = await listSessions(info).catch(() => []);
    const meta = sessions.find((session) => session.id === sessionId);
    try {
      const delivered = await deliverReport(config, chatId, turn, meta, undefined);
      reportId = delivered?.messageId;
    } catch (error) {
      log(`last report failed: ${error.message}`);
    }
  }
  const running = turns.find((item) => item.state === 'running');
  if (running !== undefined) await showProgress(config, chatId, running, undefined);
  return reportId;
}

async function syncChatOnSelection(config, chatId, sessionId) {
  let cleared = { removed: 0, stale: 0, known: 0 };
  try {
    cleared = await clearChatHistory(config, chatId);
  } catch (error) {
    log(`chat clear failed: ${error.message}`);
  }
  let name = '';
  try {
    name = await applyBotName(config, sessionId);
  } catch (error) {
    log(`rename failed: ${error.message}`);
  }
  log(
    `selection synced for ${String(chatId)} (cleared ${String(cleared.removed)} of ${String(cleared.known)} tracked, ${String(cleared.stale)} undeletable, name "${name}")`,
  );
  try {
    await refreshHeader(config, chatId, sessionId, undefined);
  } catch (error) {
    log(`header failed: ${describeError(error)}`);
  }
  try {
    await sendLastReport(config, chatId, sessionId);
  } catch (error) {
    log(`last report failed: ${error.message}`);
  }
  if (cleared.known === 0 && state.clearHinted[chatId] !== true) {
    state.clearHinted[chatId] = true;
    try {
      await send(
        config,
        chatId,
        'Tip: this chat still holds messages sent before the bridge started keeping their ids, and Telegram lets a bot delete only messages it tracked as it sent them. Clear this chat once from Telegram itself, and every switch will keep it clean from then on.',
      );
    } catch (error) {
      log(`clear tip failed: ${error.message}`);
    }
    await saveState();
  }
  try {
    await refreshPending(config, chatId, sessionId);
  } catch (error) {
    log(`pending refresh failed: ${describeError(error)}`);
  }
}

function describeError(error) {
  const cause = error?.cause;
  const code = cause?.code ?? cause?.errno;
  return code === undefined ? String(error?.message) : `${String(error?.message)} (${String(code)})`;
}

const NOTIFY_INTERVAL_MS = 3000;
const NAME_RETRY_INTERVAL_MS = 10 * 60 * 1000;
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

function latestCommentary(turn, limit = 500) {
  const last = finalTextOf(turn);
  if (last === undefined) return '';
  return last.length <= limit ? last : `${last.slice(0, limit - 1)}...`;
}

function progressLine(turn) {
  const started = typeof turn.startedAt === 'string' ? Date.parse(turn.startedAt) : Number.NaN;
  const elapsed = Number.isFinite(started) ? formatDuration(Date.now() - started) : '';
  const head = elapsed === '' ? '⏳ <b>Working</b>' : `⏳ <b>Working</b> · ${elapsed}`;
  const commentary = latestCommentary(turn);
  return commentary === '' ? head : `${head}\n\n${escapeHtml(commentary)}`;
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
  } catch (error) {
    // a throttled or rejected edit is harmless; the next tick tries again — unless the
    // message is gone (the chat was cleared), in which case drop it so a fresh progress
    // message is posted instead of editing a corpse forever
    if (/message to edit not found|message can't be edited/i.test(error.message)) {
      delete state.progress[chatId];
      await saveState().catch(() => undefined);
    }
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
  const messageId = payload.result?.message_id;
  if (typeof messageId === 'number') rememberSent(chatId, messageId);
  return messageId;
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
  await sendReportFile(config, chatId, head, body);
  return { via: 'document', messageId };
}

function otherFinishLine(turn, meta) {
  const project = typeof meta?.project === 'string' ? meta.project : '';
  const title = typeof meta?.title === 'string' ? meta.title : '';
  const label = [project, title].filter((part) => part !== '').join(' · ');
  const who = label === '' ? 'Another session' : label;
  const duration = typeof turn.durationMs === 'number' ? formatDuration(turn.durationMs) : '';
  const head = duration === '' ? `🔔 ${who} finished` : `🔔 ${who} — done in ${duration}`;
  const reply = (finalTextOf(turn) ?? '').split('\n').find((line) => line.trim() !== '') ?? '';
  const tail = reply === '' ? '' : `\n${reply.trim().slice(0, 160)}`;
  return `${head}${tail}`;
}

let otherChecks = false;
let otherCheckedAt = 0;
const OTHER_CHECK_MS = 5000;

async function reportOtherFinishedTurns(config) {
  if (otherChecks) return;
  if (Date.now() - otherCheckedAt < OTHER_CHECK_MS) return;
  otherChecks = true;
  otherCheckedAt = Date.now();
  try {
    const chats = Object.keys(state.selection).filter((chatId) => reportsEnabled(chatId) && state.others[chatId] !== false);
    if (chats.length === 0) return;
    const info = await server();
    const sessions = await listSessions(info).catch(() => []);
    let changed = false;
    for (const session of sessions) {
      const id = session.id;
      if (typeof id !== 'string' || id === '') continue;
      if (session.status === 'running') {
        if (state.watching[id] !== true) {
          state.watching[id] = true;
          changed = true;
        }
        continue;
      }
      if (state.watching[id] !== true) continue;
      delete state.watching[id];
      changed = true;
      const turn = await newestTurn(info, id).catch(() => undefined);
      if (turn === undefined || turn.state !== 'completed' || turn.turnId === state.otherNotified[id]) continue;
      state.otherNotified[id] = turn.turnId;
      changed = true;
      const line = otherFinishLine(turn, session);
      const keyboard = { inline_keyboard: [[{ text: 'Open this session', callback_data: `go|${shortId('go', id)}` }]] };
      for (const chatId of chats) {
        if (state.selection[chatId] === id) continue;
        await sendPlain(config, Number(chatId), line, keyboard).catch((error) => log(`other finish notice failed: ${error.message}`));
      }
    }
    if (changed) await saveState();
  } finally {
    otherChecks = false;
  }
}

async function reportFinishedTurns(config) {
  if (reporting) return;
  reporting = true;
  try {
    const info = await server();
    for (const chatId of Object.keys(state.selection)) {
      const sessionId = state.selection[chatId];
      if (typeof sessionId !== 'string') continue;
      let turn;
      try {
        turn = await newestTurn(info, sessionId);
      } catch {
        continue;
      }
      if (turn === undefined) continue;
      const effective = turn.state === 'running' ? 'running' : turn.state;
      if (headerStatus.get(String(chatId)) !== effective) {
        await refreshHeader(config, Number(chatId), sessionId, effective).catch((error) => log(`header failed: ${String(error.message)}`));
      }
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
      if (!reportsEnabled(chatId)) {
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

let serverOverride;

function setServerResolver(value) {
  serverOverride = value;
  serverPromise = undefined;
}

function server() {
  if (serverOverride !== undefined) return Promise.resolve(serverOverride);
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

// One chain for every call except the long poll: Telegram counts a bot's calls per chat,
// so serialising them keeps a burst of progress edits from tripping the limit. getUpdates
// is excluded because it deliberately blocks for ten seconds.
const LONG_POLL_METHODS = new Set(['getUpdates']);
const RATE_LIMIT_ATTEMPTS = 3;
const RATE_LIMIT_MAX_WAIT_MS = 15000;

let telegramChain = Promise.resolve();

function serialized(task) {
  const run = telegramChain.then(task, task);
  telegramChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

let telegramTransport;
const editSequence = new Map();

function setTelegramTransport(next) {
  telegramTransport = next ?? undefined;
}

function tg(config, method, body) {
  if (telegramTransport !== undefined) return telegramTransport(config, method, body);
  if (LONG_POLL_METHODS.has(method)) return tgOnce(config, method, body);
  if (method === 'editMessageText' && body !== undefined) {
    // A queued edit that a newer one has already superseded is dropped: progress and the
    // header can both be edited several times per tick, and Telegram counts every call.
    const key = `${String(body['chat_id'])}:${String(body['message_id'])}`;
    const sequence = (editSequence.get(key) ?? 0) + 1;
    editSequence.set(key, sequence);
    return serialized(() => {
      if (editSequence.get(key) !== sequence) return undefined;
      return tgOnce(config, method, body);
    });
  }
  return serialized(() => tgOnce(config, method, body));
}

async function tgOnce(config, method, body) {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    const payload = await response.json();
    if (payload.ok !== true) {
      const retryAfter = typeof payload.parameters?.retry_after === 'number' ? payload.parameters.retry_after : 0;
      if ((response.status === 429 || retryAfter > 0) && attempt < RATE_LIMIT_ATTEMPTS) {
        const waitMs = Math.min(Math.max(retryAfter, 1) * 1000, RATE_LIMIT_MAX_WAIT_MS);
        log(`telegram rate limit on ${method}: waiting ${String(Math.round(waitMs / 1000))}s`);
        await new Promise((resolve) => {
          setTimeout(resolve, waitMs);
        });
        continue;
      }
      throw new Error(payload.description ?? `telegram ${method} failed`);
    }
    if (SENDING_METHODS.has(method)) {
      const chatId = body === undefined ? undefined : body['chat_id'];
      const messageId = payload.result === undefined ? undefined : payload.result.message_id;
      if (typeof chatId === 'number' && typeof messageId === 'number') rememberSent(chatId, messageId);
    }
    if (method === 'deleteMessage' && body !== undefined) {
      forgetSent(Number(body['chat_id']), Number(body['message_id']));
    }
    return payload.result;
  }
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
  { command: 'purge', description: "delete this bot's messages, old ones too" },
  { command: 'name', description: 'show and retry the bot name' },
  { command: 'pending', description: 'everything waiting on you' },
  { command: 'debug', description: 'bridge state and recent log lines' },
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
  '/purge — delete every message this bot sent here, including old ones',
  '/name [on|off] — show, retry or stop the bot rename',
  '/pending — everything waiting on you, across sessions',
  '/debug — bridge state and the last few log lines',
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
    const pendingMatchesSelection = pending !== undefined && pending.sessionId === selectionFor(chatId);
    if (pendingMatchesSelection && (pending.questions?.length ?? 0) > 0) {
      const outcome = await answerQuestionByText(config, chatId, pending, trimmed);
      if (outcome !== 'gone') return;
      // the question was answered or dropped elsewhere: fall through and treat this
      // message as an ordinary prompt instead of swallowing it
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
      const chunks = chunkText(projectsReport(sessions, chatId, pageFromArgument(argument)), 3800);
      state.view[chatId] = { workspaceId: '', ids: [] };
      await saveState();
      await setMenu(config, chatId, COMMANDS_BROWSE);
      const keyboard = projectsKeyboard(groupSessionsByProject(sessions), pageFromArgument(argument));
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
      const [wantedText, pageText] = argument.split(/\s+/).filter((part) => part !== '');
      const wanted = Number.parseInt(wantedText ?? '', 10);
      const page = pageFromArgument(pageText ?? '');
      let entry;
      let projectNumber = 1;
      if (Number.isInteger(wanted) && wanted >= 1 && wanted <= groups.length) {
        entry = groups[wanted - 1];
        projectNumber = wanted;
      } else if (wantedText !== undefined && wantedText !== '') {
        const needle = wantedText.toLowerCase();
        const index = groups.findIndex(([project]) => project.toLowerCase().includes(needle));
        entry = index === -1 ? undefined : groups[index];
        projectNumber = index + 1;
      }
      if (entry === undefined) {
        await send(config, chatId, 'Use /sessions first, then /project <n> or /project <name>.');
        return;
      }
      const [, list] = entry;
      state.view[chatId] = {
        workspaceId: list[0]?.workspaceId ?? '',
        ids: list.map((session) => session.id),
      };
      await saveState();
      await setMenu(config, chatId, COMMANDS_BROWSE);
      const projectChunks = chunkText(projectReport(entry, chatId, page), 3800);
      const sessionKeyboard = sessionsKeyboard(list, page, projectNumber);
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
        await syncChatOnSelection(config, chatId, id);
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
      state.selection[chatId] = id;
      delete state.notified[chatId];
      await rememberNewestTurn(chatId, id);
      await saveState();
      await setMenu(config, chatId, COMMANDS_SESSION);
      await syncChatOnSelection(config, chatId, id);
      return;
    }
    case '/pending': {
      const info = await server();
      const sessions = await listSessions(info).catch(() => []);
      const waiting = sessions.filter((session) => session.status === 'approval' || session.status === 'question');
      if (waiting.length === 0) {
        await send(config, chatId, 'Nothing is waiting on you anywhere.');
        return;
      }
      const lines = ['⏳ Waiting on you', ''];
      const buttons = [];
      for (const session of waiting.slice(0, 10)) {
        const approvals = await pendingApprovals(info, session.id).catch(() => []);
        const questions = await pendingQuestions(info, session.id).catch(() => []);
        const bits = [];
        if (approvals.length > 0) bits.push(`${String(approvals.length)} approval(s)`);
        if (questions.length > 0) bits.push(`${String(questions.length)} question(s)`);
        lines.push(`• ${session.project} · ${session.title}${bits.length === 0 ? '' : ` — ${bits.join(', ')}`}`);
        buttons.push([{ text: `Open ${session.title}`.slice(0, 60), callback_data: `use|${shortId('go', session.id)}` }]);
      }
      lines.push('', 'Tap a session to switch to it.');
      await sendPlain(config, chatId, lines.join('\n'), buttons.length === 0 ? undefined : { inline_keyboard: buttons });
      return;
    }
    case '/debug': {
      const lines = [
        '🔧 Bridge',
        `pid ${String(process.pid)} · offset ${String(state.offset)}`,
        `tracked sent ${String(Object.values(state.sent).reduce((sum, list) => sum + list.length, 0))} · incoming ${String(Object.values(state.incoming).reduce((sum, list) => sum + list.length, 0))}`,
        `renaming ${state.renameDisabled === true ? 'off' : 'on'} · cooldown ${typeof state.nameRetryAt === 'number' && state.nameRetryAt > Date.now() ? `${String(Math.round((state.nameRetryAt - Date.now()) / 3600000))}h` : 'none'}`,
        `ffmpeg ${findFfmpeg() ?? 'not found'}`,
      ];
      const last = recentLog.slice(-5);
      if (last.length > 0) lines.push('', 'Recent:', ...last.map((line) => line.replace('[omnicode-telegram] ', '• ')));
      await send(config, chatId, lines.join('\n'));
      return;
    }
    case '/current': {
      const sessionId = selectionFor(chatId);
      const sessions = await listSessions(await server()).catch(() => []);
      const meta = sessions.find((session) => session.id === sessionId);
      const head = typeof sessionId === 'string' ? sessionHeaderText(meta, sessionId, meta?.status) : 'no session selected';
      await send(config, chatId, `${head}\n\noverrides: ${describeOverrides(chatId)}`);
      return;
    }
    case '/purge': {
      const sessionId = selectionFor(chatId);
      const noteMessage = await send(config, chatId, 'Purging every message this bot sent here…').catch(() => undefined);
      const note = async (text) => {
        if (typeof noteMessage?.message_id === 'number') {
          await tg(config, 'editMessageText', { chat_id: chatId, message_id: noteMessage.message_id, text }).catch(() => undefined);
        }
      };
      const result = await purgeChat(config, chatId, note);
      log(`purge for ${String(chatId)}: deleted ${String(result.removed)} of ${String(result.upper)} ids checked`);
      const detail = result.skipped.length === 0 ? '' : `\nSkipped: ${result.skipped.join('; ')}`;
      await send(
        config,
        chatId,
        `🧹 Purged ${String(result.removed)} message(s), ${String(result.upper)} ids checked.${detail}`,
      ).catch((error) => log(`purge summary failed: ${error.message}`));
      if (typeof sessionId === 'string') {
        await refreshHeader(config, chatId, sessionId, undefined).catch(() => undefined);
        await sendLastReport(config, chatId, sessionId).catch(() => undefined);
        await refreshPending(config, chatId, sessionId).catch(() => undefined);
      } else {
        await send(config, chatId, 'Select a session with /use to start again.').catch(() => undefined);
      }
      return;
    }
    case '/name': {
      const mode = argument.toLowerCase();
      if (mode === 'on' || mode === 'off') {
        state.renameDisabled = mode === 'off';
        await saveState();
        await send(
          config,
          chatId,
          mode === 'off'
            ? 'Renaming off — the bot keeps the name you gave it. The pinned header still shows which session you are in.'
            : 'Renaming on — the bridge will set "OmniCode - <project> · <session title>" when Telegram allows it (about once a day).',
        );
        return;
      }
      const sessionId = selectionFor(chatId);
      if (typeof sessionId !== 'string') {
        await send(config, chatId, 'Select a session first — /sessions, then /project <n>. Nothing was renamed.');
        return;
      }
      const sessions = await listSessions(await server()).catch(() => []);
      const meta = sessions.find((session) => session.id === sessionId);
      const desired = botNameFor(meta?.project ?? '', meta?.title ?? '');
      if (state.renameDisabled !== true) {
        state.botName = '';
        await applyBotName(config, sessionId).catch(() => undefined);
      }
      const current = await tg(config, 'getMyName', {}).catch(() => undefined);
      const remaining = typeof state.nameRetryAt === 'number' ? state.nameRetryAt - Date.now() : 0;
      const status = state.renameDisabled === true
        ? 'Renaming is off (/name on to enable it).'
        : remaining > 0
          ? `Telegram is refusing another rename for about ${String(Math.round(remaining / 3600000))}h — a bot may only change its name a few times a day.`
          : 'Renaming is available.';
      await send(config, chatId, `Name on Telegram: ${String(current?.name ?? '?')}\nWanted: ${desired}\n${status}`);
      return;
    }
    case '/notify': {
      const [what, value] = argument.toLowerCase().split(/\s+/).filter((part) => part !== '');
      const mode = what === 'others' ? value : what;
      if (mode !== 'on' && mode !== 'off') {
        const others = state.others[chatId] === false ? 'off' : 'on';
        await send(
          config,
          chatId,
          `Notifications here: ${reportsEnabled(chatId) ? 'on' : 'off'} · other sessions: ${others}\nUse /notify on|off, or /notify others on|off.`,
        );
        return;
      }
      if (what === 'others') {
        state.others[chatId] = mode === 'on';
        await saveState();
        await send(config, chatId, `Alerts when another session finishes: ${mode}.`);
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
        await send(config, chatId, reply === undefined ? 'No assistant reply yet.' : reply.slice(0, REPORT_MAX_CHARS));
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
        await api(await server(), 'POST', `/api/v1/sessions/${encodeURIComponent(sessionId)}:abort`, {});
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
      } else if (key === 'permission_mode') {
        if (argument !== 'manual' && argument !== 'yolo' && argument !== 'auto') {
          await send(config, chatId, 'Use /permission manual, /permission auto or /permission yolo — or /permission clear.');
          return;
        }
        overrides[key] = argument;
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
const STATE_SCHEMA = 2;

let saveChain = Promise.resolve();

function saveState() {
  const run = saveChain.then(writeStateFile, writeStateFile);
  saveChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function writeStateFile() {
  await loadPersistedState();
  await writeJson(STATE_PATH, { ...state, schemaVersion: STATE_SCHEMA, pid: process.pid, heartbeatAt: Date.now() });
}

let loadedOnce = false;

async function loadPersistedState() {
  if (loadedOnce) return;
  loadedOnce = true;
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  const saved = await readJson(STATE_PATH, undefined);
  if (saved === undefined) return;
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
  state.sent = saved.sent ?? {};
  state.incoming = saved.incoming ?? {};
  state.clearHinted = saved.clearHinted ?? {};
  state.watching = saved.watching ?? {};
  state.otherNotified = saved.otherNotified ?? {};
  state.others = saved.others ?? {};
  state.header = saved.header ?? {};
  state.renameDisabled = saved.renameDisabled;
  state.botName = saved.botName;
  state.nameRetryAt = saved.nameRetryAt;
  state.profilePhotoHash = saved.profilePhotoHash;
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function claimLock() {
  const held = await readJson(LOCK_PATH, undefined);
  if (held !== undefined && typeof held.pid === 'number' && held.pid !== process.pid && processAlive(held.pid)) return held.pid;
  await writeJson(LOCK_PATH, { pid: process.pid, claimedAt: Date.now() });
  return undefined;
}

async function touchLock() {
  const held = await readJson(LOCK_PATH, undefined).catch(() => undefined);
  if (held?.pid !== process.pid) return;
  await writeJson(LOCK_PATH, { pid: process.pid, claimedAt: Date.now() }).catch(() => undefined);
}

function releaseLockSync() {
  try {
    const held = JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
    if (held?.pid !== process.pid) return;
  } catch {
    return;
  }
  rmSync(LOCK_PATH, { force: true });
}

async function main() {
  const config = await loadConfig();
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  const holder = await claimLock();
  if (holder !== undefined) {
    log(`another bridge is already polling (pid ${String(holder)}); exiting so the two cannot split the updates`);
    process.exit(0);
  }
  process.on('exit', () => {
    try {
      releaseLockSync();
    } catch {
      // nothing useful to do while exiting
    }
  });
  await loadPersistedState();
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
  setInterval(() => {
    maybeRefreshName(config).catch((error) => log(`name refresh failed: ${error.message}`));
  }, NAME_RETRY_INTERVAL_MS);
  setInterval(() => {
    reportOtherFinishedTurns(config).catch((error) => log(`other finish check failed: ${error.message}`));
  }, OTHER_CHECK_MS);
  setInterval(() => {
    touchLock().catch(() => undefined);
  }, LOCK_MAX_AGE_MS / 4);

  let backoffMs = 3000;
  for (;;) {
    let updates;
    try {
      updates = await tg(config, 'getUpdates', { offset: state.offset, timeout: POLL_TIMEOUT_S, allowed_updates: ['message', 'callback_query'] });
      backoffMs = 3000;
    } catch (error) {
      log(`poll failed: ${describeError(error)}; retrying in ${Math.round(backoffMs / 1000)}s`);
      await new Promise((resolve) => {
        setTimeout(resolve, backoffMs);
      });
      backoffMs = Math.min(backoffMs * 2, 15000);
      continue;
    }
    for (const update of updates) {
      state.offset = update.update_id + 1;
      scheduleStateSave();
      try {
        if (update.callback_query !== undefined) {
          const callbackChat = update.callback_query.message?.chat?.id;
          if (typeof callbackChat !== 'number' || !config.allowedChatIds.includes(callbackChat)) {
            log(`ignored a callback press from chat ${String(callbackChat)} — not in allowedChatIds`);
            continue;
          }
          await handleCallback(config, update.callback_query);
          continue;
        }
        const message = update.message;
        if (message === undefined) continue;
        if (typeof message.text !== 'string') {
          const chatIdForMedia = message.chat?.id;
          if (typeof chatIdForMedia === 'number' && config.allowedChatIds.includes(chatIdForMedia)) {
            rememberIncoming(chatIdForMedia, message.message_id);
            const unsupported = message.voice !== undefined || message.audio !== undefined || message.sticker !== undefined;
            if (unsupported) {
              await send(config, chatIdForMedia, 'That kind of file cannot be read yet — send a photo, an image file, or a video.').catch(() => undefined);
            }
            if (
              Array.isArray(message.photo) ||
              message.document !== undefined ||
              message.video !== undefined ||
              message.animation !== undefined ||
              message.video_note !== undefined
            ) {
              try {
                await handleMedia(config, chatIdForMedia, message);
              } catch (error) {
                await send(config, chatIdForMedia, `Could not send that file: ${error.message}`);
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
        rememberIncoming(chatId, message.message_id);
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

export { api, discoverServer, listSessions, lastReply, handle, loadConfig, state, tg, statusReport, summarizeTurn, projectsReport, projectReport, groupSessionsByProject, markdownToHtml, modelCatalog, providerCounts, modelLabel, server, approvalText, approvalKeyboard, questionText, questionKeyboard, pendingApprovals, pendingQuestions, projectsKeyboard, sessionsKeyboard, modelsKeyboard, usageReport, diffReport, filesReport, formatDuration, chunkText, progressLine, handleCallback, imagePartOf, handleMedia, deliverReport, botNameFor, clearChatHistory, syncChatOnSelection, refreshPending, announcePending, shortId, longId, purgeUpperBound, videoPartOf, videoFrames, otherFinishLine, sessionHeaderText, refreshHeader, answerQuestionByText, setTelegramTransport, setApiTransport, setServerResolver };

// Loaded at import time so that anything importing this module (tests, a one-off
// command) sees the same state the daemon has, instead of an empty one that would
// be written back over the file — which used to discard the message ledger.
await loadPersistedState();

if (isEntryPoint) {
  main().catch((error) => {
    log(`fatal: ${error.message}`);
    process.exit(1);
  });
}
