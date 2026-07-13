import { NextRequest, NextResponse } from "next/server";
import { getStats, trackWallet, addVolume, pushRecentTransaction, type RecentTransactionEntry } from "@/lib/stats-store";

export async function GET() {
  const stats = await getStats();
  return NextResponse.json(stats);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { wallet, volume, transaction } = body;

  const tasks: Promise<unknown>[] = [];

  if (wallet) tasks.push(trackWallet(wallet));
  if (typeof volume === "number" && volume > 0) tasks.push(addVolume(volume));
  if (transaction) tasks.push(pushRecentTransaction(transaction as RecentTransactionEntry));

  await Promise.all(tasks);

  const stats = await getStats();
  return NextResponse.json(stats);
}
