import { StrKey, xdr } from "@stellar/stellar-sdk";

/**
 * CCTP `mintRecipient`/`destinationCaller` fields are always bytes32. For a
 * plain 20-byte EVM address, left-pad with 12 zero bytes (matches the
 * existing left-pad logic already used for the old Allbridge integration in
 * soroban-tx-builder.ts's swap_and_bridge call).
 */
export function evmAddressToScvBytes32(evmAddress: string): xdr.ScVal {
  const hex = evmAddress.replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(hex)) {
    throw new Error(`Invalid EVM address: ${evmAddress}`);
  }
  const padded = Buffer.concat([Buffer.alloc(12), Buffer.from(hex, "hex")]);
  return xdr.ScVal.scvBytes(padded);
}

/** Decode a Stellar contract strkey (C...) into its raw 32-byte bytes32 hex form. */
export function contractStrkeyToBytes32Hex(strkey: string): `0x${string}` {
  if (!StrKey.isValidContract(strkey)) {
    throw new Error(`Invalid contract strkey: ${strkey}`);
  }
  const hex = Buffer.from(StrKey.decodeContract(strkey)).toString("hex");
  return `0x${hex}`;
}

/** `destination_caller` of all-zero bytes32 means "anyone may call receiveMessage". */
export function zeroBytes32Scval(): xdr.ScVal {
  return xdr.ScVal.scvBytes(Buffer.alloc(32));
}

/**
 * Byte layout per Circle's Stellar CCTP docs:
 *   bytes 0-23:  zero padding
 *   bytes 24-27: hook version (u32, currently 0)
 *   bytes 28-31: forward recipient strkey byte length (u32)
 *   bytes 32+:   forward recipient strkey as UTF-8
 *
 * Used only when the CCTP destination is Stellar and the real recipient is a
 * plain account (G...) or muxed (M...) address — CCTP treats `mintRecipient`
 * as a contract address on Stellar, so account/muxed recipients must go
 * through CctpForwarder with the real address carried in this hook data.
 */
export function buildForwarderHookData(
  forwardRecipientStrkey: string,
): `0x${string}` {
  const isValid =
    StrKey.isValidEd25519PublicKey(forwardRecipientStrkey) ||
    StrKey.isValidContract(forwardRecipientStrkey) ||
    StrKey.isValidMed25519PublicKey(forwardRecipientStrkey);
  if (!isValid) {
    throw new Error(
      `Invalid forward recipient: ${forwardRecipientStrkey} (expected G..., C..., or M... address)`,
    );
  }
  const recipientBytes = Buffer.from(forwardRecipientStrkey, "utf8");
  const hookData = Buffer.alloc(32 + recipientBytes.length);
  hookData.writeUInt32BE(0, 24); // hook version = 0
  hookData.writeUInt32BE(recipientBytes.length, 28);
  recipientBytes.copy(hookData, 32);
  return `0x${hookData.toString("hex")}`;
}
