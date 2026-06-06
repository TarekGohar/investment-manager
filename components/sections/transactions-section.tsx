import { prisma } from "@/lib/prisma";
import { listTransactions } from "@/lib/portfolio/queries";
import { TransactionForm } from "@/components/transaction-form";
import { TransactionsList } from "@/components/transactions-list";
import { TransactionsIcon } from "@/components/icons";

export type TransactionFormKind =
  | "BUY"
  | "SELL"
  | "DIVIDEND"
  | "SPLIT"
  | "DEPOSIT"
  | "WITHDRAWAL"
  | "TRANSFER_IN"
  | "TRANSFER_OUT";

export async function TransactionsSection({
  userId,
  defaultTicker,
  defaultBrokerageId,
  defaultKind,
  defaultQuantity,
}: {
  userId: string;
  defaultTicker?: string;
  defaultBrokerageId?: string;
  defaultKind?: TransactionFormKind;
  defaultQuantity?: number;
}) {
  const [transactions, brokerages] = await Promise.all([
    listTransactions(userId),
    prisma.brokerage.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, kind: true, currency: true },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-[34px]">
      <section className="min-w-0 lg:flex-1">
        {transactions.length === 0 ? (
          <EmptyLedger />
        ) : (
          <TransactionsList transactions={transactions} brokerages={brokerages} />
        )}
      </section>

      <aside className="w-full lg:w-[400px] lg:shrink-0">
        <div className="lg:sticky lg:top-[96px]">
          <TransactionForm
            brokerages={brokerages}
            defaultTicker={defaultTicker}
            defaultBrokerageId={defaultBrokerageId}
            defaultKind={defaultKind}
            defaultQuantity={defaultQuantity}
          />
        </div>
      </aside>
    </div>
  );
}

function EmptyLedger() {
  return (
    <div className="rounded-card border border-dashed border-border bg-panel/40 p-12 text-center">
      <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-panel-2 text-muted">
        <TransactionsIcon className="h-7 w-7" />
      </div>
      <h2 className="text-[20px] font-semibold">No transactions yet</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
        Use the form on the right to record your first buy. Holdings are derived from this ledger,
        so accuracy here drives everything else.
      </p>
      <div className="mt-6 inline-flex items-center gap-2 text-sm text-muted">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12h14" />
          <path d="m13 6 6 6-6 6" />
        </svg>
        Start with a BUY
      </div>
    </div>
  );
}
