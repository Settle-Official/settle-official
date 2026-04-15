"use client";

import { useEffect, useState } from "react";
import { proposeWalletConnectSession } from "@/lib/stellar/walletconnect-adapter";

interface MobileWalletModalProps {
  onClose: () => void;
  onConnected: (publicKey: string) => void;
}

type ModalState = "idle" | "connecting" | "waiting" | "error";

export function MobileWalletModal({ onClose, onConnected }: MobileWalletModalProps) {
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<ModalState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  async function handleConnect() {
    setState("connecting");
    setErrorMsg("");
    try {
      const { uri, approval } = await proposeWalletConnectSession();

      // Deep-link the wc: URI into Freighter mobile
      const deepLink = `freighterwallet://wc?uri=${encodeURIComponent(uri)}`;
      const isAndroid = /Android/i.test(navigator.userAgent);
      const storeUrl = isAndroid
        ? "https://play.google.com/store/apps/details?id=org.stellar.freighterwallet"
        : "https://apps.apple.com/app/freighter/id6743947720";

      const start = Date.now();
      window.location.href = deepLink;
      setTimeout(() => {
        if (Date.now() - start < 2000) window.open(storeUrl, "_blank");
      }, 1500);

      setState("waiting");

      // Wait for user to approve in Freighter
      const session = await approval;
      onConnected(session.publicKey);
      onClose();
    } catch (err: any) {
      // Surface the real error — "failed to publish" usually means bad project ID
      // or relay connectivity issue
      const msg = err?.message || "Connection failed";
      setErrorMsg(
        msg.toLowerCase().includes("project")
          ? msg
          : msg.toLowerCase().includes("publish") || msg.toLowerCase().includes("relay")
          ? "Could not reach WalletConnect relay. Check your project ID and internet connection."
          : msg
      );
      setState("error");
    }
  }

  const statusText: Record<ModalState, string> = {
    idle: "",
    connecting: "Generating session...",
    waiting: "Approve the connection in Freighter",
    error: "",
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-300 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={state === "waiting" ? undefined : onClose} />

      <div className="racing-border-wrapper relative z-10">
        <div className="racing-border-content min-w-[380px] max-w-[440px] max-[500px]:min-w-[90vw] bg-[#0c0c0c] p-6">
          <div className="mb-5 flex items-center justify-between">
            <h3 className="m-0 font-space-grotesk text-[1.1rem] font-bold tracking-[-0.02em]">
              CONNECT WALLET
            </h3>
            {state !== "waiting" && (
              <button
                type="button"
                onClick={onClose}
                className="text-[var(--muted)] hover:text-white transition-colors text-[1.2rem] leading-none"
              >
                ✕
              </button>
            )}
          </div>

          {state === "idle" && (
            <>
              <p className="m-0 mb-4 font-mono text-[0.78rem] text-[var(--muted)]">
                Connect using Freighter mobile via WalletConnect.
              </p>
              <button
                type="button"
                onClick={handleConnect}
                className="flex w-full items-center gap-3 bg-[#1a1a1a] px-3 py-[0.75rem] text-left font-mono text-[0.82rem] text-white transition-colors hover:bg-[#222] focus:outline-none"
              >
                <span className="flex-shrink-0 w-5 text-center text-[var(--accent)]">→</span>
                <span className="flex flex-col">
                  <span className="font-bold tracking-[0.04em]">Connect with Freighter</span>
                  <span className="text-[0.72rem] text-[var(--muted)]">Opens Freighter app to approve</span>
                </span>
              </button>
            </>
          )}

          {(state === "connecting" || state === "waiting") && (
            <div className="flex flex-col items-center gap-4 py-4">
              <span className="inline-block animate-spin-slow text-[2rem] text-[var(--accent)]">◌</span>
              <p className="m-0 font-mono text-[0.82rem] text-[var(--muted)] text-center">
                {statusText[state]}
              </p>
              {state === "waiting" && (
                <p className="m-0 font-mono text-[0.72rem] text-[var(--muted)] text-center opacity-60">
                  Switch back here once approved
                </p>
              )}
            </div>
          )}

          {state === "error" && (
            <>
              <div className="flex flex-col items-center gap-3 py-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-red-500 text-[1.4rem] text-red-500">
                  ✕
                </div>
                <p className="m-0 font-space-grotesk text-[0.9rem] font-bold text-red-400">Connection Failed</p>
                <p className="m-0 font-mono text-[0.75rem] text-[var(--muted)] text-center">{errorMsg}</p>
              </div>
              <button
                type="button"
                onClick={() => setState("idle")}
                className="mt-2 w-full py-3 text-[0.8rem] font-bold uppercase tracking-[0.08em] transition-colors bg-[var(--accent)] text-[#0a0a0a] hover:brightness-110"
              >
                TRY AGAIN
              </button>
            </>
          )}

          {state === "idle" && (
            <button
              type="button"
              onClick={onClose}
              className="mt-4 w-full py-3 text-[0.8rem] font-bold uppercase tracking-[0.08em] transition-colors bg-[var(--accent)] text-[#0a0a0a] hover:brightness-110"
            >
              CANCEL
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
