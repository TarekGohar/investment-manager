import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listTransactions } from "@/lib/portfolio/queries";
import { TransactionForm } from "@/components/transaction-form";
import { TransactionsList } from "@/components/transactions-list";
import { TransactionsIcon } from "@/components/icons";

type SearchParams = Promise<{
  ticker?: string;
  brokerageId?: string;
  kind?: string;
  quantity?: string;
}>;

const VALID_FORM_KINDS = new Set([
  "BUY",
  "SELL",
  "DIVIDEND",
  "SPLIT",
  "DEPOSIT",
  "WITHDRAWAL",
  "TRANSFER_IN",
  "TRANSFER_OUT",
]);

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const params = await searchParams;
  const defaultTicker = (params.ticker ?? "").toUpperCase();
  const defaultBrokerageId = params.brokerageId ?? undefined;
  const defaultKind =
    params.kind && VALID_FORM_KINDS.has(params.kind)
      ? (params.kind as
          | "BUY"
          | "SELL"
          | "DIVIDEND"
          | "SPLIT"
          | "DEPOSIT"
          | "WITHDRAWAL"
          | "TRANSFER_IN"
          | "TRANSFER_OUT")
      : undefined;
  const defaultQuantity = params.quantity ? Number(params.quantity) : undefined;

  const [transactions, brokerages] = await Promise.all([
    listTransactions(session.user.id),
    prisma.brokerage.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, kind: true, currency: true },
    }),
  ]);

  return (
    <>
      <Topbar title="Transactions" />
      <div className="flex flex-col gap-6 px-4 pb-12 pt-6 md:px-6 lg:flex-row lg:items-start lg:gap-[34px] lg:px-[34px] lg:pt-[30px] lg:pb-[60px]">
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
              defaultQuantity={Number.isFinite(defaultQuantity) ? defaultQuantity : undefined}
            />
          </div>
        </aside>
      </div>
    </>
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
