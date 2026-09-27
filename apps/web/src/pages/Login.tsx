import { useState } from "react";
import { GoogleOAuthProvider, GoogleLogin, type CredentialResponse } from "@react-oauth/google";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { passwordLoginSchema, registerSchema } from "@reachinbox/shared";
import { api } from "../lib/api.js";
import { Input } from "../components/Input.js";
import { Logo } from "../components/Logo.js";

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";

type Mode = "signin" | "signup";

function GoogleSection({ onToken }: { onToken: (idToken: string) => void }) {
  const onGoogle = (res: CredentialResponse) => {
    if (!res.credential) return toast.error("Google sign-in returned no credential");
    onToken(res.credential);
  };
  if (!clientId) {
    return (
      <button
        className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-50 px-4 py-3 text-sm font-medium dark:bg-neutral-800"
        onClick={() => toast.error("Google client ID not configured — ask admin to set VITE_GOOGLE_CLIENT_ID")}
      >
        <span className="font-bold text-green-600">G</span> Login with Google
      </button>
    );
  }
  return (
    <div className="mb-4 flex justify-center">
      <GoogleLogin onSuccess={onGoogle} onError={() => toast.error("Google sign-in failed")} width="300" />
    </div>
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
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const google = useMutation({
    mutationFn: async (idToken: string) => (await api.post("/api/auth/google", { idToken })).data,
    onSuccess: () => navigate("/"),
    onError: (e: Error) => toast.error(e.message),
  });

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
          <GoogleSection onToken={(t) => google.mutate(t)} />
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
  const centered = (
    <div className="grid min-h-screen place-items-center bg-neutral-100 p-4 dark:bg-neutral-950">
      <div className="w-full max-w-md">
        <LoginCard />
        <p className="mt-4 text-center text-xs text-neutral-400">
          <Link to="/" className="underline">← Back</Link>
        </p>
      </div>
    </div>
  );
  if (!clientId) return centered;
  return (
    <GoogleOAuthProvider clientId={clientId}>
      {centered}
    </GoogleOAuthProvider>
  );
}
