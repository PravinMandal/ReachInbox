import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { extractEmails, type ScheduleResult } from "@reachinbox/shared";
import { api } from "../lib/api.js";
import { useAuth, useCounts, useSenders } from "../hooks/queries.js";
import { Button } from "../components/Button.js";
import { AppShell } from "../components/Sidebar.js";
import { RichEditor } from "../components/Editor.js";
import { cn } from "../lib/cn.js";

/** Client-side mirror of the server contract — server re-validates everything. */
const formSchema = z.object({
  from: z.string().optional().default(""),
  toText: z.string().default(""),
  subject: z.string().trim().min(1, "Subject is required").max(300),
  body: z.string().trim().min(1, "Body is required").max(100_000),
  delaySec: z.coerce.number().int().min(0).max(3600).default(2),
  hourlyLimit: z.coerce.number().int().min(1).max(10_000).default(200),
  startAt: z.string().min(1, "Start time is required"),
});

type FormValues = z.infer<typeof formSchema>;

function defaultStartAt(): string {
  return new Date(Date.now() + 60_000).toISOString().slice(0, 16);
}

export function ComposePage() {
  const navigate = useNavigate();
  const me = useAuth();
  const counts = useCounts(Boolean(me.data));
  const senders = useSenders(Boolean(me.data));
  const [showLater, setShowLater] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileCount, setFileCount] = useState(0);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors },
  } = useForm<z.input<typeof formSchema>, unknown, FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      from: "",
      toText: "",
      subject: "",
      body: "",
      delaySec: 2,
      hourlyLimit: 200,
      startAt: defaultStartAt(),
    },
  });

  const toText = watch("toText");
  const startAt = watch("startAt");
  const bodyHtml = watch("body");
  const recipients = extractEmails(toText);
  const chips = recipients.slice(0, 3);
  const extra = recipients.length - chips.length;

  const pickFile = async (f: File | null) => {
    setFile(f);
    if (!f) return setFileCount(0);
    const text = await f.text().catch(() => "");
    setFileCount(extractEmails(text).length);
  };

  const schedule = useMutation({
    mutationFn: async (v: FormValues): Promise<ScheduleResult> => {
      if (recipients.length + fileCount === 0) {
        throw new Error("Add at least one recipient or upload a lead list.");
      }
      // Rich-text submits HTML ("<p></p>" when visually empty) — check real text.
      const text = v.body.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
      if (!text) {
        setError("body", { message: "Body is required" });
        throw new Error("Body is required");
      }
      const fd = new FormData();
      fd.append("subject", v.subject);
      fd.append("body", v.body);
      fd.append("startAt", new Date(v.startAt).toISOString());
      fd.append("delaySec", String(v.delaySec));
      fd.append("hourlyLimit", String(v.hourlyLimit));
      if (v.from) fd.append("from", v.from);
      if (recipients.length > 0) fd.append("to", JSON.stringify(recipients));
      if (file) fd.append("leads", file);
      const res = await api.post("/api/campaigns/schedule", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return res.data as ScheduleResult;
    },
    onSuccess: (r) => {
      toast.success(`Scheduled ${r.total} emails`, { description: r.note });
      navigate("/?tab=scheduled");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pickTomorrow = (h: number) => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(h, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    setValue(
      "startAt",
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
    );
  };

  if (!me.data) return null;

  return (
    <AppShell user={me.data.user} counts={counts.data}>
    <div className="bg-white p-4 sm:p-6 dark:bg-neutral-950">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-xl" aria-label="Back">←</button>
        <h1 className="text-lg font-medium sm:text-xl">Compose New Email</h1>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-green-600" title={file ? file.name : "No attachment"}>🖇{file ? "₁" : ""}</span>
          <button onClick={() => setShowLater((s) => !s)} className="text-green-600" title="Pick start time">◷</button>
          <Button variant="outline" onClick={() => setShowLater(true)}>Send Later</Button>
        </div>
      </div>

      <form
        className="mx-auto max-w-4xl"
        onSubmit={handleSubmit((v) => {
          setShowLater(false);
          schedule.mutate(v);
        })}
      >
        <div className="mb-4 flex items-center gap-4 border-b border-neutral-100 pb-3 dark:border-neutral-800">
          <span className="w-16 text-sm">From</span>
          <select
            className="rounded-lg bg-neutral-100 px-3 py-2 text-sm dark:bg-neutral-800"
            {...register("from")}
          >
            <option value="">Select sender…</option>
            {senders.data?.senders.map((s) => (
              <option key={s.id} value={s.fromEmail}>{s.fromEmail}</option>
            ))}
          </select>
        </div>

        <div className="mb-4 flex items-center gap-4 border-b border-neutral-100 pb-3 dark:border-neutral-800">
          <span className="w-16 text-sm">To</span>
          <div className="flex flex-1 flex-wrap items-center gap-1.5">
            {chips.map((c) => (
              <span key={c} className="rounded-full border border-green-500 px-2.5 py-1 text-xs">{c}</span>
            ))}
            {extra > 0 && <span className="rounded-full border px-2.5 py-1 text-xs">+{extra}</span>}
            <input
              className="min-w-[200px] flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-400"
              placeholder={recipients.length ? "Add more…" : "recipient@example.com"}
              {...register("toText")}
            />
          </div>
          <label className="cursor-pointer text-sm font-medium text-green-600">
            ⬆ Upload List
            <input
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        {(recipients.length > 0 || fileCount > 0) && (
          <p className="mb-3 text-xs text-neutral-500">
            {recipients.length} typed + {fileCount} from file{file ? ` (${file.name})` : ""} — deduped on the server.
          </p>
        )}

        <div className="mb-4 flex items-center gap-4 border-b border-neutral-100 pb-3 dark:border-neutral-800">
          <span className="w-16 text-sm">Subject</span>
          <div className="flex-1">
            <input
              className="w-full bg-transparent text-sm outline-none placeholder:text-neutral-400"
              placeholder="Subject"
              {...register("subject")}
            />
            {errors.subject && <p className="mt-1 text-xs text-red-600">{errors.subject.message}</p>}
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-6 text-sm">
          <label className="flex items-center gap-2">
            Delay between 2 emails
            <input
              className={cn(
                "w-16 rounded-lg border px-2 py-1.5 text-center dark:bg-neutral-800",
                errors.delaySec ? "border-red-400" : "border-neutral-200 dark:border-neutral-700",
              )}
              placeholder="00"
              inputMode="numeric"
              {...register("delaySec")}
            />
            <span className="text-xs text-neutral-400">sec</span>
          </label>
          <label className="flex items-center gap-2">
            Hourly Limit
            <input
              className={cn(
                "w-16 rounded-lg border px-2 py-1.5 text-center dark:bg-neutral-800",
                errors.hourlyLimit ? "border-red-400" : "border-neutral-200 dark:border-neutral-700",
              )}
              placeholder="00"
              inputMode="numeric"
              {...register("hourlyLimit")}
            />
          </label>
          {(errors.delaySec || errors.hourlyLimit) && (
            <p className="w-full text-xs text-red-600">
              {errors.delaySec?.message ?? errors.hourlyLimit?.message}
            </p>
          )}
        </div>

        <div className="rounded-2xl bg-neutral-50 p-4 dark:bg-neutral-900">
          <RichEditor
            value={bodyHtml}
            onChange={(html) => setValue("body", html, { shouldValidate: true })}
            error={errors.body?.message}
          />
        </div>

        {showLater && (
          <div className="fixed right-6 top-20 w-72 rounded-2xl border border-neutral-200 bg-white p-4 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
            <h3 className="mb-3 font-medium">Send Later</h3>
            <label className="mb-2 block text-sm text-neutral-500">
              Pick date &amp; time
              <input
                type="datetime-local"
                className="mt-1 w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800"
                value={startAt}
                onChange={(e) => setValue("startAt", e.target.value)}
              />
            </label>
            {[10, 11, 15].map((h) => (
              <button
                key={h}
                type="button"
                className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                onClick={() => pickTomorrow(h)}
              >
                Tomorrow, {h > 12 ? `${h - 12}:00 PM` : `${h}:00 AM`}
              </button>
            ))}
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="px-3 py-1.5 text-sm" onClick={() => setShowLater(false)}>Cancel</button>
              <Button type="button" variant="outline" onClick={() => setShowLater(false)}>
                Done
              </Button>
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <Button type="submit" disabled={schedule.isPending}>
            {schedule.isPending
              ? "Scheduling…"
              : recipients.length + fileCount > 0
                ? `Schedule ${recipients.length + fileCount}`
                : "Schedule"}
          </Button>
        </div>
      </form>
    </div>
    </AppShell>
  );
}
