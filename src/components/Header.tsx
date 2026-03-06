export interface HeaderProps {
  readonly subtitle: string;
  readonly isConnected: boolean;
  readonly isConnecting: boolean;
  readonly walletAddress?: string;
  readonly onConnect: () => void;
  readonly onDisconnect: () => void;
}

export function Header({
  subtitle,
  isConnected,
  isConnecting,
  walletAddress,
  onConnect,
  onDisconnect,
}: Readonly<HeaderProps>) {
  const buttonText = isConnecting
    ? "CONNECTING..."
    : isConnected && walletAddress
      ? `${walletAddress.slice(0, 8)}...${walletAddress.slice(-4)}`
      : "CONNECT WALLET";

  return (
    <header className="flex items-center justify-between gap-4 max-[720px]:items-start max-[720px]:flex-col">
      <div>
        <h1 className="m-0 font-space-grotesk font-bold text-[clamp(1.7rem,2.4vw,2.6rem)] tracking-[-0.04em]">
          STELLARAMP
        </h1>
        <p className="mt-[0.35rem] mb-0 text-[0.88rem] text-[var(--muted)]">
          {subtitle}
        </p>
      </div>
      <button
        type="button"
        onClick={isConnected ? onDisconnect : onConnect}
        disabled={isConnecting}
        className="border-2 border-[var(--accent)] px-4 py-[0.7rem] text-[0.62rem] uppercase tracking-[0.08em] rounded-none bg-transparent hover:bg-[var(--accent)] hover:text-[#0a0a0a] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/60 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {buttonText}
      </button>
    </header>
  );
}
