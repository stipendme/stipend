import { Connection, PublicKey, Transaction, TransactionInstruction, type Signer } from "@solana/web3.js";
import {
  getStakePoolAccount,
  depositSol,
  withdrawSol,
  updateStakePool,
  increaseValidatorStake,
  decreaseValidatorStake,
} from "@solana/spl-stake-pool";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { LstEntry } from "./types";

// TODO-swap: @stipend/core buildDepositSol / buildWithdrawSol / buildUpdatePool / buildIncrease/DecreaseValidatorStake.

export interface Built {
  instructions: TransactionInstruction[];
  signers: Signer[];
}

export function assetTokenProgram(lst: LstEntry): PublicKey {
  return lst.asset.tokenProgram === "token-2022" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
}

export function assetAta(lst: LstEntry, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(new PublicKey(lst.asset.mint), owner, false, assetTokenProgram(lst));
}

/** Does this wallet already have a token account for the LST's payout asset? */
export async function hasAssetAccount(connection: Connection, lst: LstEntry, owner: PublicKey): Promise<boolean> {
  if (!lst.asset.mint) return true;
  return !!(await connection.getAccountInfo(assetAta(lst, owner)));
}

/** Idempotent create of the wallet's token account for the payout asset. The wallet pays the rent, once. */
export function buildOpenAssetAccount(lst: LstEntry, owner: PublicKey): TransactionInstruction {
  return createAssociatedTokenAccountIdempotentInstruction(owner, assetAta(lst, owner), owner, new PublicKey(lst.asset.mint), assetTokenProgram(lst));
}

/** Rent-exempt minimum for a token account (165 bytes) at the current rent rate, in lamports. */
export async function tokenAccountRent(connection: Connection): Promise<number> {
  return connection.getMinimumBalanceForRentExemption(165);
}

/**
 * Mint: deposit SOL for LST, and open the payout asset's token account in the same transaction when the wallet
 * lacks one, so the first epoch pays straight into it with no platform-funded rent.
 */
export async function buildDepositSol(connection: Connection, lst: LstEntry, from: PublicKey, lamports: number, opts: { openAssetAccount?: boolean } = {}): Promise<Built> {
  const { instructions, signers } = await depositSol(connection, new PublicKey(lst.stakePool), from, lamports);
  const ixs = opts.openAssetAccount ? [buildOpenAssetAccount(lst, from), ...instructions] : instructions;
  return { instructions: ixs, signers };
}

export async function buildWithdrawSol(connection: Connection, lst: LstEntry, owner: PublicKey, poolTokens: number): Promise<Built> {
  const { instructions, signers } = await withdrawSol(connection, new PublicKey(lst.stakePool), owner, owner, poolTokens);
  return { instructions, signers };
}

/** Two phases: update validator list balances, then update the pool balance + cleanup. */
export async function buildUpdatePool(connection: Connection, lst: LstEntry): Promise<{ phase1: TransactionInstruction[]; phase2: TransactionInstruction[] }> {
  const account = await getStakePoolAccount(connection, new PublicKey(lst.stakePool));
  const { updateListInstructions, finalInstructions } = await updateStakePool(connection, account);
  return { phase1: updateListInstructions, phase2: finalInstructions };
}

export async function buildIncreaseValidatorStake(connection: Connection, lst: LstEntry, vote: string, lamports: number): Promise<Built> {
  const { instructions } = await increaseValidatorStake(connection, new PublicKey(lst.stakePool), new PublicKey(vote), lamports);
  return { instructions, signers: [] };
}

export async function buildDecreaseValidatorStake(connection: Connection, lst: LstEntry, vote: string, lamports: number): Promise<Built> {
  const { instructions } = await decreaseValidatorStake(connection, new PublicKey(lst.stakePool), new PublicKey(vote), lamports);
  return { instructions, signers: [] };
}

/** Splits instructions into transactions of at most `per` instructions. */
export function chunkIntoTxs(ixs: TransactionInstruction[], per: number, payer: PublicKey): Transaction[] {
  const txs: Transaction[] = [];
  for (let i = 0; i < ixs.length; i += per) {
    const tx = new Transaction();
    tx.feePayer = payer;
    tx.add(...ixs.slice(i, i + per));
    txs.push(tx);
  }
  return txs;
}

export async function sendAll(
  connection: Connection,
  txs: Transaction[],
  signers: Signer[],
  signAll: (txs: Transaction[]) => Promise<Transaction[]>,
): Promise<string[]> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  for (const tx of txs) {
    tx.recentBlockhash = blockhash;
    if (signers.length) tx.partialSign(...signers);
  }
  const signed = await signAll(txs);
  const sigs: string[] = [];
  for (const tx of signed) {
    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    sigs.push(sig);
  }
  return sigs;
}
