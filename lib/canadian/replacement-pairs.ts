/**
 * Replacement-pair library for tax-loss harvesting in Canada.
 *
 * Each group lists tickers that track essentially the same exposure but are
 * issued by different companies — generally accepted by CRA as NOT
 * "identical property", so a sell-then-buy avoids the superficial loss rule.
 *
 * BIG CAVEAT: CRA has never published an exhaustive list, and case law is
 * sparse. The conservative interpretation is that ETFs tracking the *exact
 * same index* from different issuers (e.g. VFV vs. ZSP, both S&P 500) are
 * generally fine. ETFs tracking related-but-distinct indices (S&P 500 vs.
 * Total US Market) are clearly safe. Buying back the *same* ETF (VFV → VFV)
 * is always a violation. When in doubt, wait 31 days.
 *
 * The `riskNote` flags pairs where there's any ambiguity.
 */

export type ReplacementGroup = {
  /** Tickers that share the same exposure */
  tickers: string[];
  label: string;
  /** Any caveat about CRA acceptance */
  riskNote?: string;
};

export const REPLACEMENT_GROUPS: ReplacementGroup[] = [
  // ─── US broad / S&P 500 ───────────────────────────────────────────
  {
    label: "S&P 500 trackers",
    tickers: ["VFV.TO", "XUS.TO", "ZSP.TO", "VFV", "XUS", "ZSP", "VOO", "SPY", "IVV"],
    riskNote:
      "All track the S&P 500 from different issuers. CRA generally accepts as non-identical, but no published ruling — wait 31 days if you want absolute safety.",
  },
  {
    label: "Total US market trackers",
    tickers: ["VUN.TO", "XUU.TO", "VUN", "XUU", "VTI", "ITOT", "SCHB"],
  },
  {
    label: "Nasdaq 100 trackers",
    tickers: ["ZQQ.TO", "XQQ.TO", "HXQ.TO", "ZQQ", "XQQ", "QQQ", "QQQM"],
  },

  // ─── Canadian broad ────────────────────────────────────────────────
  {
    label: "Canada broad market",
    tickers: ["VCN.TO", "XIC.TO", "ZCN.TO", "XCS.TO", "VCN", "XIC", "ZCN"],
  },
  {
    label: "Canadian large-cap dividend",
    tickers: ["XEI.TO", "VDY.TO", "CDZ.TO", "XEI", "VDY", "CDZ"],
    riskNote: "Holdings overlap but methodology differs (high-yield vs aristocrats).",
  },

  // ─── Developed ex-NA / international ──────────────────────────────
  {
    label: "Developed markets ex-NA",
    tickers: ["VIU.TO", "XEF.TO", "ZEA.TO", "VIU", "XEF", "ZEA"],
  },
  {
    label: "World ex-Canada",
    tickers: ["VXC.TO", "XAW.TO", "VXC", "XAW"],
  },
  {
    label: "Emerging markets",
    tickers: ["VEE.TO", "XEC.TO", "ZEM.TO", "VEE", "XEC", "ZEM", "VWO", "IEMG", "EEM"],
  },

  // ─── Bonds ─────────────────────────────────────────────────────────
  {
    label: "Canada aggregate bonds",
    tickers: ["VAB.TO", "ZAG.TO", "XBB.TO", "VAB", "ZAG", "XBB"],
  },
  {
    label: "Canada short-term bonds",
    tickers: ["VSB.TO", "XSH.TO", "ZSB.TO", "VSB", "XSH", "ZSB"],
  },
  {
    label: "Canada long bonds",
    tickers: ["ZFL.TO", "XLB.TO", "VLB.TO", "ZFL", "XLB", "VLB"],
  },
  {
    label: "US aggregate bonds",
    tickers: ["BND", "AGG", "SCHZ"],
  },

  // ─── REITs ─────────────────────────────────────────────────────────
  {
    label: "Canadian REITs",
    tickers: ["VRE.TO", "XRE.TO", "ZRE.TO", "VRE", "XRE", "ZRE"],
  },

  // ─── Tech sector ──────────────────────────────────────────────────
  {
    label: "Tech sector (US)",
    tickers: ["XLK", "VGT", "FTEC"],
  },
  {
    label: "Tech sector (Canada-listed)",
    tickers: ["XIT.TO", "ZQQ.TO", "TEC.TO"],
    riskNote: "Different methodologies — verify holdings overlap is acceptable.",
  },

  // ─── Financial sector ─────────────────────────────────────────────
  {
    label: "Canadian banks",
    tickers: ["ZEB.TO", "XFN.TO", "ZWB.TO"],
    riskNote: "ZWB is a covered-call variant — different income profile.",
  },
  {
    label: "US financials",
    tickers: ["XLF", "VFH"],
  },

  // ─── Energy ────────────────────────────────────────────────────────
  {
    label: "Canadian energy",
    tickers: ["XEG.TO", "ZEO.TO", "XLE"],
    riskNote: "XLE is US energy — different geographic exposure but related cycle.",
  },

  // ─── Utilities ────────────────────────────────────────────────────
  {
    label: "Canadian utilities",
    tickers: ["ZUT.TO", "XUT.TO"],
  },

  // ─── Healthcare ───────────────────────────────────────────────────
  {
    label: "US healthcare",
    tickers: ["XLV", "VHT"],
  },

  // ─── Consumer ──────────────────────────────────────────────────────
  {
    label: "US consumer staples",
    tickers: ["XLP", "VDC"],
  },
  {
    label: "US consumer discretionary",
    tickers: ["XLY", "VCR"],
  },

  // ─── Gold / commodities ───────────────────────────────────────────
  {
    label: "Gold (physical)",
    tickers: ["GLD", "IAU", "PHYS.TO", "MNT.TO"],
  },

  // ─── All-in-one balanced ──────────────────────────────────────────
  {
    label: "Balanced 60/40 all-in-one",
    tickers: ["VBAL.TO", "XBAL.TO", "ZBAL.TO"],
  },
  {
    label: "Growth 80/20 all-in-one",
    tickers: ["VGRO.TO", "XGRO.TO", "ZGRO.TO"],
  },
  {
    label: "Equity 100 all-in-one",
    tickers: ["VEQT.TO", "XEQT.TO", "ZEQT.TO"],
  },
];

export type ReplacementSuggestion = {
  ticker: string;
  label: string;
  riskNote?: string;
};

/**
 * Find candidate replacement tickers for a given ticker. Returns the OTHER
 * members of any group that contains this ticker. The original ticker is
 * excluded. Always-violation pairs (same ticker) excluded.
 */
export function getReplacements(ticker: string): ReplacementSuggestion[] {
  const t = ticker.toUpperCase();
  const matches: ReplacementSuggestion[] = [];
  const seen = new Set<string>();

  for (const group of REPLACEMENT_GROUPS) {
    if (!group.tickers.map((x) => x.toUpperCase()).includes(t)) continue;
    for (const other of group.tickers) {
      const norm = other.toUpperCase();
      if (norm === t || seen.has(norm)) continue;
      matches.push({ ticker: other, label: group.label, riskNote: group.riskNote });
      seen.add(norm);
    }
  }
  return matches;
}

/** True if the given ticker appears in any replacement group (i.e., it's a known asset). */
export function hasKnownReplacements(ticker: string): boolean {
  return getReplacements(ticker).length > 0;
}
