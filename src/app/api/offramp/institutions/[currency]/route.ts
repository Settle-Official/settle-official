import { NextRequest, NextResponse } from "next/server";
import { PaycrestAdapter } from "@/lib/offramp/adapters/paycrest-adapter";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ currency: string }> }
) {
  try {
    const { currency } = await params;

    const paycrestApiKey = process.env.PAYCREST_API_KEY;
    if (!paycrestApiKey) {
      throw new Error("PAYCREST_API_KEY not configured");
    }

    const paycrest = new PaycrestAdapter(paycrestApiKey);
    const institutions = await paycrest.getInstitutions(currency);

    return NextResponse.json({ data: institutions });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to fetch institutions" },
      { status: 500 }
    );
  }
}
