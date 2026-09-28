import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api.js";
import { AppShell } from "../components/Sidebar.js";
import { StatusPill } from "../components/Pill.js";
import { useAuth, useCounts } from "../hooks/queries.js";
import { formatFull } from "../lib/format.js";
import { cn } from "../lib/cn.js";
import type { QueueJobRow, QueueJobState, QueueStatus } from "@reachinbox/shared";

const STATES: QueueJobState[] = ["delayed", "waiting", "active", "completed", "failed"];

function StatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-3 sm:p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className={cn("text-xl font-semibold sm:text-2xl", tone)}>
        {value < 0 ? "—" : value.toLocaleString()}
      </div>
      <div className="text-xs capitalize text-neutral-500">{label}</div>
    </div>
  );
}

/**
 * Native live queue dashboard (spec: "live BullMQ dashboard for real-time queue
 * visibility"). Same BullMQ data as bull-board, but in-app: Figma styling, dark
 * mode, and rows scoped to the caller's own emails (no roles in this product —
 * everyone is admin of their own account).
 */
export function QueuesPage() {
  const me = useAuth();
  const counts = useCounts(Boolean(me.data));
  const qc = useQueryClient();
  const [state, setState] = useState<QueueJobState>("delayed");

  const status = useQuery({
    queryKey: ["queue-status"],
    queryFn: async (): Promise<QueueStatus> => (await api.get("/api/worker/status")).data,
    enabled: Boolean(me.data),
    refetchInterval: 3000,
  });

  const jobs = useQuery({
    queryKey: ["queue-jobs", state],
    queryFn: async (): Promise<{ state: QueueJobState; data: QueueJobRow[] }> =>
      (await api.get("/api/worker/jobs", { params: { state, limit: 30 } })).data,
    enabled: Boolean(me.data),
    refetchInterval: 3000,
  });

  const retry = useMutation({
    mutationFn: async (jobId: string) => (await api.post(`/api/worker/jobs/${jobId}/retry`)).data,
    onSuccess: () => {
      toast.success("Job requeued");
      qc.invalidateQueries({ queryKey: ["queue-jobs"] });
      qc.invalidateQueries({ queryKey: ["queue-status"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (me.isLoading) return <div className="p-10">Loading…</div>;
  if (me.isError || !me.data) {
    return (
      <div className="p-10">
        Login required. <a className="underline" href="/login">Go to login</a>
      </div>
    );
  }

  return (
    <AppShell user={me.data.user} counts={counts.data}>
      <main className="bg-white p-4 sm:p-6 dark:bg-neutral-950">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-medium sm:text-xl">Queues</h1>
          <span className="flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">
            <span className="relative flex h-2 w-2">
              <span className="absolute h-full w-full animate-ping rounded-full bg-green-500 opacity-60" />
              <span className="h-2 w-2 rounded-full bg-green-600" />
            </span>
            live · refreshes every 3s
          </span>
          <a
            href="/admin/queues"
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-xs text-neutral-400 underline hover:text-neutral-600"
          >
            Advanced (bull-board) ↗
          </a>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
          <StatCard label="delayed" value={status.data?.delayed ?? -1} tone="text-orange-600" />
          <StatCard label="waiting" value={status.data?.waiting ?? -1} tone="text-blue-600" />
          <StatCard label="active" value={status.data?.active ?? -1} tone="text-purple-600" />
          <StatCard label="completed" value={status.data?.completed ?? -1} tone="text-green-600" />
          <StatCard label="failed" value={status.data?.failed ?? -1} tone="text-red-600" />
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          {STATES.map((s) => (
            <button
              key={s}
              onClick={() => setState(s)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm capitalize",
                state === s
                  ? "bg-brand-50 font-semibold dark:bg-neutral-800"
                  : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800",
              )}
            >
              {s}
            </button>
          ))}
        </div>

        {jobs.isLoading ? (
          <div className="animate-pulse space-y-2" aria-label="Loading jobs">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 rounded-2xl bg-neutral-100 dark:bg-neutral-800" />
            ))}
          </div>
        ) : jobs.isError ? (
          <div className="p-10 text-center text-sm">
            <p className="mb-3 text-red-600">Failed to load jobs.</p>
            <button className="underline" onClick={() => jobs.refetch()}>Retry</button>
          </div>
        ) : jobs.data!.data.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
            <div className="text-4xl" aria-hidden>☰</div>
            <div className="font-medium">No {state} jobs</div>
            <p className="max-w-sm text-sm text-neutral-500">
              Jobs appear here as campaigns schedule. Delayed jobs carry their next fire time.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-neutral-100 dark:border-neutral-800">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-xs uppercase tracking-wide text-neutral-400 dark:border-neutral-800">
                  <th className="px-4 py-2.5 font-medium">To</th>
                  <th className="px-4 py-2.5 font-medium">Subject</th>
                  <th className="px-4 py-2.5 font-medium">Email status</th>
                  <th className="px-4 py-2.5 font-medium">Attempts</th>
                  <th className="px-4 py-2.5 font-medium">Fires / finished</th>
                  <th className="px-4 py-2.5 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {jobs.data!.data.map((j) => (
                  <tr key={j.jobId} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                    <td className="max-w-[180px] truncate px-4 py-3">
                      <Link to={`/email/${j.email.id}`} className="hover:underline">{j.email.to}</Link>
                    </td>
                    <td className="max-w-[220px] truncate px-4 py-3">{j.email.subject}</td>
                    <td className="px-4 py-3"><StatusPill status={j.email.status} /></td>
                    <td className="px-4 py-3 tabular-nums">{j.attemptsMade}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">
                      {j.finishedOn
                        ? formatFull(new Date(j.finishedOn).toISOString())
                        : state === "delayed"
                          ? "in " + Math.max(0, Math.round((j.timestamp + j.delay - Date.now()) / 1000)) + "s"
                          : "—"}
                      {j.failedReason && <div className="mt-1 max-w-[260px] truncate text-red-600" title={j.failedReason}>{j.failedReason}</div>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {state === "failed" && (
                        <button
                          onClick={() => retry.mutate(j.jobId)}
                          disabled={retry.isPending}
                          className="rounded-full border border-green-600 px-3 py-1 text-xs font-medium text-green-600 hover:bg-green-50 disabled:opacity-40"
                        >
                          Retry
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </AppShell>
  );
}
