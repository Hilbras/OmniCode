import { Routes, Route } from 'react-router-dom';
import { Shell } from './components/Shell';
import { HomePage } from './pages/HomePage';
import { SessionPage } from './pages/SessionPage';

export function App() {
  return (
    <Shell>
      <Routes>
        <Route index element={<HomePage />} />
        <Route path="sessions/:id" element={<SessionPage />} />
      </Routes>
    </Shell>
  );
}
