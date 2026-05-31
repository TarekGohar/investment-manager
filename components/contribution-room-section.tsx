"use client";

import { useState, useTransition } from "react";
import {
  upsertContributionRoomAction,
  deleteContributionRoomAction,
} from "@/app/actions/contribution-room";
import { useToast } from "@/components/toast-provider";
import { formatCurrency } from "@/lib/format";
import type { ContributionRoomEntry, RoomKind } from "@/lib/canadian/contribution-room";

const ROOM_KIND_LABELS: Record<RoomKind, string> = {
  TFSA: "TFSA",
  RRSP: "RRSP",
  FHSA: "FHSA",
  RESP: "RESP",
};

const ROOM_KIND_OPTIONS: RoomKind[] = ["TFSA", "RRSP", "FHSA", "RESP"];

export function ContributionRoomSection({
  entries,
  currentYear,
}: {
  entries: ContributionRoomEntry[];
  currentYear: number;
}) {
  const [kind, setKind] = useState<RoomKind>("TFSA");
  const [year, setYear] = useState(currentYear);
  const [room, setRoom] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  function add() {
    const trimmed = room.trim();
    if (!trimmed) {
      toast({ title: "Enter a room amount", variant: "error" });
      return;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value < 0) {
      toast({ title: "Room must be a non-negative number", variant: "error" });
      return;
    }
    startTransition(async () => {
      const result = await upsertContributionRoomAction({
        kind,
        year,
        roomAvailable: value,
        notes: notes.trim() || null,
      });
      if (result.ok) {
        setRoom("");
        setNotes("");
        toast({ title: "Saved", variant: "success" });
      } else {
        toast({ title: "Couldn't save", description: result.error, variant: "error" });
      }
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Pull these numbers from your CRA Notice of Assessment or the MyCRA
        portal. Nothing is assumed — CRA annual limits change year to year and
        carry-forward depends on your unused room. &ldquo;Deposited&rdquo; on
        the /tax page is derived from your DEPOSIT transactions into the
        account — make sure to log a Deposit every time you fund a registered
        account so the tracker stays accurate.
      </p>

      <div className="rounded-[10px] bg-bg/40 px-3 py-3 space-y-3">
        <div className="text-[13px] font-semibold">Add / update room</div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <label className="block">
            <div className="text-xs text-muted">Account</div>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as RoomKind)}
              className="mt-1 w-full rounded-[8px] border border-border bg-panel px-2.5 py-1.5 text-sm"
            >
              {ROOM_KIND_OPTIONS.map((k) => (
                <option key={k} value={k}>
                  {ROOM_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <div className="text-xs text-muted">Year</div>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="mt-1 w-full rounded-[8px] border border-border bg-panel px-2.5 py-1.5 text-sm tabular-nums"
            />
          </label>
          <label className="block">
            <div className="text-xs text-muted">Room available ($)</div>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="e.g. 7000"
              className="mt-1 w-full rounded-[8px] border border-border bg-panel px-2.5 py-1.5 text-sm tabular-nums"
            />
          </label>
          <label className="block">
            <div className="text-xs text-muted">Notes (optional)</div>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. NOA dated 2026-03-15"
              className="mt-1 w-full rounded-[8px] border border-border bg-panel px-2.5 py-1.5 text-sm"
            />
          </label>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={add}
            disabled={pending}
            className="rounded-[8px] bg-brand px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
          No contribution room entered yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            <div className="grid grid-cols-[0.6fr_0.7fr_1fr_1.4fr_0.6fr] gap-3 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
              <div>Year</div>
              <div>Account</div>
              <div className="text-right">Room available</div>
              <div>Notes</div>
              <div className="text-right">{""}</div>
            </div>
            {entries.map((e) => (
              <RoomRow key={e.id} entry={e} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RoomRow({ entry }: { entry: ContributionRoomEntry }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function remove() {
    if (!confirm(`Delete ${entry.kind} ${entry.year} room entry?`)) return;
    startTransition(async () => {
      const result = await deleteContributionRoomAction(entry.id);
      if (!result.ok) {
        toast({ title: "Couldn't delete", description: result.error, variant: "error" });
      } else {
        toast({ title: "Deleted", variant: "success" });
      }
    });
  }

  return (
    <div className="grid grid-cols-[0.6fr_0.7fr_1fr_1.4fr_0.6fr] items-center gap-3 border-t border-border px-3 py-2.5">
      <div className="text-[14px] font-semibold tabular-nums">{entry.year}</div>
      <div className="text-[13px]">{ROOM_KIND_LABELS[entry.kind]}</div>
      <div className="text-right text-[14px] tabular-nums">
        {formatCurrency(entry.roomAvailable)}
      </div>
      <div className="truncate text-xs text-muted">{entry.notes ?? "—"}</div>
      <div className="text-right">
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          className="text-xs text-muted hover:text-danger disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
