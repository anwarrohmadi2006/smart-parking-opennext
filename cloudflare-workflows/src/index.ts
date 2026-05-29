import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';

type Env = {
  RAINY_ALERT_WORKFLOW: any;
};

type Params = {
  adminEmail: string;
  initialOccupancy: number;
};

export class RainyEmergencyAlert extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    
    // Step 1: Log emergency start
    await step.do("log-emergency", async () => {
      console.log(`[Workflow] Peringatan hujan lebat dimulai! Occupancy awal: ${event.payload.initialOccupancy}%`);
    });

    // Step 2: Generate AI Alert Broadcast
    const alertMessage = await step.do("generate-ai-alert", async () => {
      // In a real app, you can fetch Cloudflare Workers AI here to generate dynamic text.
      // We simulate the LLaMA-3 text generation for now.
      return `[AWAS] Hujan turun lebat. Parkiran (kapasitas ${event.payload.initialOccupancy}%) diprediksi tidak akan sepi dalam waktu dekat. Mohon siaga!`;
    });
    
    console.log("Alert terkirim ke sistem / admin:", alertMessage);

    // Step 3: SLEEP (Durable Execution)
    // Here we sleep for 3 minutes for testing purposes. In production, this would be "30 minutes".
    console.log("[Workflow] Mesin akan tidur (suspend) selama 3 menit tanpa memakan resource/biaya...");
    await step.sleep("wait-for-rain-to-stop", "3 minutes");

    // Step 4: Re-evaluate state after sleep
    await step.do("recheck-weather", async () => {
      console.log("[Workflow] Mesin bangun! Mengecek ulang cuaca setelah 3 menit tertidur...");
      // Add logic here to fetch real-time weather again.
      // If it's still raining, we could trigger another workflow or send a follow up.
      console.log("[Workflow] Siklus pemantauan darurat selesai.");
    });
  }
}

// Standard Fetch Handler to allow triggering the workflow via HTTP Request
export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/trigger" && req.method === "POST") {
      try {
        const body = await req.json() as Params;
        
        // This is how you spawn a Workflow instance programmatically
        const instance = await env.RAINY_ALERT_WORKFLOW.create({
          params: body
        });
        
        return Response.json({ 
          success: true, 
          workflow_id: instance.id,
          message: "Durable Workflow 'RainyEmergencyAlert' has been triggered in the background!"
        });
      } catch (err: any) {
        return Response.json({ error: err.message }, { status: 500 });
      }
    }

    return new Response("Cloudflare Workflows Engine. Use POST /trigger to start.");
  }
};
