import type { UpdateStatus } from './updater';

export interface UpdateButtonBridge {
  readonly currentVersion: string;
  readonly controlsWidth: number;
  readonly reserveVar: string;
  readonly getStatus: () => Promise<UpdateStatus>;
  readonly onStatus: (listener: (status: UpdateStatus) => void) => void;
  readonly download: () => void;
  readonly install: () => void;
}

const BUTTON_WIDTH = 104;
const GAP = 8;
const HIDE_DELAY_MS = 220;

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
.wrap {
  position: fixed;
  top: 9px;
  z-index: 2147483646;
  font: 13px/1.45 var(--font-sans, system-ui, sans-serif);
  color: var(--color-text, #1c1a16);
  -webkit-app-region: no-drag;
  app-region: no-drag;
}
.btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: ${BUTTON_WIDTH}px;
  height: 30px;
  padding: 0 10px 0 8px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--color-accent-bd, rgba(184,127,36,.3));
  border-radius: 8px;
  cursor: pointer;
  color: var(--color-accent, #b87f24);
  background: var(--color-accent-soft, #fff6d6);
}
.btn:hover { filter: brightness(1.06); }
.btn.ready { color: var(--color-text-on-accent, #fff); background: var(--color-accent, #b87f24); border-color: transparent; }
.btn.ready svg { animation: nudge 1.6s ease-in-out infinite; }
.ring {
  position: absolute;
  left: 5px;
  top: 3px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: conic-gradient(var(--color-accent, #b87f24) calc(var(--p, 0) * 1%), transparent 0);
  -webkit-mask: radial-gradient(circle, transparent 8.5px, black 9px);
  mask: radial-gradient(circle, transparent 8.5px, black 9px);
}
.card {
  position: absolute;
  top: 38px;
  right: 0;
  width: 360px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid var(--color-line, #e6e3da);
  background: var(--color-surface-raised, #fff);
  box-shadow: 0 8px 24px rgba(0,0,0,.18), 0 1px 4px rgba(0,0,0,.12);
}
.head { display: flex; gap: 10px; align-items: center; }
.badge {
  display: grid; place-items: center; flex: none;
  width: 30px; height: 30px; border-radius: 8px;
  color: var(--color-text-on-accent, #fff); background: var(--color-accent, #b87f24);
}
h1 { margin: 0; font-size: 14px; font-weight: 650; color: var(--color-text-strong, inherit); }
.sub { font-size: 12px; color: var(--color-text-muted, #6b6860); }
.bar { height: 4px; margin-top: 12px; border-radius: 2px; background: var(--color-fill-2, rgba(0,0,0,.05)); overflow: hidden; }
.bar > div { height: 100%; background: var(--color-accent, #b87f24); transition: width .3s; }
.notes {
  margin-top: 12px; padding-top: 10px; max-height: 260px; overflow-y: auto;
  border-top: 1px solid var(--color-line, #e6e3da); overflow-wrap: anywhere;
  scrollbar-width: thin; scrollbar-color: var(--color-line-strong, #d6d1c4) transparent;
}
.notes h2 { margin: 10px 0 4px; font-size: 11px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: var(--color-text-muted, #6b6860); }
.notes h2:first-child { margin-top: 0; }
.notes ul { margin: 0; padding-left: 18px; }
.notes li, .notes p { margin: 4px 0; }
.notes code { font: 12px var(--font-mono, ui-monospace, monospace); padding: 0 4px; border-radius: 4px; background: var(--color-fill-2, rgba(0,0,0,.05)); }
.err { margin-top: 10px; font-size: 12px; color: var(--color-danger, #c0392b); }
.actions { display: flex; justify-content: flex-end; margin-top: 12px; }
.primary {
  height: 30px; padding: 0 14px; font: inherit; font-weight: 600; border: 0; border-radius: 8px; cursor: pointer;
  color: var(--color-text-on-accent, #fff); background: var(--color-accent, #b87f24);
}
.primary:disabled { cursor: default; color: var(--color-text-muted, #6b6860); background: var(--color-fill-2, rgba(0,0,0,.05)); }
[hidden] { display: none !important; }
@keyframes nudge { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(2px); } }
@media (prefers-reduced-motion: reduce) { .btn.ready svg { animation: none; } }
`;

const ICON = `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/**
 * The update button beside the window controls and its hover card (version,
 * release notes, download / restart). It lives in the app page itself, in a
 * shadow root styled with the app's own color tokens, so it follows the
 * light and dark themes without extra renderer processes.
 */
export function mountUpdateButton(bridge: UpdateButtonBridge): void {
  const host = document.createElement('div');
  host.id = 'omnicode-desktop-update';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>${STYLE}</style>
<div class="wrap" hidden>
  <button class="btn" type="button"><span class="ring" hidden></span>${ICON}<span class="label"></span></button>
  <div class="card" role="dialog" hidden>
    <div class="head"><div class="badge">${ICON}</div><div><h1></h1><div class="sub"></div></div></div>
    <div class="bar" hidden><div></div></div>
    <div class="err" hidden></div>
    <div class="notes"></div>
    <div class="actions"><button class="primary" type="button"></button></div>
  </div>
</div>`;
  document.body.append(host);

  const q = <T extends Element>(selector: string): T => root.querySelector(selector) as T;
  const wrap = q<HTMLDivElement>('.wrap');
  const button = q<HTMLButtonElement>('.btn');
  const ring = q<HTMLSpanElement>('.ring');
  const label = q<HTMLSpanElement>('.label');
  const card = q<HTMLDivElement>('.card');
  const heading = q<HTMLHeadingElement>('h1');
  const sub = q<HTMLDivElement>('.sub');
  const bar = q<HTMLDivElement>('.bar');
  const err = q<HTMLDivElement>('.err');
  const notes = q<HTMLDivElement>('.notes');
  const primary = q<HTMLButtonElement>('.primary');
  wrap.style.right = `${bridge.controlsWidth + GAP}px`;

  let status: UpdateStatus = { state: 'idle' };
  let renderedNotes: string | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const act = (): void => {
    if (status.state === 'downloaded') bridge.install();
    else if (status.state === 'available' || status.state === 'error') bridge.download();
  };

  const render = (): void => {
    const visible = status.state !== 'idle' && status.version !== undefined;
    wrap.hidden = !visible;
    document.documentElement.style.setProperty(
      bridge.reserveVar,
      `${bridge.controlsWidth + (visible ? BUTTON_WIDTH + GAP : 0)}px`,
    );
    if (!visible) {
      card.hidden = true;
      return;
    }
    const percent = Math.round(status.percent ?? 0);
    const ready = status.state === 'downloaded';
    button.classList.toggle('ready', ready);
    ring.hidden = status.state !== 'downloading';
    button.style.setProperty('--p', String(percent));
    label.textContent = ready ? 'Restart' : status.state === 'downloading' ? `${percent}%` : 'Update';
    button.setAttribute(
      'aria-label',
      ready ? `Restart to install Omnicode ${status.version}` : `Omnicode ${status.version} is available`,
    );
    heading.textContent = `Omnicode ${status.version}`;
    sub.textContent =
      (ready ? 'Ready to install' : status.state === 'downloading' ? `Downloading… ${percent}%` : 'New version available') +
      ` · you have ${bridge.currentVersion}`;
    bar.hidden = status.state !== 'downloading';
    (bar.firstElementChild as HTMLDivElement).style.width = `${percent}%`;
    err.hidden = status.state !== 'error';
    err.textContent = status.state === 'error' ? `Download failed: ${status.message ?? 'unknown error'}` : '';
    primary.disabled = status.state === 'downloading';
    primary.textContent = ready
      ? 'Restart to update'
      : status.state === 'downloading'
        ? 'Downloading…'
        : status.state === 'error'
          ? 'Try again'
          : 'Download';
    const markdown = status.releaseNotes?.en ?? '';
    if (markdown !== renderedNotes) {
      renderedNotes = markdown;
      renderNotes(notes, markdown === '' ? 'Bug fixes and improvements.' : markdown);
    }
  };

  const showCard = (show: boolean): void => {
    if (hideTimer !== undefined) clearTimeout(hideTimer);
    hideTimer = undefined;
    if (show) {
      card.hidden = wrap.hidden;
      return;
    }
    hideTimer = setTimeout(() => {
      card.hidden = true;
    }, HIDE_DELAY_MS);
  };

  wrap.addEventListener('mouseenter', () => showCard(true));
  wrap.addEventListener('mouseleave', () => showCard(false));
  button.addEventListener('focus', () => showCard(true));
  button.addEventListener('blur', () => showCard(false));
  button.addEventListener('click', act);
  primary.addEventListener('click', act);

  bridge.onStatus((next) => {
    status = next;
    render();
  });
  void bridge.getStatus().then((initial) => {
    if (status.state === 'idle') {
      status = initial;
      render();
    }
  });
  render();
}

function renderNotes(container: HTMLElement, markdown: string): void {
  container.replaceChildren();
  let list: HTMLUListElement | undefined;
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (line === '') {
      list = undefined;
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (heading !== null) {
      list = undefined;
      const h = document.createElement('h2');
      h.textContent = heading[1] ?? '';
      container.append(h);
    } else if (item !== null) {
      if (list === undefined) {
        list = document.createElement('ul');
        container.append(list);
      }
      const li = document.createElement('li');
      appendInline(li, item[1] ?? '');
      list.append(li);
    } else {
      list = undefined;
      const p = document.createElement('p');
      appendInline(p, line);
      container.append(p);
    }
  }
}

function appendInline(parent: HTMLElement, text: string): void {
  for (const part of text.split(/(`[^`]+`)/)) {
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      const code = document.createElement('code');
      code.textContent = part.slice(1, -1);
      parent.append(code);
    } else if (part !== '') {
      parent.append(document.createTextNode(part.replaceAll('**', '')));
    }
  }
}
