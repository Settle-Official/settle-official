import { NextRequest, NextResponse } from "next/server";
import { PaycrestAdapter } from "@/lib/offramp/adapters/paycrest-adapter";
import { validateAccountNumber } from "@/lib/offramp/utils/validation";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { institution, accountIdentifier } = body;

    if (!institution || !accountIdentifier) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (!validateAccountNumber(accountIdentifier)) {
      return NextResponse.json(
        { error: "Invalid account number format" },
        { status: 400 }
      );
    }

    const paycrestApiKey = process.env.PAYCREST_API_KEY;
    if (!paycrestApiKey) {
      throw new Error("PAYCREST_API_KEY not configured");
    }

    const paycrest = new PaycrestAdapter(paycrestApiKey);
    const accountName = await paycrest.verifyAccount(
      institution,
      accountIdentifier
    );

    return NextResponse.json({ data: accountName });
  } catch (error: any) {
    console.error("Account verification error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to verify account" },
      { status: 500 }
    );
  }
}
