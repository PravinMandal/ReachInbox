import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api.js";
import { useAuth, useCounts, useSlackStatus } from "../hooks/queries.js";
import { useTheme } from "../lib/theme.js";
import { Button } from "../components/Button.js";
import { AppShell } from "../components/Sidebar.js";

export function SettingsPage() {
  const me = useAuth();
  const counts = useCounts(Boolean(me.data));
  const slack = useSlackStatus(Boolean(me.data));
  const { theme, toggle } = useTheme();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();

  // Landing spot from the Slack OAuth callback (?slack=connected|error).
  useEffect(() => {
    const flag = params.get("slack");
    if (flag === "connected") {
      toast.success("Slack connected — rate-limit alerts on");
      qc.invalidateQueries({ queryKey: ["slack"] });
    } else if (flag === "error") {
      toast.error("Slack connection failed — try again");
    } else return;
    const next = new URLSearchParams(params);
    next.delete("slack");
    setParams(next, { replace: true });
  }, [params, setParams, qc]);

  const connect = useMutation({
    mutationFn: async (): Promise<{ url: string }> => (await api.get("/api/slack/connect")).data,
    onSuccess: (d) => {
      window.location.href = d.url;
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const disconnect = useMutation({
    mutationFn: async () => api.delete("/api/slack/disconnect"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["slack"] });
      toast.success("Slack disconnected");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!me.data) return null;

  return (
    <AppShell user={me.data.user} counts={counts.data}>
    <div className="mx-auto max-w-2xl p-4 sm:p-8">
      <Link to="/" className="mb-4 inline-block">← Inbox</Link>
      <h1 className="mb-6 text-2xl font-semibold">Settings</h1>

      <section className="mb-6 rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
        <h2 className="mb-1 font-medium">Slack notifications</h2>
        <p className="mb-4 text-sm text-neutral-500">
          Get a live message the moment a sender hits its hourly limit. Reconnect anytime — no redeploy needed.
        </p>
        {slack.isLoading ? (
          <p className="text-sm">Checking…</p>
        ) : slack.data?.connected ? (
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
              Connected{slack.data.channelId ? ` · ${slack.data.channelId}` : ""}
            </span>
            <Button variant="ghost" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
              Disconnect
            </Button>
          </div>
        ) : (
          <Button variant="outline" onClick={() => connect.mutate()} disabled={connect.isPending}>
            {connect.isPending ? "Opening Slack…" : "Connect Slack"}
          </Button>
        )}
      </section>

      <section className="mb-6 rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
        <h2 className="mb-1 font-medium">Appearance</h2>
        <p className="mb-4 text-sm text-neutral-500">Figma is light-only; dark mode is our addition.</p>
        <Button variant="outline" onClick={toggle}>
          Switch to {theme === "dark" ? "light" : "dark"}
        </Button>
      </section>

      <section className="rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
        <h2 className="mb-1 font-medium">Queue dashboard</h2>
        <p className="mb-4 text-sm text-neutral-500">
          Live BullMQ visibility (login-gated) — also pinned in the left sidebar.
        </p>
        <a className="text-green-600 underline" href="/admin/queues" target="_blank" rel="noreferrer">
          Open bull-board ↗
        </a>
      </section>
    </div>
    </AppShell>
  );
}
