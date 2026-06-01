import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { ImportUploader } from "@/components/import-uploader";
import { ImportHistory, type ImportHistoryRow } from "@/components/import-history";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function ImportPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const [brokerages, batches] = await Promise.all([
    prisma.brokerage.findMany({
      where: { userId: session.user.id },
      select: { id: true, name: true },
    }),
    prisma.importBatch.findMany({
      where: { userId: session.user.id },
      orderBy: { importedAt: "desc" },
      take: 20,
    }),
  ]);

  const brokerageNameById = new Map(brokerages.map((b) => [b.id, b.name]));

  const items: ImportHistoryRow[] = batches.map((b) => ({
    id: b.id,
    sourceFilename: b.sourceFilename,
    source: b.source,
    brokerageName: brokerageNameById.get(b.brokerageId) ?? "(deleted)",
    transactionCount: b.transactionCount,
    skippedCount: b.skippedCount,
    notes: b.notes,
    importedAt: b.importedAt,
  }));

  return (
    <>
      <Topbar title="Import" />
      <div className="px-4 pb-12 pt-6 md:px-6 lg:px-[34px] lg:pt-[30px] lg:pb-[60px]">
        <div className="mx-auto max-w-3xl space-y-6">
          <div>
            <Link
              href="/settings"
              className="text-xs font-semibold text-muted hover:text-text"
            >
              ← Settings
            </Link>
            <h1 className="mt-1 text-[22px] font-semibold">Import transactions</h1>
            <p className="mt-1 text-sm text-muted">
              Upload an RBC Direct Investing Activity CSV. The importer parses
              the file, classifies each row, flags possible duplicates, and
              auto-fetches CAD-equivalent FX rates for non-CAD trades. You
              choose the destination brokerage and confirm before any rows are
              written.
            </p>
          </div>

          <section className="rounded-card border border-border bg-panel p-6">
            <ImportUploader hasAnyBrokerages={brokerages.length > 0} />
          </section>

          <section className="rounded-card border border-border bg-panel p-6">
            <h2 className="mb-3 text-[16px] font-semibold">Past imports</h2>
            <p className="mb-3 text-sm text-muted">
              Every upload is an audit trail. Roll back an entire batch in one
              click — every transaction it created is removed, leaving
              hand-entered rows untouched.
            </p>
            <ImportHistory items={items} />
          </section>
        </div>
      </div>
    </>
  );
}
