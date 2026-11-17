import { useRoutes, type RouteObject } from 'react-router-dom';
import { Shell } from './components/Shell';
import { HomePage } from './pages/HomePage';
import { SessionPage } from './pages/SessionPage';

export const routes: RouteObject[] = [
  { index: true, element: <HomePage /> },
  { path: 'sessions/:id', element: <SessionPage /> },
];

export function App() {
  const element = useRoutes(routes);
  return <Shell>{element}</Shell>;
}
