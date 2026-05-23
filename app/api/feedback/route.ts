import { NextRequest, NextResponse } from "next/server";

const FASTAPI_FEEDBACK_URL = process.env.FASTAPI_FEEDBACK_URL || "https://anwarrohmadi111--smartpark-api-web-app.modal.run/feedback";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch(FASTAPI_FEEDBACK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prediction_id: body.prediction_id,
        actual_occupancy: Number(body.actual_occupancy),
        admin_action_taken: body.admin_action_taken || "Feedback manual via Dashboard Admin",
        correct: Boolean(body.correct),
      }),
    });

    if (!response.ok) {
      throw new Error(`FastAPI returned status ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Error in AI feedback API route:", error);
    return NextResponse.json(
      { error: "Failed to log feedback", details: error.message },
      { status: 500 }
    );
  }
}
