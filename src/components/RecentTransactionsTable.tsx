import type { RecentTransactionRow } from "@/types/stellaramp";
import { cn } from "@/lib/cn";

export interface RecentTransactionsTableProps {
  readonly rows: ReadonlyArray<RecentTransactionRow>;
  readonly isLive?: boolean;
}

export function RecentTransactionsTable({
  rows,
  isLive,
}: Readonly<RecentTransactionsTableProps>) {
  return (
    <section className="border border-[var(--line)] bg-[#0a0a0a] p-[0.8rem]">
      <div className="mb-[0.65rem] flex items-end justify-between">
        <h2 className="m-0 font-space-grotesk font-bold text-[1.50rem]">
          RECENT TRANSACTIONS
        </h2>
        {isLive && (
          <span className="flex items-center gap-1.5 text-[0.62rem] tracking-[0.06em] text-[var(--accent)]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent)] [animation:pulse_1.2s_ease-in-out_infinite]" />
            LIVE
          </span>
        )}
      </div>
      <table className="w-full border-collapse text-[0.72rem] max-[720px]:block max-[720px]:overflow-x-auto">
        <thead>
          <tr>
            <th className="bg-[var(--accent)] p-[0.55rem] font-semibold font-space-grotesk text-left text-[0.7rem] text-[#0a0a0a]">
              TYPE
            </th>
            <th className="bg-[var(--accent)] p-[0.55rem] font-semibold font-space-grotesk text-left text-[0.7rem] text-[#0a0a0a]">
              TX HASH
            </th>
            <th className="bg-[var(--accent)] p-[0.55rem] font-semibold font-space-grotesk text-left text-[0.7rem] text-[#0a0a0a]">
              USDC
            </th>
            <th className="bg-[var(--accent)] p-[0.55rem] font-semibold font-space-grotesk text-left text-[0.7rem] text-[#0a0a0a]">
              NAIRA
            </th>
            <th className="bg-[var(--accent)] p-[0.55rem] font-semibold font-space-grotesk text-left text-[0.7rem] text-[#0a0a0a]">
              STATUS
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.txHash}>
              <td className="border-t border-t-[var(--line)] p-[0.68rem_0.55rem]">
                <span
                  className={cn(
                    "inline-block border px-[0.55rem] py-[0.2rem] text-[0.6rem]",
                    row.type === "onramp"
                      ? "border-[var(--accent)] text-[var(--accent)]"
                      : "border-white text-white",
                  )}
                >
                  {row.type === "onramp" ? "ONRAMP" : "OFFRAMP"}
                </span>
              </td>
              <td className="border-t border-t-[var(--line)] font-space-grotesk p-[0.68rem_0.55rem]">
                {row.txHash}
              </td>
              <td className="border-t border-t-[var(--line)] font-space-grotesk p-[0.68rem_0.55rem]">
                {row.usdc}
              </td>
              <td className="border-t border-t-[var(--line)] font-space-grotesk p-[0.68rem_0.55rem]">
                {row.naira}
              </td>
              <td className="border-t border-t-[var(--line)] p-[0.68rem_0.55rem]">
                <span
                  className={
                    row.status === "SETTLING"
                      ? "inline-block border border-[var(--accent)] bg-[var(--accent)] px-[0.55rem] py-[0.2rem] text-[0.6rem] text-[#0a0a0a]"
                      : "inline-block border border-white px-[0.55rem] py-[0.2rem] text-[0.6rem]"
                  }
                >
                  {row.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
