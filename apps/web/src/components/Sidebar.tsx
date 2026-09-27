import { useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api.js";
import { Avatar } from "./Avatar.js";
import { Button } from "./Button.js";
import { Logo } from "./Logo.js";
import { ThemeToggle } from "./ThemeToggle.js";
import type { User } from "@reachinbox/shared";

function navItem(active: boolean): string {
  return `flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm ${active ? "bg-brand-50 font-semibold text-neutral-900 dark:bg-neutral-800 dark:text-white" : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"}`;
}

function SidebarBody({
  user,
  counts,
  onNavigate,
}: {
  user: User;
  counts?: { scheduled: number; sent: number };
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const go = (to: string) => {
    onNavigate?.();
    navigate(to);
  };
  // NavLink alone can't distinguish `/?tab=scheduled` from `/?tab=sent` (same
  // pathname — both rendered active). Compute the active tab from the URL.
  const onInbox = location.pathname === "/";
  const tab = params.get("tab") === "sent" ? "sent" : "scheduled";
  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center gap-2 rounded-2xl bg-neutral-50 p-2.5 dark:bg-neutral-800">
        <Avatar name={user.name} src={user.avatar} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{user.name}</div>
          <div className="truncate text-xs text-neutral-500">{user.email}</div>
        </div>
      </div>

      <Button variant="outline" onClick={() => go("/compose")}>
        Compose
      </Button>

      <nav className="flex flex-col gap-1">
        <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-neutral-400">
          Core
        </div>
        <NavLink to="/?tab=scheduled" onClick={onNavigate} className={() => navItem(onInbox && tab === "scheduled")}>
          <span aria-hidden>◷</span> Scheduled
          <span className="ml-auto text-xs text-neutral-400">{counts?.scheduled ?? "—"}</span>
        </NavLink>
        <NavLink to="/?tab=sent" onClick={onNavigate} className={() => navItem(onInbox && tab === "sent")}>
          <span aria-hidden>➤</span> Sent
          <span className="ml-auto text-xs text-neutral-400">{counts?.sent ?? "—"}</span>
        </NavLink>
        {/* Native live queue dashboard (in-app). bull-board remains mounted at
            /admin/queues for advanced debugging, linked from the Queues page. */}
        <NavLink to="/queues" onClick={onNavigate} className={({ isActive }) => navItem(isActive)}>
          <span aria-hidden>☰</span> Queues
          <span className="ml-auto flex items-center gap-1 text-xs text-green-600">
            <span className="relative flex h-2 w-2">
              <span className="absolute h-full w-full animate-ping rounded-full bg-green-500 opacity-60" />
              <span className="h-2 w-2 rounded-full bg-green-600" />
            </span>
            live
          </span>
        </NavLink>
      </nav>

      {/* Pinned to the bottom, away from the mail groups. */}
      <nav className="mt-auto flex flex-col gap-1">
        <NavLink to="/settings" onClick={onNavigate} className={({ isActive }) => navItem(isActive)}>
          <span aria-hidden>⚙</span> Settings
        </NavLink>
      </nav>
    </div>
  );
}

function LogoutIconButton() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const logout = useMutation({
    mutationFn: async () => api.post("/api/auth/logout"),
    onSuccess: () => {
      qc.clear();
      navigate("/login");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <button
      onClick={() => logout.mutate()}
      title="Logout"
      aria-label="Logout"
      className="grid h-9 w-9 place-items-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>
    </button>
  );
}

/**
 * App shell: top header (logo ··· theme toggle + logout icons) + responsive
 * sidebar (static ≥md, slide-in drawer <md) + content.
 */
export function AppShell({ user, counts, children }: { user: User; counts?: { scheduled: number; sent: number }; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-neutral-200 bg-white/90 px-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90 sm:px-4">
        <button
          className="grid h-9 w-9 place-items-center rounded-full text-neutral-600 hover:bg-neutral-100 md:hidden dark:text-neutral-300 dark:hover:bg-neutral-800"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
        >
          ☰
        </button>
        <Logo withName />
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <LogoutIconButton />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[260px] shrink-0 border-r border-neutral-200 bg-white md:block dark:border-neutral-800 dark:bg-neutral-900">
          <SidebarBody user={user} counts={counts} />
        </aside>

        {/* Mobile drawer */}
        <div
          className={`fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
          onClick={() => setOpen(false)}
          aria-hidden
        />
        <aside
          className={`fixed inset-y-0 left-0 z-50 w-[280px] max-w-[85vw] bg-white shadow-xl transition-transform duration-300 ease-out md:hidden dark:bg-neutral-900 ${open ? "translate-x-0" : "-translate-x-full"}`}
          aria-label="Menu"
        >
          <div className="flex items-center justify-between p-4 pb-0">
            <Logo withName />
            <button
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="grid h-9 w-9 place-items-center rounded-full text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              ✕
            </button>
          </div>
          <SidebarBody user={user} counts={counts} onNavigate={() => setOpen(false)} />
        </aside>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
