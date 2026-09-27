import { Router } from "express";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { passwordLoginSchema, registerSchema } from "@reachinbox/shared";
import { prisma } from "../db.js";
import {
  authMiddleware,
  clearAuthCookie,
  comparePassword,
  consumeLoginTicket,
  ensureDevUser,
  hashPassword,
  linkGoogleUser,
  mintLoginTicket,
  safeUserSelect,
  setAuthCookie,
  signToken,
  signVerifyToken,
  verifyGoogleIdToken,
  verifyVerifyToken,
} from "../auth.js";
import { env } from "../env.js";
import { ensureEtherealPool } from "../mailer.js";
import { sendVerificationMail, verifyMailConfigured } from "../verify-mail.js";
import { logger } from "../logger.js";

export const authRouter = Router();
authRouter.use(rateLimit({ windowMs: 60_000, max: 30 }));

function verificationLink(token: string): string {
  return `${env.FRONTEND_URL.replace(/\/$/, "")}/verify-email?token=${token}`;
}

authRouter.post("/google", async (req, res, next) => {
  try {
    const { idToken } = req.body as { idToken?: string };
    if (!idToken) return res.status(400).json({ error: { code: "BAD_REQUEST", message: "idToken required" } });
    if (!env.GOOGLE_CLIENT_ID) {
      return res.status(500).json({ error: { code: "NOT_CONFIGURED", message: "GOOGLE_CLIENT_ID not set" } });
    }
    const g = await verifyGoogleIdToken(idToken);
    const user = await linkGoogleUser(g);
    await ensureEtherealPool(user.id, user.email).catch((e) => logger.warn({ e }, "sender pool seed failed"));
    setAuthCookie(res, signToken(user.id));
    return res.json({ user: { id: user.id, email: user.email, name: user.name, avatar: user.avatar } });
  } catch (err) {
    next(err);
  }
});

/**
 * Server-side Google OAuth (authorization-code flow). The GIS popup button
 * never rendered its iframe on Vercel (blank in every browser, zero backend
 * contact), so login goes through a full-page redirect instead: frontend
 * links to /google/url → user consents at Google → Google calls back here
 * with ?code= → we exchange, verify, and bounce to the app with a
 * single-use login ticket that the SPA redeems same-origin (see /consume).
 *
 * Why a ticket instead of setting the session cookie in the callback?
 * The callback lives on the API host while the app lives on the web host —
 * two vercel.app subdomains are cross-site (public suffix), so a cookie
 * written in the callback is dropped by Brave/Chrome before /me runs.
 * The ticket (short-lived, purpose-bound, single-use via Redis NX/GETDEL)
 * carries the login across hosts without any cross-site cookie. As a bonus,
 * only ONE stable callback URI ever needs registering in the Google console,
 * so preview/alias domains keep working with zero console edits.
 *
 * State is a short-lived signed JWT (NOT a cookie): Brave drops cookies set
 * in the third-party XHR that mints the auth URL, so a cookie-bound state
 * never comes back on the top-level return navigation.
 */
const OAUTH_STATE_PURPOSE = "oauth_state";

function signState(): string {
  return jwt.sign({ nonce: randomBytes(16).toString("hex"), purpose: OAUTH_STATE_PURPOSE }, env.JWT_SECRET, {
    expiresIn: "10m",
  });
}

function verifyState(state: string): void {
  const decoded = jwt.verify(state, env.JWT_SECRET) as { purpose?: string };
  if (decoded.purpose !== OAUTH_STATE_PURPOSE) throw new Error("Invalid oauth state");
}

authRouter.get("/google/url", (_req, res) => {
  if (!env.GOOGLE_CLIENT_ID) {
    return res.status(500).json({ error: { code: "NOT_CONFIGURED", message: "GOOGLE_CLIENT_ID not set" } });
  }
  const state = signState();
  const url = new OAuth2Client(env.GOOGLE_CLIENT_ID).generateAuthUrl({
    access_type: "online",
    scope: ["openid", "email", "profile"],
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    state,
    prompt: "select_account",
  });
  return res.json({ url });
});

authRouter.get("/google/callback", async (req, res) => {
  const fail = () =>
    res.redirect(`${env.FRONTEND_URL.replace(/\/$/, "")}/login?error=google_failed`);
  try {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state) return fail();
    try {
      verifyState(state);
    } catch {
      return fail();
    }
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return fail();
    const client = new OAuth2Client(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      env.GOOGLE_REDIRECT_URI,
    );
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) return fail();
    const g = await verifyGoogleIdToken(tokens.id_token);
    const user = await linkGoogleUser(g);
    await ensureEtherealPool(user.id, user.email).catch((e) => logger.warn({ e }, "sender pool seed failed"));
    // No cookie here (cross-site write — see header comment). Mint a
    // single-use ticket; the SPA redeems it same-origin via /consume.
    const ticket = await mintLoginTicket(user.id);
    return res.redirect(`${env.FRONTEND_URL.replace(/\/$/, "")}/?ticket=${ticket}`);
  } catch (err) {
    logger.warn({ err }, "google callback failed");
    return fail();
  }
});

/**
 * Redeem a single-use login ticket (same-origin — the session cookie set here
 * is first-party, so ITP/Brave Shields leave it alone). Ticket is consumed
 * atomically: replaying it (back button, double submit) fails closed.
 */
authRouter.post("/google/consume", async (req, res, next) => {
  try {
    const { ticket } = req.body as { ticket?: string };
    if (!ticket) {
      return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Ticket required" } });
    }
    let userId: string;
    try {
      userId = await consumeLoginTicket(String(ticket));
    } catch {
      return res.status(401).json({ error: { code: "INVALID_TICKET", message: "Login expired — please sign in again" } });
    }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: safeUserSelect });
    if (!user) return res.status(401).json({ error: { code: "INVALID_TICKET", message: "Login expired — please sign in again" } });
    setAuthCookie(res, signToken(userId));
    return res.json({ user });
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", async (req, res) => {
  if (env.DEV_AUTH_BYPASS && process.env.NODE_ENV !== "production") {
    const stub = await ensureDevUser();
    if (stub) return res.json({ user: stub, dev: true });
  }
  const token =
    (req.cookies?.token as string | undefined) ??
    req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Login required" } });
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as { sub: string };
    if (decoded.sub === "dev-user") {
      const stub = await ensureDevUser();
      return res.json({ user: stub, dev: true });
    }
    const user = await prisma.user.findUnique({ where: { id: decoded.sub } });
    if (!user) return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Unknown user" } });
    return res.json({ user: { id: user.id, email: user.email, name: user.name, avatar: user.avatar } });
  } catch {
    return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Invalid session" } });
  }
});

authRouter.post("/logout", (_req, res) => {
  clearAuthCookie(res);
  res.status(204).end();
});

/**
 * Email+password auth (mirrors the MoonSeek project on our stack):
 * register → verification mail (Gmail OAuth2, reaches real inboxes) →
 * verify link (15m JWT) → login. Google OAuth flow above is untouched.
 */

authRouter.post("/register", async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { code: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "Invalid input" },
      });
    }
    const { name, email, password } = parsed.data;
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      return res.status(409).json({ error: { code: "EMAIL_TAKEN", message: "Email already registered" } });
    }
    const user = await prisma.user.create({
      data: { email, name, passwordHash: await hashPassword(password), isVerified: false },
      select: safeUserSelect,
    });
    await ensureEtherealPool(user.id, user.email).catch((e) => logger.warn({ e }, "sender pool seed failed"));
    try {
      await sendVerificationMail(user.email, verificationLink(signVerifyToken(user.id)), user.name);
    } catch (err) {
      // Don't block register on mail failure (MoonSeek pattern) — resend covers it.
      logger.warn({ err }, "verification mail failed");
    }
    return res.status(201).json({
      user,
      message: verifyMailConfigured()
        ? "Registered. Check your email to verify (link expires in 15 minutes)."
        : "Registered. Mail service is not configured — ask the admin, then resend verification.",
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const parsed = passwordLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { code: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "Invalid input" },
      });
    }
    const { email, password } = parsed.data;
    // Uniform message either way — no user enumeration.
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash || !(await comparePassword(password, user.passwordHash))) {
      return res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Invalid credentials" } });
    }
    if (!user.isVerified) {
      return res.status(403).json({
        error: { code: "EMAIL_NOT_VERIFIED", message: "Please verify your email before login" },
      });
    }
    setAuthCookie(res, signToken(user.id));
    return res.json({
      user: { id: user.id, email: user.email, name: user.name, avatar: user.avatar },
    });
  } catch (err) {
    next(err);
  }
});

authRouter.get("/verify-email", async (req, res, next) => {
  try {
    const token = String(req.query.token ?? "");
    if (!token) {
      return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Token required" } });
    }
    let userId: string;
    try {
      userId = verifyVerifyToken(token);
    } catch {
      return res.status(400).json({ error: { code: "INVALID_TOKEN", message: "Invalid or expired token" } });
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: { code: "NOT_FOUND", message: "User not found" } });
    if (!user.isVerified) await prisma.user.update({ where: { id: userId }, data: { isVerified: true } });
    setAuthCookie(res, signToken(userId));
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: safeUserSelect });
    return res.json({ user: fresh, message: "Email verified" });
  } catch (err) {
    next(err);
  }
});

/** Re-send verification. Always 200 — no enumeration. */
authRouter.post("/resend-verification", async (req, res, next) => {
  try {
    const { email } = req.body as { email?: string };
    if (typeof email === "string" && email.includes("@")) {
      const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
      if (user && !user.isVerified) {
        try {
          await sendVerificationMail(user.email, verificationLink(signVerifyToken(user.id)), user.name);
        } catch (err) {
          logger.warn({ err }, "resend verification mail failed");
        }
      }
    }
    return res.json({ message: "If an unverified account exists for that email, a new link is on its way." });
  } catch (err) {
    next(err);
  }
});

export const authedMe = authMiddleware;
