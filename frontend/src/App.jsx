import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useStore } from './store';
import Layout from './components/Layout';
import TokenUsagePage from './pages/TokenUsagePage';
import ChannelStatusPage from './pages/ChannelStatusPage';
import RadarPage from './pages/RadarPage';
import IQTestPage from './pages/IQTestPage';
import UsageStatsPage from './pages/UsageStatsPage';
import ContactPage from './pages/ContactPage';
import SettingsPage from './pages/SettingsPage';
import Skeleton from './components/Skeleton';

export default function App() {
  const ready = useStore((s) => s.ready);
  const bootstrap = useStore((s) => s.bootstrap);
  useEffect(() => { bootstrap(); }, [bootstrap]);

  if (!ready) {
    return <div className="p-10 max-w-xl mx-auto space-y-3"><Skeleton className="h-8 w-48" /><Skeleton className="h-32 w-full" /></div>;
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/token-usage" replace />} />
        <Route path="/token-usage" element={<TokenUsagePage />} />
        <Route path="/channels" element={<ChannelStatusPage />} />
        <Route path="/radar" element={<RadarPage />} />
        <Route path="/iq" element={<IQTestPage />} />
        <Route path="/usage" element={<UsageStatsPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/token-usage" replace />} />
      </Route>
    </Routes>
  );
}
