import { formatWhen } from "../lib/format.js";

export function TimePill({ when, title }: { when: string; title?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-1 text-xs font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"
      title={title}
    >
      <span aria-hidden>◷</span> {formatWhen(when)}
    </span>
  );
}

export function SentPill() {
  return (
    <span className="inline-flex items-center rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
      Sent
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  if (status === "sent") return <SentPill />;
  if (status === "failed")
    return (
      <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-300">
        Failed
      </span>
    );
  return (
    <span className="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-green-700 dark:bg-neutral-800 dark:text-green-400">
      {status}
    </span>
  );
}
