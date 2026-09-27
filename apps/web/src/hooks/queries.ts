import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import type { CountsSummary, EmailDetail, PagedEmails, Sender, User } from "@reachinbox/shared";

export function useAuth() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async (): Promise<{ user: User; dev?: boolean }> => (await api.get("/api/auth/me")).data,
    retry: false,
  });
}

export function useCounts(enabled: boolean) {
  return useQuery({
    queryKey: ["counts"],
    queryFn: async (): Promise<CountsSummary> => (await api.get("/api/emails/counts/summary")).data,
    enabled,
    refetchInterval: 10_000,
  });
}

export interface EmailListParams {
  status?: string;
  q?: string;
  page?: number;
  enabled?: boolean;
}

export function useEmails({ status, q, page = 1, enabled = true }: EmailListParams) {
  return useQuery({
    queryKey: ["emails", status, q, page],
    queryFn: async (): Promise<PagedEmails> =>
      (await api.get("/api/emails", { params: { status, q: q || undefined, page, limit: 20 } })).data,
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function useEmailDetail(id: string | undefined) {
  return useQuery({
    queryKey: ["email", id],
    queryFn: async (): Promise<{ email: EmailDetail }> => (await api.get(`/api/emails/${id}`)).data,
    enabled: Boolean(id),
  });
}

export function useSenders(enabled: boolean) {
  return useQuery({
    queryKey: ["senders"],
    queryFn: async (): Promise<{ senders: Sender[] }> => (await api.get("/api/senders")).data,
    enabled,
  });
}

export function useSlackStatus(enabled: boolean) {
  return useQuery({
    queryKey: ["slack"],
    queryFn: async (): Promise<{ connected: boolean; channelId: string | null }> =>
      (await api.get("/api/slack/status")).data,
    enabled,
  });
}
