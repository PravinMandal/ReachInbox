import type { NextFunction, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import { prisma } from "./db.js";
import { env, isProd } from "./env.js";
import { logger } from "./logger.js";

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);
const COOKIE = "token";
const VERIFY_PURPOSE = "email_verify";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
}

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: "7d" });
}

/** Password hashing (bcrypt, cost 10 — same as the MoonSeek project). */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(candidate: string, hash: string): Promise<boolean> {
  return bcrypt.compare(candidate, hash);
}

/** Short-lived email-verification token (mirrors MoonSeek: purpose + 15m). */
export function signVerifyToken(userId: string): string {
  return jwt.sign({ sub: userId, purpose: VERIFY_PURPOSE }, env.JWT_SECRET, { expiresIn: "15m" });
}

export function verifyVerifyToken(token: string): string {
  const decoded = jwt.verify(token, env.JWT_SECRET) as { sub?: string; purpose?: string };
  if (!decoded.sub || decoded.purpose !== VERIFY_PURPOSE) throw new Error("Invalid token purpose");
  return decoded.sub;
}

/** Columns safe to expose for the session user — passwordHash never leaves. */
export const safeUserSelect = { id: true, email: true, name: true, avatar: true } as const;

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    maxAge: 7 * 24 * 3600 * 1000,
    path: "/",
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(COOKIE, { path: "/" });
}

function devBypassUser(): AuthUser | null {
  if (!env.DEV_AUTH_BYPASS || isProd) return null;
  return { id: "dev-user", email: env.DEV_USER_EMAIL, name: "Oliver Brown", avatar: null };
}

export async function verifyGoogleIdToken(
  idToken: string,
): Promise<{ googleId: string; email: string; name: string; avatar: string | null }> {
  const ticket = await googleClient.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID });
  const p = ticket.getPayload();
  if (!p?.sub || !p.email) throw new Error("Google token missing sub/email");
  return { googleId: p.sub, email: p.email, name: p.name ?? p.email, avatar: p.picture ?? null };
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (env.DEV_AUTH_BYPASS && !isProd) {
      // Dev convenience only — lets the UI be built before Google creds arrive.
      req.userId = "dev-user";
      next();
      return;
    }
    const fromCookie = req.cookies?.[COOKIE] as string | undefined;
    const fromHeader = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : undefined;
    const token = fromCookie ?? fromHeader;
    if (!token) {
      res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Login required" } });
      return;
    }
    const decoded = jwt.verify(token, env.JWT_SECRET) as { sub: string };
    req.userId = decoded.sub;
    next();
  } catch {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Invalid session" } });
  }
}

/** Ensure the dev stub user exists so local UI works without OAuth. */
export async function ensureDevUser(): Promise<AuthUser | null> {
  const stub = devBypassUser();
  if (!stub) return null;
  try {
    await prisma.user.upsert({
      where: { email: stub.email },
      create: { id: "dev-user", googleId: "dev-google-id", email: stub.email, name: stub.name },
      update: {},
    });
  } catch (err) {
    logger.warn({ err }, "ensureDevUser failed (db maybe down)");
  }
  return stub;
}
