import { useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { InboxPage } from "./pages/Inbox.js";
import { ComposePage } from "./pages/Compose.js";
import { DetailPage } from "./pages/Detail.js";
import { QueuesPage } from "./pages/Queues.js";
import { VerifyEmailPage } from "./pages/VerifyEmail.js";
import { SettingsPage } from "./pages/Settings.js";
import { LoginPage } from "./pages/Login.js";
import { api } from "./lib/api.js";
import { useAuth } from "./hooks/queries.js";

function Guard({ children }: { children: JSX.Element }) {
  const me = useAuth();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const redeemed = useRef(false);
  // Google ticket lands here without a session yet — redeem BEFORE the auth
  // decision, or Guard would bounce to /login and eat the ticket.
  // `redeeming` holds the redirect until the POST settles: without it, a cold
  // return from Google (me errors, no cookie yet) bounces to /login mid-flight
  // and strands the user there despite the session landing a moment later.
  const [redeeming, setRedeeming] = useState(Boolean(params.get("ticket")));
  useEffect(() => {
    const ticket = params.get("ticket");
    if (ticket && !redeemed.current) {
      redeemed.current = true;
      setRedeeming(true);
      api
        .post("/api/auth/google/consume", { ticket })
        .then(() => {
          toast.success("Signed in with Google");
          qc.invalidateQueries({ queryKey: ["me"] });
        })
        .catch(() => toast.error("Login expired — please sign in again"))
        .finally(() => {
          const next = new URLSearchParams(params);
          next.delete("ticket");
          setParams(next, { replace: true });
          setRedeeming(false);
        });
    }
  }, [params, setParams, qc]);
  if (me.isLoading || redeeming) return <div className="p-10">Loading…</div>;
  if (me.isError || !me.data?.user) return <Navigate to="/login" replace />;
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
