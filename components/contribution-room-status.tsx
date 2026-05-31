import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import type { ContributionRoomStatus, RoomKind } from "@/lib/canadian/contribution-room";

const KIND_LABEL: Record<RoomKind, string> = {
  TFSA: "TFSA",
  RRSP: "RRSP",
  FHSA: "FHSA",
  RESP: "RESP",
};

export function ContributionRoomStatusCard({
  statuses,
  year,
}: {
  statuses: ContributionRoomStatus[];
  year: number;
}) {
  const anyEntered = statuses.some((s) => s.roomAvailable != null);

  return (
    <section className="rounded-card border border-border bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-5 md:px-6">
        <h2 className="text-[16px] font-semibold">Contribution room · {year}</h2>
        <Link href="/settings" className="text-xs text-muted underline">
          Edit room in settings
        </Link>
      </div>

      {!anyEntered ? (
        <div className="border-t border-border bg-warning/5 px-4 py-6 text-center text-sm text-muted md:px-6">
          No contribution room entered yet. Add your{" "}
          <Link href="/settings" className="underline">
            current-year room
          </Link>{" "}
          (TFSA, RRSP, FHSA, RESP) from your CRA Notice of Assessment so
          over-contribution warnings can fire.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div className="grid grid-cols-[0.7fr_1fr_1fr_1fr_1fr] gap-3 border-t border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted md:px-6">
              <div>Account</div>
              <div className="text-right">Room available</div>
              <div className="text-right">Used (BUYs)</div>
              <div className="text-right">Remaining</div>
              <div className="text-right">Utilization</div>
            </div>
            {statuses.map((s) => (
              <div
                key={s.kind}
                className="grid grid-cols-[0.7fr_1fr_1fr_1fr_1fr] items-center gap-3 border-t border-border px-4 py-3 md:px-6"
              >
                <div className="text-[14px] font-semibold">{KIND_LABEL[s.kind]}</div>
                <div className="text-right text-[14px] tabular-nums">
                  {s.roomAvailable == null ? "—" : formatCurrency(s.roomAvailable)}
                </div>
                <div className="text-right text-[14px] tabular-nums text-muted">
                  {formatCurrency(s.derivedUsed)}
                </div>
                <div
                  className={`text-right text-[14px] font-semibold tabular-nums ${
                    s.remaining == null
                      ? "text-muted"
                      : s.overContributed
                        ? "text-danger"
                        : s.remaining < 1000
                          ? "text-warning"
                          : "text-success"
                  }`}
                >
                  {s.remaining == null ? "—" : formatCurrency(s.remaining)}
                </div>
                <div className="text-right">
                  {s.utilization == null ? (
                    <span className="text-xs text-muted">—</span>
                  ) : (
                    <UtilizationBar percent={s.utilization} over={s.overContributed} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="border-t border-border px-4 py-3 text-xs text-muted-2 md:px-6">
        Used = sum of BUY transactions in that account this year. In-kind
        transfers between registered accounts are not modelled — adjust the
        room you enter to compensate.
      </p>
    </section>
  );
}

function UtilizationBar({ percent, over }: { percent: number; over: boolean }) {
  const clamped = Math.max(0, Math.min(percent, 100));
  return (
    <div className="ml-auto flex w-32 items-center justify-end gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-bg/60">
        <div
          className={`h-full rounded-full ${over ? "bg-danger" : clamped > 80 ? "bg-warning" : "bg-success"}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <div className={`text-xs tabular-nums ${over ? "text-danger" : "text-muted"}`}>
        {Math.round(percent)}%
      </div>
    </div>
  );
}
