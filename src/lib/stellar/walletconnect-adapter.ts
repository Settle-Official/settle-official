// WalletConnect v2 adapter for Freighter Mobile
// Freighter mobile only supports WalletConnect — no browser extension injection

import SignClient from "@walletconnect/sign-client";
import type { SessionTypes } from "@walletconnect/types";

const STELLAR_CHAIN = "stellar:pubnet";
const STELLAR_METHODS = ["stellar_signXDR"];

let client: SignClient | null = null;
let activeSession: SessionTypes.Struct | null = null;

async function getClient(): Promise<SignClient> {
  if (client) return client;
  client = await SignClient.init({
    projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!,
    metadata: {
      name: "Stellaramp",
      description: "Stellar USDC to Naira offramp",
      url: typeof window !== "undefined" ? window.location.origin : "",
      icons: ["/icons/icon-192.png"],
    },
  });

  // Restore existing session if any
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

/**
 * Create a WalletConnect session proposal.
 * Returns the wc: URI to deep-link into Freighter and a promise that resolves
 * when the user approves the session in the wallet.
 */
export async function proposeWalletConnectSession(): Promise<{
  uri: string;
  approval: Promise<WalletConnectSession>;
}> {
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
    // accounts format: "stellar:pubnet:GABC..."
    const account = session.namespaces.stellar?.accounts?.[0] ?? "";
    const publicKey = account.split(":")[2];
    if (!publicKey) throw new Error("No Stellar account in WalletConnect session");
    return { publicKey, topic: session.topic };
  });

  return { uri, approval: approvalPromise };
}

/**
 * Sign a transaction XDR via WalletConnect (Freighter mobile).
 */
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
}
