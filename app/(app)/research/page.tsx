import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { Tabs, type Tab } from "@/components/tabs";
import { WatchlistSection } from "@/components/sections/watchlist-section";
import { MarketsSection } from "@/components/sections/markets-section";
import { auth } from "@/lib/auth";

export default async function ResearchPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const tabs: Tab[] = [
    { key: "Watchlist", content: <WatchlistSection userId={session.user.id} /> },
    { key: "Markets", content: <MarketsSection userId={session.user.id} /> },
  ];

  return (
    <>
      <Topbar title="Research" />
      <div className="px-4 pb-12 pt-6 md:px-6 lg:px-[34px] lg:pt-[30px] lg:pb-[60px]">
        <Tabs tabs={tabs} />
      </div>
    </>
  );
}
