import { isValidElement } from 'react';
import { describe, expect, it } from 'vitest';
import { matchRoutes } from 'react-router-dom';

import { routes } from '../src/App';
import { HomePage } from '../src/pages/HomePage';
import { SessionPage } from '../src/pages/SessionPage';

function matchedComponent(pathname: string): unknown {
  const element = matchRoutes(routes, pathname)?.at(-1)?.route.element;
  return isValidElement(element) ? element.type : undefined;
}

function matchedParams(pathname: string): Record<string, string | undefined> {
  return matchRoutes(routes, pathname)?.at(-1)?.params ?? {};
}

describe('route table', () => {
  it('mounts HomePage at the index route', () => {
    expect(matchedComponent('/')).toBe(HomePage);
  });

  it('mounts SessionPage under /sessions/:id', () => {
    expect(matchedComponent('/sessions/abc')).toBe(SessionPage);
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
