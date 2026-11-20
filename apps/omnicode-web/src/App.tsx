import { useRoutes, type RouteObject } from 'react-router-dom';
import { Shell } from './components/Shell';
import { SessionsRail } from './components/SessionsRail';
import { HomePage } from './pages/HomePage';
import { SessionPage } from './pages/SessionPage';

export const routes: RouteObject[] = [
  { index: true, element: <Shell sidebar={<SessionsRail />}><HomePage /></Shell> },
  { path: 'sessions/:id', element: <Shell sidebar={<SessionsRail />}><SessionPage /></Shell> },
];

export function App() {
  const element = useRoutes(routes);
  return <div className="contents">{element}</div>;
}
