import { Navigate, Route, Routes } from "react-router-dom";
import { InboxPage } from "./pages/Inbox.js";
import { ComposePage } from "./pages/Compose.js";
import { DetailPage } from "./pages/Detail.js";
import { QueuesPage } from "./pages/Queues.js";
import { VerifyEmailPage } from "./pages/VerifyEmail.js";
import { SettingsPage } from "./pages/Settings.js";
import { LoginPage } from "./pages/Login.js";
import { useAuth } from "./hooks/queries.js";

function Guard({ children }: { children: JSX.Element }) {
  const me = useAuth();
  if (me.isLoading) return <div className="p-10">Loading…</div>;
  if (me.isError || !me.data) return <Navigate to="/login" replace />;
  return children;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/" element={<Guard><InboxPage /></Guard>} />
      <Route path="/compose" element={<Guard><ComposePage /></Guard>} />
      <Route path="/queues" element={<Guard><QueuesPage /></Guard>} />
      <Route path="/email/:id" element={<Guard><DetailPage /></Guard>} />
      <Route path="/settings" element={<Guard><SettingsPage /></Guard>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
