import { ReviewBoard } from "@/components/ReviewBoard";
import { getDreamDashboardData } from "./lib/notion";

export const metadata = {
  title: "Notion Dreams",
  description: "Dashboard for Notion Dreams worker runs, reports, and logs.",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function Home() {
  const data = await getDreamDashboardData();
  return <ReviewBoard initialEdits={data.edits} initialRuns={data.runs} source={data.source} />;
}
