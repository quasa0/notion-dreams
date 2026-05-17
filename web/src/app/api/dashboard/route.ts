import { NextResponse } from "next/server";
import { getDreamDashboardData } from "@/app/lib/notion";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getDreamDashboardData();
  return NextResponse.json(data);
}
