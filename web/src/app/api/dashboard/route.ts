import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";
import { getDreamDashboardData } from "@/app/lib/notion";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  noStore();
  const data = await getDreamDashboardData();
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
