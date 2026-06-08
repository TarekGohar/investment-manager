import "server-only";
import { Prisma } from "../../../generated/prisma";
import { prisma } from "@/lib/prisma";
import type { Memo, SpecialistName } from "./types";

/**
 * Persistence interface for specialist memos. The CIO recalls these on later
 * turns so a deep analysis run today informs conversational answers tomorrow
 * without re-firing the panel. Backed by the `specialist_memo` Prisma model.
 */
export interface SpecialistMemoStore {
  save(userId: string, memo: Memo): Promise<void>;
  /**
   * Returns the latest memo per specialist for a ticker, filtered to memos
   * newer than `maxAgeDays`. Used by `recall_specialist_memo`.
   */
  findRecentByTicker(args: {
    userId: string;
    ticker: string;
    specialists?: SpecialistName[];
    maxAgeDays?: number;
  }): Promise<Memo[]>;
}

/**
 * Prisma-backed store. Persists each memo to `specialist_memo` via Prisma.
 * The most recent memo per (user, specialist, ticker) wins on recall, with
 * an optional age filter so the CIO doesn't lean on stale work.
 */
export class PrismaSpecialistMemoStore implements SpecialistMemoStore {
  async save(userId: string, memo: Memo): Promise<void> {
    await prisma.specialistMemo.create({
      data: {
        userId,
        specialist: memo.specialist,
        ticker: memo.ticker,
        conclusion: memo.conclusion,
        confidence: memo.confidence,
        modelUsed: memo.modelUsed,
        memo: memo as unknown as Prisma.InputJsonValue,
        asOf: new Date(memo.asOf),
      },
    });
  }

  async findRecentByTicker(args: {
    userId: string;
    ticker: string;
    specialists?: SpecialistName[];
    maxAgeDays?: number;
  }): Promise<Memo[]> {
    const cutoff =
      args.maxAgeDays != null
        ? new Date(Date.now() - args.maxAgeDays * 86_400_000)
        : undefined;
    const rows = await prisma.specialistMemo.findMany({
      where: {
        userId: args.userId,
        ticker: args.ticker,
        ...(args.specialists ? { specialist: { in: args.specialists } } : {}),
        ...(cutoff ? { asOf: { gte: cutoff } } : {}),
      },
      orderBy: { asOf: "desc" },
    });
    // Keep only the latest per specialist.
    const latest = new Map<SpecialistName, Memo>();
    for (const row of rows) {
      const spec = row.specialist as SpecialistName;
      if (latest.has(spec)) continue;
      latest.set(spec, row.memo as unknown as Memo);
    }
    return Array.from(latest.values());
  }
}

/**
 * In-memory store for local exploration. NOT for production — memos vanish
 * on restart. Useful in scripts where DB roundtrips aren't worth it.
 */
export class InMemoryMemoStore implements SpecialistMemoStore {
  private byUser = new Map<string, Memo[]>();

  async save(userId: string, memo: Memo): Promise<void> {
    const list = this.byUser.get(userId) ?? [];
    list.push(memo);
    this.byUser.set(userId, list);
  }

  async findRecentByTicker(args: {
    userId: string;
    ticker: string;
    specialists?: SpecialistName[];
    maxAgeDays?: number;
  }): Promise<Memo[]> {
    const list = this.byUser.get(args.userId) ?? [];
    const cutoffMs =
      args.maxAgeDays != null
        ? Date.now() - args.maxAgeDays * 86_400_000
        : Number.NEGATIVE_INFINITY;
    const filtered = list.filter((m) => {
      if (m.ticker !== args.ticker) return false;
      if (args.specialists && !args.specialists.includes(m.specialist)) return false;
      return new Date(m.asOf).getTime() >= cutoffMs;
    });
    // Keep only the latest per specialist.
    const latest = new Map<SpecialistName, Memo>();
    for (const m of filtered.sort((a, b) => a.asOf.localeCompare(b.asOf))) {
      latest.set(m.specialist, m);
    }
    return Array.from(latest.values());
  }
}
