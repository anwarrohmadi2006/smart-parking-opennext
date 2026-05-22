import { NextResponse } from "next/server";
export const runtime = "nodejs";
export async function GET() {
  return NextResponse.json({ dbUrl: process.env.DATABASE_URL || "undefined" });
}
