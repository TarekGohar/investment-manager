/**
 * Static company descriptions used until Phase 3 wires real fundamentals data.
 * Add more entries as needed; missing tickers fall through to a generic message.
 */
export const COMPANY_ABOUT: Record<string, string> = {
  AAPL: "Apple Inc. designs, manufactures and markets smartphones, personal computers, tablets, wearables and accessories worldwide. The Services segment — App Store, Apple Music, iCloud, Apple Pay and licensing — has become the company's fastest-growing revenue line, driving multiple expansion since 2019.",
  NVDA: "NVIDIA Corporation operates as a computing infrastructure company. The Data Center segment, anchored by the Hopper and Blackwell GPU architectures and a software moat in CUDA, has become the dominant supplier of training and inference compute for modern AI workloads.",
  GOOGL: "Alphabet Inc. is the parent company of Google. The vast majority of revenue still comes from search and YouTube advertising, but Google Cloud has become a material profit contributor and Waymo represents a long-dated optionality on autonomous transport.",
  TSLA: "Tesla designs, develops, manufactures and sells electric vehicles, energy generation and storage systems. The investment case has shifted from pure auto growth toward optionality on FSD/autonomy, the Optimus humanoid program, and energy storage — with auto margins under pressure from BYD competition.",
  MSFT: "Microsoft Corporation develops, licenses and supports software, services, devices and solutions. Azure and Microsoft 365, paired with the OpenAI partnership and Copilot product line, position the company as a primary infrastructure provider for the enterprise AI cycle.",
  JPM: "JPMorgan Chase is the largest U.S. bank by assets. Consumer banking, investment banking, asset management and treasury services form a uniquely diversified franchise. Net interest income drives near-term earnings; loan growth and capital markets activity drive longer-term operating leverage.",
  "BRK.B": "Berkshire Hathaway is a holding company owning insurance (GEICO, Gen Re), railroad (BNSF), energy, manufacturing and retail businesses, plus a large equity portfolio. Float from the insurance operations funds long-duration investments — a structurally advantaged capital base.",
  COST: "Costco Wholesale operates membership warehouse clubs. The high-membership-renewal-rate, low-margin, high-turnover model produces unusually predictable cash flow, with most operating profit flowing from membership fees rather than merchandise margin.",
};

export function aboutFor(ticker: string): string | undefined {
  return COMPANY_ABOUT[ticker.toUpperCase()];
}
