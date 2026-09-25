import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction, unpackMint, getExtensionTypes, ExtensionType, getAccount, getTransferFeeConfig, type Mint,
} from "@solana/spl-token";
import type { AssetInfo } from "./registry.js";

export const tokenProgramId = (p: AssetInfo["tokenProgram"]) => (p === "token-2022" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID);
export const tokenProgramName = (id: PublicKey): AssetInfo["tokenProgram"] => (id.equals(TOKEN_2022_PROGRAM_ID) ? "token-2022" : "spl-token");

export function ata(mint: PublicKey, owner: PublicKey, program: PublicKey, allowOffCurve = true): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, allowOffCurve, program);
}

export interface MintInfo {
  mint: Mint;
  program: PublicKey;
  extensions: ExtensionType[];
  hasTransferHook: boolean;
}

export async function fetchMintInfo(connection: Connection, mint: PublicKey): Promise<MintInfo> {
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error(`mint ${mint.toBase58()} not found`);
  const program = info.owner;
  const parsed = unpackMint(mint, info, program);
  const extensions = program.equals(TOKEN_2022_PROGRAM_ID) ? getExtensionTypes(parsed.tlvData) : [];
  return { mint: parsed, program, extensions, hasTransferHook: extensions.includes(ExtensionType.TransferHook) };
}

/** Rewards program refuses Token-2022 mints carrying the TransferHook extension (even with a null hook program). */
export function rewardsProgramSupportsMint(m: MintInfo): boolean {
  return !m.hasTransferHook;
}

export async function tokenBalance(connection: Connection, account: PublicKey, program: PublicKey): Promise<bigint> {
  try {
    return (await getAccount(connection, account, "confirmed", program)).amount;
  } catch {
    return 0n;
  }
}

/** Idempotent ATA create + transferChecked. For hook mints with an unset hook program transferChecked needs no extra accounts. */
export function buildDirectPayout(opts: {
  mint: PublicKey; decimals: number; program: PublicKey; from: PublicKey; owner: PublicKey; to: PublicKey; amount: bigint; payer: PublicKey; createAta: boolean;
}): TransactionInstruction[] {
  const dest = ata(opts.mint, opts.to, opts.program);
  const ixs: TransactionInstruction[] = [];
  if (opts.createAta) ixs.push(createAssociatedTokenAccountIdempotentInstruction(opts.payer, dest, opts.to, opts.mint, opts.program));
  ixs.push(createTransferCheckedInstruction(opts.from, opts.mint, dest, opts.owner, opts.amount, opts.decimals, [], opts.program));
  return ixs;
}

/** Live rent-exempt minimum for a token account of the given program (Token-2022 accounts with extensions are larger; we size for the ImmutableOwner ATA layout). */
export async function tokenAccountRent(connection: Connection, program: PublicKey): Promise<bigint> {
  // classic: 165 bytes. Token-2022 ATA: 165 + 1 (account type) + ImmutableOwner TLV (4) = 170; transfer-fee mints add TransferFeeAmount (4 + 8).
  const size = program.equals(TOKEN_2022_PROGRAM_ID) ? 182 : 165;
  return BigInt(await connection.getMinimumBalanceForRentExemption(size));
}

/** True when the pubkey is not on the ed25519 curve, i.e. a PDA rather than a wallet. Program-owned token holders can't receive payouts. */
export function isOffCurve(pubkey: PublicKey): boolean {
  return !PublicKey.isOnCurve(pubkey.toBytes());
}

/** Token-2022 transfer fee for `amount`, in base units, 0 for mints without the extension. */
export function transferFeeFor(m: MintInfo, amount: bigint, epoch: number): bigint {
  if (!m.program.equals(TOKEN_2022_PROGRAM_ID)) return 0n;
  const cfg = getTransferFeeConfig(m.mint);
  if (!cfg) return 0n;
  const f = epoch >= Number(cfg.newerTransferFee.epoch) ? cfg.newerTransferFee : cfg.olderTransferFee;
  const fee = (amount * BigInt(f.transferFeeBasisPoints)) / 10_000n;
  return fee > f.maximumFee ? f.maximumFee : fee;
}
