import { getCctpTransfer, updateCctpTransfer, type CctpStatus } from "./cctp-store";
import { fetchAttestation, reattest } from "./iris-client";
import { submitBaseMint } from "./base-cctp";
import { submitMintAndForward } from "./stellar-cctp";

const MAX_ATTEMPTS = 20;

/**
 * Advances one CCTP transfer by whatever it's currently waiting on. Safe to
 * call repeatedly/concurrently for the same id — each step is a Redis
 * read-modify-write, and re-submitting a mint for an already-processed nonce
 * fails harmlessly onchain (CCTP nonces are single-use) rather than
 * double-minting.
 */
export async function advanceCctpTransfer(id: string): Promise<CctpStatus> {
  const record = await getCctpTransfer(id);
  if (!record) throw new Error(`No CCTP transfer record for id ${id}`);
  if (record.status === "completed" || record.status === "failed") {
    return record.status;
  }

  try {
    if (record.status === "burned" || record.status === "attesting") {
      const attestation = await fetchAttestation({
        sourceDomain: record.sourceDomain,
        transactionHash: record.burnTxHash,
      });
      if (!attestation) {
        await updateCctpTransfer(id, {
          status: "attesting",
          attempts: record.attempts + 1,
        });
        return "attesting";
      }
      await updateCctpTransfer(id, {
        status: "attested",
        attestationMessage: attestation.message,
        attestationSignature: attestation.attestation,
      });
      return "attested";
    }

    if (record.status === "attested") {
      if (!record.attestationMessage || !record.attestationSignature) {
        throw new Error("attested status but attestation fields missing");
      }
      const mintTxHash =
        record.direction === "offramp"
          ? await submitBaseMint({
              messageHex: record.attestationMessage,
              attestationHex: record.attestationSignature,
            })
          : await submitMintAndForward({
              messageHex: record.attestationMessage,
              attestationHex: record.attestationSignature,
            });
      await updateCctpTransfer(id, { status: "minting", mintTxHash });
      return "minting";
    }

    if (record.status === "minting") {
      // Mint tx was submitted and awaited inside the submitter itself
      // (submitBaseMint/submitMintAndForward both wait for confirmation
      // before returning), so reaching this state on a later tick means the
      // previous tick's submission is done — mark complete.
      await updateCctpTransfer(id, { status: "completed" });
      return "completed";
    }

    return record.status;
  } catch (error: any) {
    const attempts = record.attempts + 1;
    const isExpiredAttestation =
      typeof error?.message === "string" && error.message.includes("expired");
    if (isExpiredAttestation && record.attestationMessage) {
      try {
        await reattest(record.attestationMessage);
        await updateCctpTransfer(id, {
          status: "attesting",
          attestationMessage: undefined,
          attestationSignature: undefined,
          attempts,
        });
        return "attesting";
      } catch {
        // fall through to generic failure handling below
      }
    }
    await updateCctpTransfer(id, {
      attempts,
      lastError: error?.message || String(error),
      status: attempts >= MAX_ATTEMPTS ? "failed" : record.status,
    });
    return attempts >= MAX_ATTEMPTS ? "failed" : record.status;
  }
}
