import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { Tabs, type Tab } from "@/components/tabs";
import { TaxSection } from "@/components/sections/tax-section";
import { PolicySection } from "@/components/sections/policy-section";
import { AnnualReviewSection } from "@/components/sections/annual-review-section";
import { auth } from "@/lib/auth";

export default async function ReviewPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const tabs: Tab[] = [
    { key: "Tax", content: <TaxSection userId={session.user.id} /> },
    { key: "Policy", content: <PolicySection userId={session.user.id} /> },
    { key: "Annual", content: <AnnualReviewSection userId={session.user.id} /> },
  ];

  return (
    <>
      <Topbar title="Review" />
      <div className="px-4 pb-12 pt-6 md:px-6 lg:px-[34px] lg:pt-[30px] lg:pb-[60px]">
        <Tabs tabs={tabs} />
      </div>
    </>
  );
}
