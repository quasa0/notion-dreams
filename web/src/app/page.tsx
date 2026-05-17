import { ReviewBoard } from "@/components/ReviewBoard";
import { getDreamDashboardData } from "./lib/notion";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await getDreamDashboardData();
  return <ReviewBoard initialEdits={data.edits} initialRuns={data.runs} source={data.source} />;
}
