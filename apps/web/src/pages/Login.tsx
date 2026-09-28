import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { passwordLoginSchema, registerSchema } from "@reachinbox/shared";
import { api } from "../lib/api.js";
import { Input } from "../components/Input.js";
import { Logo } from "../components/Logo.js";

type Mode = "signin" | "signup";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F5" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function GoogleSection() {
  const [pending, setPending] = useState(false);
  const start = async () => {
    setPending(true);
    try {
      const { url } = (await api.get("/api/auth/google/url")).data as { url: string };
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Google sign-in failed to start");
      setPending(false);
    }
  };
  // Redirect flow leaves this page: if the user backs out of Google without
  // finishing, the tab returns here with `pending` stuck on ("Opening
  // Google…"). Any return to the page means no redirect happened — reset.
  useEffect(() => {
    const reset = () => setPending(false);
    window.addEventListener("pageshow", reset);
    window.addEventListener("focus", reset);
    document.addEventListener("visibilitychange", reset);
    return () => {
      window.removeEventListener("pageshow", reset);
      window.removeEventListener("focus", reset);
      document.removeEventListener("visibilitychange", reset);
    };
  }, []);
  return (
    <button
      className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-50 px-4 py-3 text-sm font-medium disabled:opacity-50 dark:bg-neutral-800"
      onClick={() => void start()}
      disabled={pending}
    >
      <GoogleIcon />
      {pending ? "Opening Google…" : "Sign in with Google"}
    </button>
  );
}

function SigninForm() {
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.input<typeof passwordLoginSchema>, unknown, z.infer<typeof passwordLoginSchema>>({
    resolver: zodResolver(passwordLoginSchema),
  });
  const login = useMutation({
    mutationFn: async (v: z.infer<typeof passwordLoginSchema>) =>
      (await api.post("/api/auth/login", v)).data,
    onSuccess: () => navigate("/"),
    onError: (e: Error) => {
      if (e.message.includes("verify")) {
        toast.error(e.message, {
          action: { label: "Resend link", onClick: () => void resend() },
        });
      } else toast.error(e.message);
    },
  });
  const resend = async () => {
    const email = (document.getElementById("signin-email") as HTMLInputElement | null)?.value;
    if (!email) return toast.error("Type your email first");
    try {
      await api.post("/api/auth/resend-verification", { email });
      toast.success("Verification link re-sent — check your inbox");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Resend failed");
    }
  };
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={handleSubmit((v) => login.mutate(v))}
    >
      <div>
        <Input id="signin-email" placeholder="Email ID" autoComplete="email" {...register("email")} />
        {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
      </div>
      <div>
        <Input placeholder="Password" type="password" autoComplete="current-password" {...register("password")} />
        {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
      </div>
      <button
        type="submit"
        disabled={login.isPending}
        className="mt-1 w-full rounded-xl bg-green-600 px-4 py-3 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
      >
        {login.isPending ? "Logging in…" : "Login"}
      </button>
    </form>
  );
}

function SignupForm({ onDone }: { onDone: (email: string) => void }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.input<typeof registerSchema>, unknown, z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
  });
  const signup = useMutation({
    mutationFn: async (v: z.infer<typeof registerSchema>) =>
      (await api.post("/api/auth/register", v)).data as { message: string },
    onSuccess: (d, v) => {
      toast.success("Account created — verify your email to log in");
      onDone(v.email);
      void d;
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <form className="flex flex-col gap-3" onSubmit={handleSubmit((v) => signup.mutate(v))}>
      <div>
        <Input placeholder="Your name" autoComplete="name" {...register("name")} />
        {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
      </div>
      <div>
        <Input placeholder="Email ID" autoComplete="email" {...register("email")} />
        {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
      </div>
      <div>
        <Input placeholder="Password (min 6 chars)" type="password" autoComplete="new-password" {...register("password")} />
        {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
      </div>
      <button
        type="submit"
        disabled={signup.isPending}
        className="mt-1 w-full rounded-xl bg-green-600 px-4 py-3 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
      >
        {signup.isPending ? "Creating…" : "Create account"}
      </button>
    </form>
  );
}

function LoginCard() {
  const [mode, setMode] = useState<Mode>("signin");
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [search, setSearch] = useSearchParams();

  useEffect(() => {
    if (search.get("error") === "google_failed") {
      toast.error("Google sign-in failed — please try again");
      search.delete("error");
      setSearch(search, { replace: true });
    }
  }, [search, setSearch]);

  return (
    <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-8 sm:p-10 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-4 flex justify-center">
        <Logo withName />
      </div>
      <h1 className="mb-6 text-center text-3xl font-semibold">
        {pendingEmail ? "Check your inbox" : mode === "signin" ? "Login" : "Sign up"}
      </h1>

      {pendingEmail ? (
        <div className="text-center">
          <p className="mb-2 text-sm text-neutral-600 dark:text-neutral-300">
            We sent a verification link to <span className="font-semibold">{pendingEmail}</span>.
            It expires in 15 minutes — click it, then log in.
          </p>
          <button
            className="mt-3 text-sm font-medium text-green-600 underline"
            onClick={async () => {
              try {
                await api.post("/api/auth/resend-verification", { email: pendingEmail });
                toast.success("New link sent");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Resend failed");
              }
            }}
          >
            Didn't get it? Resend
          </button>
          <div className="mt-4">
            <button className="text-sm text-neutral-500 underline" onClick={() => { setPendingEmail(null); setMode("signin"); }}>
              Back to login
            </button>
          </div>
        </div>
      ) : (
        <>
          <GoogleSection />
          <div className="mb-5 flex items-center gap-3 text-xs text-neutral-400">
            <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
            or {mode === "signin" ? "login" : "sign up"} through email
            <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
          </div>
          {mode === "signin" ? <SigninForm /> : <SignupForm onDone={(email) => setPendingEmail(email)} />}
          <p className="mt-4 text-center text-sm text-neutral-500">
            {mode === "signin" ? (
              <>New here? <button className="font-medium text-green-600 underline" onClick={() => setMode("signup")}>Create an account</button></>
            ) : (
              <>Have an account? <button className="font-medium text-green-600 underline" onClick={() => setMode("signin")}>Log in</button></>
            )}
          </p>
        </>
      )}
    </div>
  );
}

export function LoginPage() {
  return (
    <div className="grid min-h-screen place-items-center bg-neutral-100 p-4 dark:bg-neutral-950">
      <div className="w-full max-w-md">
        <LoginCard />
        <p className="mt-4 text-center text-xs text-neutral-400">
          <Link to="/" className="underline">← Back</Link>
        </p>
      </div>
    </div>
  );
}
