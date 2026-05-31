import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";

export type UserPreferences = {
  /** Whether the daily review cron will run for this user. */
  aiAutoDailyReview: boolean;
  /** Whether the weekly review cron will run for this user. */
  aiAutoWeeklyReview: boolean;
  /** Whether classify-news cron will run AI severity classification on this user's news. */
  aiNewsClassification: boolean;
  /** Global kill-switch for Mailgun alert digest emails (per-alert EMAIL channel still required). */
  emailDigestEnabled: boolean;
};

export const DEFAULT_PREFERENCES: UserPreferences = {
  aiAutoDailyReview: true,
  aiAutoWeeklyReview: true,
  aiNewsClassification: true,
  emailDigestEnabled: true,
};

export const PREFERENCE_KEYS = Object.keys(DEFAULT_PREFERENCES) as (keyof UserPreferences)[];

export async function getUserPreferences(userId: string): Promise<UserPreferences> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { preferences: true },
  });
  return mergeWithDefaults((row?.preferences as Partial<UserPreferences> | null) ?? null);
}

export async function setUserPreference<K extends keyof UserPreferences>(
  userId: string,
  key: K,
  value: UserPreferences[K],
): Promise<UserPreferences> {
  const current = await getUserPreferences(userId);
  const next = { ...current, [key]: value };
  await prisma.user.update({
    where: { id: userId },
    data: { preferences: next as unknown as Prisma.InputJsonValue },
  });
  return next;
}

function mergeWithDefaults(partial: Partial<UserPreferences> | null): UserPreferences {
  return {
    aiAutoDailyReview: partial?.aiAutoDailyReview ?? DEFAULT_PREFERENCES.aiAutoDailyReview,
    aiAutoWeeklyReview: partial?.aiAutoWeeklyReview ?? DEFAULT_PREFERENCES.aiAutoWeeklyReview,
    aiNewsClassification:
      partial?.aiNewsClassification ?? DEFAULT_PREFERENCES.aiNewsClassification,
    emailDigestEnabled: partial?.emailDigestEnabled ?? DEFAULT_PREFERENCES.emailDigestEnabled,
  };
}
