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
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HOME = process.env.OMNICODE_HOME ?? path.join(homedir(), '.omnicode');
const CONFIG_PATH = path.join(HOME, 'telegram.json');
const STATE_PATH = path.join(HOME, 'telegram-state.json');
const INSTANCES_DIR = path.join(HOME, 'server', 'instances');
const TOKEN_PATH = path.join(HOME, 'server.token');
const POLL_TIMEOUT_S = 25;
const SESSIONS_PAGE = 10;

const state = { offset: 0, selection: {}, overrides: {}, notify: {}, notified: {}, profilePhotoHash: undefined };

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
  const response = await fetch(`${server.baseUrl}${route}`, {
    method,
    headers: {
      authorization: `Bearer ${server.token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
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
      if (turn === undefined || turn.turnId === state.notified[chatId]) continue;
      if (turn.state === 'running') continue;
      state.notified[chatId] = turn.turnId;
      await saveState();
      if (turn.state !== 'completed') continue;
      const reply = await lastReply(info, sessionId).catch(() => undefined);
      if (reply === undefined) continue;
      const body = reply.length > REPORT_MAX_CHARS ? `${reply.slice(0, REPORT_MAX_CHARS)}\n…(truncated)` : reply;
      await send(config, Number(chatId), `✅ Finished\n\n${body}`);
    }
  } finally {
    reporting = false;
  }
}

// --- Telegram -----------------------------------------------------------------

let serverPromise;
function server() {
  serverPromise ??= discoverServer();
  return serverPromise;
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

const BOT_COMMANDS = [
  { command: 'sessions', description: 'list recent sessions' },
  { command: 'use', description: 'select a session by number' },
  { command: 'current', description: 'show the selection and overrides' },
  { command: 'last', description: 'newest assistant reply' },
  { command: 'stop', description: 'cancel the running turn' },
  { command: 'model', description: 'model for the next prompt' },
  { command: 'profile', description: 'profile for the next prompt' },
  { command: 'thinking', description: 'thinking level for the next prompt' },
  { command: 'permission', description: 'permission mode for the next prompt' },
  { command: 'plan', description: 'plan mode on or off' },
  { command: 'settings', description: 'list the model catalog' },
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

async function applyBotProfile(config) {
  const attempts = [
    ['commands', () => tg(config, 'setMyCommands', { commands: BOT_COMMANDS })],
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

const HELP = [
  'Omnicode from Telegram',
  '',
  '/sessions — list recent sessions',
  '/use <n> — select one by number',
  '/current — show the selection and pending overrides',
  '/last — show the newest assistant reply',
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
    const sessionId = selectionFor(chatId);
    if (sessionId === undefined) {
      await send(config, chatId, 'No session selected. Use /sessions then /use <n>.');
      return;
    }
    const overrides = overridesFor(chatId);
    const body = { content: [{ type: 'text', text: trimmed }] };
    for (const key of ['model', 'profile', 'thinking', 'permission_mode']) {
      if (overrides[key] !== undefined) body[key] = overrides[key];
    }
    if (overrides.plan_mode !== undefined) body.plan_mode = overrides.plan_mode === true || overrides.plan_mode === 'true';
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
    case '/sessions': {
      const sessions = await listSessions(await server());
      if (sessions.length === 0) {
        await send(config, chatId, 'No sessions.');
        return;
      }
      const lines = sessions.map((session, index) => `${index + 1}. ${session.title}`);
      await send(config, chatId, `${lines.join('\n')}\n\nSelect with /use <n>.`);
      return;
    }
    case '/use': {
      const index = Number.parseInt(argument, 10);
      const sessions = await listSessions(await server());
      const picked = sessions[index - 1];
      if (picked === undefined) {
        await send(config, chatId, 'Use /sessions first, then /use <number>.');
        return;
      }
      state.selection[chatId] = picked.id;
      delete state.notified[chatId];
      await rememberNewestTurn(chatId, picked.id);
      await saveState();
      await send(config, chatId, `Selected: ${picked.title}`);
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
    case '/settings': {
      try {
        const data = await api(await server(), 'GET', '/api/v1/models');
        const models = Array.isArray(data?.items) ? data.items : [];
        const sample = models.slice(0, 40).map((model) => `• ${model.id ?? model.model ?? model.name}`);
        await send(config, chatId, `Models (showing ${sample.length} of ${models.length}):\n${sample.join('\n')}\n\nPick with /model <alias>.`);
      } catch (error) {
        await send(config, chatId, `Could not list models: ${error.message}`);
      }
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
    state.profilePhotoHash = saved.profilePhotoHash;
  }
  const info = await server();
  await saveState();
  log(`connected to ${info.baseUrl} (omnicode ${info.version ?? '?'})`);
  log(config.allowedChatIds.length === 0
    ? 'no allowedChatIds yet — message the bot to learn your chat id, add it, then restart'
    : `serving ${config.allowedChatIds.length} allowed chat(s)`);
  await applyBotProfile(config);
  await primeReports();
  setInterval(() => {
    reportFinishedTurns(config).catch((error) => log(`finish report failed: ${error.message}`));
  }, NOTIFY_INTERVAL_MS);

  let backoffMs = 3000;
  for (;;) {
    let updates;
    try {
      updates = await tg(config, 'getUpdates', { offset: state.offset, timeout: POLL_TIMEOUT_S, allowed_updates: ['message'] });
      backoffMs = 3000;
    } catch (error) {
      log(`poll failed: ${error.message}; retrying in ${Math.round(backoffMs / 1000)}s`);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      backoffMs = Math.min(backoffMs * 2, 30000);
      continue;
    }
    for (const update of updates) {
      state.offset = update.update_id + 1;
      try {
        const message = update.message;
        if (message === undefined || typeof message.text !== 'string') continue;
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

export { api, discoverServer, listSessions, lastReply, handle, loadConfig, state, tg };

if (isEntryPoint) {
  main().catch((error) => {
    log(`fatal: ${error.message}`);
    process.exit(1);
  });
}
