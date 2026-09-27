import { cn } from "../lib/cn.js";

export function Logo({ size = 28, withName = false }: { size?: number; withName?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      {/* Brand tile: the mark is light-grey (#E0E0E2, designed for dark surfaces),
          so it always sits on a dark chip — crisp in both themes. */}
      <span className="grid place-items-center rounded-lg bg-neutral-900 p-1 dark:bg-neutral-800">
        <img src="/logo.svg" alt="ReachInbox" width={size - 8} height={size - 8} />
      </span>
      {withName && (
        <span className="text-sm font-black tracking-[0.18em] text-neutral-900 dark:text-white">
          REACHINBOX
        </span>
      )}
    </span>
  );
}

export function logoClass(extra = ""): string {
  return cn("inline-flex items-center gap-2", extra);
}
