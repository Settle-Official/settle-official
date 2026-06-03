// WalletConnect v2 adapter for Freighter Mobile

import SignClient from "@walletconnect/sign-client";
import type { SessionTypes } from "@walletconnect/types";

const STELLAR_CHAIN = "stellar:pubnet";
const STELLAR_METHODS = ["stellar_signXDR"];
const RELAY_URL = "wss://relay.walletconnect.com";

let client: SignClient | null = null;
let activeSession: SessionTypes.Struct | null = null;

async function getClient(): Promise<SignClient> {
  // Always create a fresh client — reusing a failed client causes relay errors
  if (client) return client;

  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  if (!projectId || projectId === "your_walletconnect_project_id_here") {
    throw new Error(
      "WalletConnect project ID is not set. Add NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID to .env.local"
    );
  }

  client = await SignClient.init({
    projectId,
    relayUrl: RELAY_URL,
    metadata: {
      name: "Settle",
      description: "Stellar USDC to Naira offramp",
      url: typeof window !== "undefined" ? window.location.origin : "",
      icons: [
        typeof window !== "undefined"
          ? `${window.location.origin}/icons/icon-192.png`
          : "",
      ],
    },
  });

  // Restore existing valid session if any
  const sessions = client.session.getAll();
  if (sessions.length > 0) {
    activeSession = sessions[sessions.length - 1];
  }

  return client;
}

export interface WalletConnectSession {
  publicKey: string;
  topic: string;
}

export async function proposeWalletConnectSession(): Promise<{
  uri: string;
  approval: Promise<WalletConnectSession>;
}> {
  // Reset client on each new proposal so stale relay connections don't cause
  // "failed to publish" errors
  client = null;

  const wc = await getClient();

  const { uri, approval } = await wc.connect({
    requiredNamespaces: {
      stellar: {
        chains: [STELLAR_CHAIN],
        methods: STELLAR_METHODS,
        events: ["accountsChanged"],
      },
    },
  });

  if (!uri) throw new Error("WalletConnect did not return a pairing URI");

  const approvalPromise = approval().then((session) => {
    activeSession = session;
    const account = session.namespaces.stellar?.accounts?.[0] ?? "";
    const publicKey = account.split(":")[2];
    if (!publicKey) throw new Error("No Stellar account in WalletConnect session");
    return { publicKey, topic: session.topic };
  });

  return { uri, approval: approvalPromise };
}

export async function signXdrViaWalletConnect(xdr: string): Promise<string> {
  if (!activeSession) throw new Error("No active WalletConnect session");
  const wc = await getClient();

  const result = await wc.request<{ signedXDR: string }>({
    topic: activeSession.topic,
    chainId: STELLAR_CHAIN,
    request: {
      method: "stellar_signXDR",
      params: { xdr },
    },
  });

  return result.signedXDR;
}

export function getActiveWalletConnectSession(): WalletConnectSession | null {
  if (!activeSession) return null;
  const account = activeSession.namespaces.stellar?.accounts?.[0] ?? "";
  const publicKey = account.split(":")[2];
  return publicKey ? { publicKey, topic: activeSession.topic } : null;
}

export async function disconnectWalletConnect(): Promise<void> {
  if (!activeSession || !client) return;
  try {
    await client.disconnect({
      topic: activeSession.topic,
      reason: { code: 6000, message: "User disconnected" },
    });
  } catch {
    // ignore if already gone
  }
  activeSession = null;
  client = null;
}
