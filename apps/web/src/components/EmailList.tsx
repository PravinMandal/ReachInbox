import { Link } from "react-router-dom";
import type { EmailRow } from "@reachinbox/shared";
import { SentPill, StatusPill, TimePill } from "./Pill.js";
import { useStarEmail } from "../hooks/queries.js";
import { cn } from "../lib/cn.js";

export function EmailRow({ row, tab }: { row: EmailRow; tab: "scheduled" | "sent" }) {
  const star = useStarEmail();
  return (
    <Link
      to={`/email/${row.id}`}
      className="flex items-center gap-3 border-b border-neutral-100 px-4 py-3.5 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/50"
    >
      <span className="w-40 shrink-0 truncate text-sm font-medium">To: {row.to}</span>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {tab === "scheduled" ? (
          <TimePill when={row.scheduledAt} />
        ) : row.status === "failed" ? (
          <StatusPill status="failed" />
        ) : (
          <SentPill />
        )}
        <span className="truncate text-sm">
          <span className="font-medium">{row.subject}</span>
        </span>
      </span>
      <button
        type="button"
        title={row.starred ? "Unstar" : "Star"}
        aria-label={row.starred ? "Unstar" : "Star"}
        aria-pressed={row.starred}
        disabled={star.isPending}
        onClick={(e) => {
          e.preventDefault();
          star.mutate({ id: row.id, starred: !row.starred });
        }}
        className={cn(
          "shrink-0 text-lg leading-none",
          row.starred ? "text-yellow-500" : "text-neutral-300 hover:text-yellow-400 dark:text-neutral-600",
        )}
      >
        {row.starred ? "★" : "☆"}
      </button>
    </Link>
  );
}

export function EmailListSkeleton() {
  return (
    <div className="divide-y divide-neutral-100 dark:divide-neutral-800" aria-label="Loading emails">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-3 px-4 py-4">
          <div className="h-4 w-32 rounded bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-5 w-32 rounded-full bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-4 flex-1 rounded bg-neutral-200 dark:bg-neutral-700" />
        </div>
      ))}
    </div>
  );
}

export function EmailEmpty({ tab }: { tab: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-20 text-center">
      <div className="text-4xl" aria-hidden>
        {tab === "sent" ? "📭" : "🗓"}
      </div>
      <div className="font-medium">No {tab} emails</div>
      <p className="max-w-sm text-sm text-neutral-500">
        {tab === "sent"
          ? "Sent emails will appear here once the worker delivers them."
          : "Schedule your first campaign from Compose — staggered delays + hourly caps handled for you."}
      </p>
    </div>
  );
}
