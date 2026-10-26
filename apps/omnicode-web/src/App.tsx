import { Routes, Route, Navigate } from "react-router-dom";
import HomePage from "#/pages/HomePage";
import ParticleBackground from "#/components/ParticleBackground";

export default function App() {
  return (
    <div className="relative flex h-full min-h-0 flex-col bg-panel text-head">
      {/* Background constellation — behind every route's content. */}
      <div className="fixed inset-0 z-0">
        <ParticleBackground />
      </div>
      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/chat" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}