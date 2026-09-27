import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AppShell } from "../components/Sidebar.js";
import { EmailEmpty, EmailListSkeleton, EmailRow } from "../components/EmailList.js";
import { useAuth, useCounts, useEmails } from "../hooks/queries.js";

export function InboxPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "sent" ? "sent" : "scheduled";
  const [raw, setRaw] = useState(params.get("q") ?? "");
  const [q, setQ] = useState(params.get("q") ?? "");
  const [page, setPage] = useState(1);

  // 300ms debounce for search (spec: good UX, fewer ES hits).
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(raw);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [raw]);

  const me = useAuth();
  const counts = useCounts(Boolean(me.data));
  const list = useEmails({ status: tab, q: q.trim() || undefined, page, enabled: Boolean(me.data) });

  // Landing spot after Google OAuth callback (?login=google) — greet once.
  useEffect(() => {
    if (params.get("login") === "google") {
      toast.success("Signed in with Google");
      const next = new URLSearchParams(params);
      next.delete("login");
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  if (me.isLoading) return <div className="p-10">Loading…</div>;
  if (me.isError || !me.data) {
    return (
      <div className="p-10">
        Login required. <a className="underline" href="/login">Go to login</a>
      </div>
    );
  }

  const switchTab = (t: "scheduled" | "sent") => {
    setParams({ tab: t });
    setPage(1);
  };

  return (
    <AppShell user={me.data.user} counts={counts.data}>
      <main className="bg-white p-4 sm:p-6 dark:bg-neutral-950">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex flex-1 items-center gap-2 rounded-full bg-neutral-100 px-4 py-2.5 dark:bg-neutral-800">
            <span aria-hidden className="text-neutral-400">⌕</span>
            <input
              className="w-full bg-transparent text-sm outline-none placeholder:text-neutral-400"
              placeholder="Search"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
            />
          </div>
          <button
            className="rounded-full p-2 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            title="Refresh"
            onClick={() => list.refetch()}
          >
            ⟳
          </button>
          {list.data?.source === "db-fallback" && (
            <span
              className="rounded-full bg-yellow-100 px-3 py-1 text-xs text-yellow-800"
              title={list.data.warning}
            >
              index offline — DB fallback
            </span>
          )}
        </div>

        <div className="mb-2 flex gap-2 text-sm">
          {(["scheduled", "sent"] as const).map((t) => (
            <button
              key={t}
              onClick={() => switchTab(t)}
              className={`rounded-full px-4 py-1.5 capitalize ${tab === t ? "bg-brand-50 font-semibold dark:bg-neutral-800" : "text-neutral-500"}`}
            >
              {t}
            </button>
          ))}
        </div>

        {list.isLoading ? (
          <EmailListSkeleton />
        ) : list.isError ? (
          <div className="p-10 text-center">
            <p className="mb-3 text-sm text-red-600">Failed to load emails.</p>
            <button className="underline" onClick={() => list.refetch()}>
              Retry
            </button>
          </div>
        ) : !list.data || list.data.data.length === 0 ? (
          <EmailEmpty tab={tab} />
        ) : (
          <>
            <div className="divide-y divide-neutral-100 rounded-2xl border border-neutral-100 dark:divide-neutral-800 dark:border-neutral-800">
              {list.data.data.map((row) => (
                <EmailRow key={row.id} row={row} tab={tab === "sent" ? "sent" : "scheduled"} />
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between text-sm text-neutral-500">
              <span>
                Page {list.data.page} of {Math.max(1, Math.ceil(list.data.total / list.data.limit))} ·{" "}
                {list.data.total} total
              </span>
              <div className="flex gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="rounded-full border px-3 py-1 disabled:opacity-40"
                >
                  Prev
                </button>
                <button
                  disabled={page * list.data.limit >= list.data.total}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded-full border px-3 py-1 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </AppShell>
  );
}
