import { NextResponse } from "next/server";
import { PaycrestAdapter } from "@/lib/offramp/adapters/paycrest-adapter";

export async function GET() {
  try {
    const paycrestApiKey = process.env.PAYCREST_API_KEY;
    if (!paycrestApiKey) {
      throw new Error("PAYCREST_API_KEY not configured");
    }

    const paycrest = new PaycrestAdapter(paycrestApiKey);
    const currencies = await paycrest.getCurrencies();

    return NextResponse.json({ data: currencies });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to fetch currencies" },
      { status: 500 }
    );
  }
}
