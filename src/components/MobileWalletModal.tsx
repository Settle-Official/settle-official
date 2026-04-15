"use client";

import { useEffect, useState } from "react";
import { openFreighterMobile, openLobstrMobile } from "@/lib/stellar/wallet-adapter";

interface MobileWalletModalProps {
  onClose: () => void;
}

export function MobileWalletModal({ onClose }: MobileWalletModalProps) {
  const [visible, setVisible] = useState(false);
  const appUrl = typeof window !== "undefined" ? window.location.href : "";

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-300 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="racing-border-wrapper relative z-10">
        <div className="racing-border-content min-w-[380px] max-w-[440px] max-[500px]:min-w-[90vw] bg-[#0c0c0c] p-6">
          <div className="mb-5 flex items-center justify-between">
            <h3 className="m-0 font-space-grotesk text-[1.1rem] font-bold tracking-[-0.02em]">
              CONNECT WALLET
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="text-[var(--muted)] hover:text-white transition-colors text-[1.2rem] leading-none"
            >
              ✕
            </button>
          </div>

          <p className="m-0 mb-4 font-mono text-[0.78rem] text-[var(--muted)]">
            Open this app inside your wallet&apos;s built-in browser to connect.
          </p>

          <div className="flex flex-col gap-[0.1rem]">
            {[
              {
                label: "Freighter",
                sub: "Open Stellaramp in Freighter browser",
                onClick: () => { openFreighterMobile(appUrl); onClose(); },
              },
              {
                label: "Lobstr",
                sub: "Open Stellaramp in Lobstr browser",
                onClick: () => { openLobstrMobile(appUrl); onClose(); },
              },
            ].map(({ label, sub, onClick }) => (
              <button
                key={label}
                type="button"
                onClick={onClick}
                className="flex items-center gap-3 bg-[#1a1a1a] px-3 py-[0.75rem] text-left font-mono text-[0.82rem] text-white transition-colors hover:bg-[#222] focus:outline-none"
              >
                <span className="flex-shrink-0 w-5 text-center text-[var(--accent)]">→</span>
                <span className="flex flex-col">
                  <span className="font-bold tracking-[0.04em]">{label}</span>
                  <span className="text-[0.72rem] text-[var(--muted)]">{sub}</span>
                </span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="mt-4 w-full py-3 text-[0.8rem] font-bold uppercase tracking-[0.08em] transition-colors bg-[var(--accent)] text-[#0a0a0a] hover:brightness-110"
          >
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
}
