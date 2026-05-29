import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // In production, this URL would point to your deployed Cloudflare Workflow worker
    // For local development, this points to the local wrangler dev server
    const WORKFLOW_WORKER_URL = process.env.WORKFLOW_WORKER_URL || "http://127.0.0.1:8787/trigger";

    const response = await fetch(WORKFLOW_WORKER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        adminEmail: "admin@smartpark.ai",
        initialOccupancy: body.occupancy || 85
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Workflow API responded with status: ${response.status} - ${text}`);
    }

    const data = await response.json();

    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Failed to trigger workflow:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
