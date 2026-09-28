import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Avatar } from "../components/Avatar.js";
import { AppShell } from "../components/Sidebar.js";
import { useAuth, useCounts, useDeleteEmail, useEmailDetail, useStarEmail } from "../hooks/queries.js";
import { formatFull } from "../lib/format.js";
import { cn } from "../lib/cn.js";

export function DetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const me = useAuth();
  const counts = useCounts(Boolean(me.data));
  const detail = useEmailDetail(id);
  const star = useStarEmail();
  const del = useDeleteEmail();

  const email = detail.data?.email;
  const onDelete = () => {
    if (!id) return;
    if (!window.confirm(`Delete this ${email?.status ?? ""} email? A scheduled email will never send.`)) return;
    del.mutate(id, {
      onSuccess: () => {
        toast.success("Email deleted");
        navigate("/");
      },
      onError: (e: Error) => toast.error(e.message),
    });
  };

  // Auth states mirror Inbox: spinner while loading, login link on dead
  // session — never a blank page (e.g. expired session on a bookmarked URL).
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
    <div className="bg-white p-4 sm:p-6 dark:bg-neutral-950">
      <div className="mb-6 flex items-center gap-3">
        <Link to="/" className="text-xl" aria-label="Back">←</Link>
        <h1 className="truncate text-xl">{detail.data?.email.subject ?? "Email"}</h1>
        <div className="ml-auto flex items-center gap-3">
          {email && (
            <>
              <button
                type="button"
                title={email.starred ? "Unstar" : "Star"}
                aria-label={email.starred ? "Unstar" : "Star"}
                aria-pressed={email.starred}
                disabled={star.isPending}
                onClick={() => star.mutate({ id: email.id, starred: !email.starred })}
                className={cn(
                  "text-xl leading-none",
                  email.starred ? "text-yellow-500" : "text-neutral-400 hover:text-yellow-400",
                )}
              >
                {email.starred ? "★" : "☆"}
              </button>
              <button
                type="button"
                title="Delete"
                aria-label="Delete"
                disabled={del.isPending}
                onClick={onDelete}
                className="text-xl leading-none text-neutral-400 hover:text-red-600 disabled:opacity-40"
              >
                🗑
              </button>
            </>
          )}
          {me.data && <Avatar name={me.data.user.name} src={me.data.user.avatar} size={32} />}
        </div>
      </div>

      {detail.isLoading ? (
        <div className="mx-auto max-w-3xl animate-pulse">
          <div className="mb-3 h-5 w-1/3 rounded bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-40 rounded bg-neutral-200 dark:bg-neutral-700" />
        </div>
      ) : detail.isError || !detail.data ? (
        <div className="text-center">
          <p className="mb-3 text-red-600">Email not found.</p>
          <Link className="underline" to="/">Back to inbox</Link>
        </div>
      ) : (
        <article className="mx-auto max-w-3xl">
          <div className="mb-4 flex items-start gap-3">
            <Avatar name={detail.data.email.sender?.fromEmail ?? "S"} size={40} />
            <div>
              <div className="font-semibold">
                {detail.data.email.sender?.fromEmail?.split("@")[0] ?? "Sender"}{" "}
                <span className="font-normal text-neutral-400">&lt;{detail.data.email.sender?.fromEmail}&gt;</span>
              </div>
              <div className="text-sm text-neutral-500">to {detail.data.email.to}</div>
            </div>
            <time className="ml-auto text-sm text-neutral-500">
              {formatFull(detail.data.email.sentAt ?? detail.data.email.scheduledAt)}
            </time>
          </div>

          {/* Body is server-sanitized HTML (safe tags only) — render formatted. */}
          <div
            className="tiptap text-sm leading-relaxed"
            dangerouslySetInnerHTML={{ __html: detail.data.email.body ?? "" }}
          />

          <div className="mt-6 rounded-2xl border border-neutral-200 p-4 text-sm dark:border-neutral-800">
            <div className="mb-1 font-medium">Delivery</div>
            <dl className="grid grid-cols-[120px_1fr] gap-1 text-neutral-600 dark:text-neutral-300">
              <dt>Status</dt><dd>{detail.data.email.status}</dd>
              <dt>Scheduled</dt><dd>{formatFull(detail.data.email.scheduledAt)}</dd>
              <dt>Sent</dt><dd>{detail.data.email.sentAt ? formatFull(detail.data.email.sentAt) : "—"}</dd>
              {detail.data.email.previewUrl && (
                <>
                  <dt>Ethereal</dt>
                  <dd><a className="text-green-600 underline" href={detail.data.email.previewUrl} target="_blank" rel="noreferrer">Open preview ↗</a></dd>
                </>
              )}
              {detail.data.email.error && detail.data.email.status !== "scheduled" && (
                <>
                  <dt>Error</dt><dd className="text-red-600">{detail.data.email.error}</dd>
                </>
              )}
              {detail.data.email.error && detail.data.email.status === "scheduled" && (
                <>
                  <dt>Delayed</dt><dd className="text-amber-600">{detail.data.email.error}</dd>
                </>
              )}
            </dl>
          </div>
        </article>
      )}
    </div>
    </AppShell>
  );
}
