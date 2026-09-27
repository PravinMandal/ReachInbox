import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { Logo } from "../components/Logo.js";

type State = "working" | "ok" | "bad";

/**
 * Landing for verification links (`/verify-email?token=…`). Calls the backend,
 * which marks the account verified and sets the session cookie, then shows the
 * outcome with a path into the app.
 */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState<State>("working");
  const [email, setEmail] = useState("");

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setState("bad");
      return;
    }
    api
      .get("/api/auth/verify-email", { params: { token } })
      .then((r) => {
        setEmail((r.data as { user: { email: string } }).user.email);
        setState("ok");
      })
      .catch(() => setState("bad"));
  }, [params]);

  return (
    <div className="grid min-h-screen place-items-center bg-neutral-100 p-4 dark:bg-neutral-950">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-8 text-center sm:p-10 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-4 flex justify-center">
          <Logo withName />
        </div>
        {state === "working" && (
          <>
            <h1 className="mb-2 text-2xl font-semibold">Verifying…</h1>
            <p className="text-sm text-neutral-500">One moment while we confirm your email.</p>
          </>
        )}
        {state === "ok" && (
          <>
            <div className="mb-3 text-5xl" aria-hidden>✅</div>
            <h1 className="mb-2 text-2xl font-semibold">Email verified!</h1>
            <p className="mb-6 text-sm text-neutral-500">
              {email} is confirmed. You're logged in — welcome to ReachInbox.
            </p>
            <button
              onClick={() => navigate("/")}
              className="w-full rounded-xl bg-green-600 px-4 py-3 text-sm font-medium text-white hover:bg-green-700"
            >
              Go to dashboard →
            </button>
          </>
        )}
        {state === "bad" && (
          <>
            <div className="mb-3 text-5xl" aria-hidden>❌</div>
            <h1 className="mb-2 text-2xl font-semibold">Link invalid or expired</h1>
            <p className="mb-6 text-sm text-neutral-500">
              Verification links last 15 minutes. Head back to login and request a fresh one.
            </p>
            <Link
              to="/login"
              className="block w-full rounded-xl bg-green-600 px-4 py-3 text-sm font-medium text-white hover:bg-green-700"
            >
              Back to login
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
