import { isValidElement } from 'react';
import { describe, expect, it } from 'vitest';
import { matchRoutes } from 'react-router-dom';

import { routes } from '../src/App';
import { Shell } from '../src/components/Shell';
import { HomePage } from '../src/pages/HomePage';
import { SessionPage } from '../src/pages/SessionPage';

/** The route element is the Shell frame; the page rides in its children. */
function matchedFrame(pathname: string): { frame: unknown; page: unknown } {
  const element = matchRoutes(routes, pathname)?.at(-1)?.route.element;
  if (!isValidElement(element)) return { frame: undefined, page: undefined };
  const props = element.props as { children?: { type?: unknown } };
  return { frame: element.type, page: props.children?.type };
}

function matchedParams(pathname: string): Record<string, string | undefined> {
  return matchRoutes(routes, pathname)?.at(-1)?.params ?? {};
}

describe('route table', () => {
  it('mounts HomePage inside the Shell frame at the index route', () => {
    const { frame, page } = matchedFrame('/');
    expect(frame).toBe(Shell);
    expect(page).toBe(HomePage);
  });

  it('mounts SessionPage inside the Shell frame under /sessions/:id', () => {
    const { frame, page } = matchedFrame('/sessions/abc');
    expect(frame).toBe(Shell);
    expect(page).toBe(SessionPage);
  });

  it('binds the parameter SessionPage destructures as id', () => {
    expect(matchedParams('/sessions/7f3a').id).toBe('7f3a');
  });

  it('matches nothing for an unknown path', () => {
    expect(matchRoutes(routes, '/nope')).toBeNull();
  });

  it('does not match a session path with no id', () => {
    expect(matchRoutes(routes, '/sessions')).toBeNull();
  });
});
