import { Connection, PublicKey, TransactionInstruction, Signer, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as sp from "@solana/spl-stake-pool";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createApproveInstruction, createTransferInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import type { Fee, LstEntry } from "./registry.js";
import { tokenBalance } from "./token.js";

export const STAKE_POOL_PROGRAM_ID = sp.STAKE_POOL_PROGRAM_ID;
export function findWithdrawAuthority(stakePool: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([stakePool.toBuffer(), Buffer.from("withdraw")], STAKE_POOL_PROGRAM_ID)[0];
}
const bnToBig = (b: BN) => BigInt(b.toString());
const feeOf = (f: { numerator: BN; denominator: BN }): Fee => ({ numerator: Number(f.numerator), denominator: Number(f.denominator) });

export interface PoolStats {
  address: string; mint: string; manager: string; staker: string; reserve: string; managerFeeAccount: string; validatorList: string;
  totalLamports: bigint; poolTokenSupply: bigint; reserveLamports: bigint; reserveRentExempt: bigint;
  activeStakeLamports: bigint; transientLamports: bigint; managerFeeTokens: bigint; lastUpdateEpoch: number; currentEpoch: number; needsUpdate: boolean;
  validators: { vote: string; active: bigint; transient: bigint; status: string }[];
  fees: { epoch: Fee; nextEpoch?: Fee; solWithdrawal: Fee; nextSolWithdrawal?: Fee; stakeWithdrawal: Fee; solDeposit: Fee; stakeDeposit: Fee };
}

export async function getPoolStats(connection: Connection, lst: Pick<LstEntry, "stakePool">): Promise<PoolStats> {
  const poolPk = new PublicKey(lst.stakePool);
  const pool = await sp.getStakePoolAccount(connection, poolPk);
  const d = pool.account.data;
  const [vlInfo, reserveInfo, epochInfo, feeTokens] = await Promise.all([
    connection.getAccountInfo(d.validatorList),
    connection.getAccountInfo(d.reserveStake),
    connection.getEpochInfo(),
    tokenBalance(connection, d.managerFeeAccount, TOKEN_PROGRAM_ID),
  ]);
  if (!vlInfo) throw new Error(`validator list ${d.validatorList.toBase58()} not found`);
  const vl = sp.ValidatorListLayout.decode(vlInfo.data) as unknown as { validators: { voteAccountAddress: PublicKey; activeStakeLamports: BN; transientStakeLamports: BN; status: unknown }[] };
  const validators = vl.validators.map((v) => ({
    vote: v.voteAccountAddress.toBase58(), active: bnToBig(v.activeStakeLamports), transient: bnToBig(v.transientStakeLamports), status: String((v.status as unknown as { __kind?: string })?.__kind ?? v.status),
  }));
  const reserveLamports = BigInt(reserveInfo?.lamports ?? 0);
  const reserveRentExempt = BigInt(await connection.getMinimumBalanceForRentExemption(200));
  return {
    address: poolPk.toBase58(), mint: d.poolMint.toBase58(), manager: d.manager.toBase58(), staker: d.staker.toBase58(), reserve: d.reserveStake.toBase58(),
    managerFeeAccount: d.managerFeeAccount.toBase58(), validatorList: d.validatorList.toBase58(),
    totalLamports: bnToBig(d.totalLamports), poolTokenSupply: bnToBig(d.poolTokenSupply), reserveLamports, reserveRentExempt,
    activeStakeLamports: validators.reduce((n: bigint, v) => n + v.active, 0n), transientLamports: validators.reduce((n: bigint, v) => n + v.transient, 0n),
    managerFeeTokens: feeTokens, lastUpdateEpoch: Number(d.lastUpdateEpoch), currentEpoch: epochInfo.epoch, needsUpdate: Number(d.lastUpdateEpoch) < epochInfo.epoch,
    validators,
    fees: {
      epoch: feeOf(d.epochFee), nextEpoch: d.nextEpochFee ? feeOf(d.nextEpochFee) : undefined, solWithdrawal: feeOf(d.solWithdrawalFee),
      nextSolWithdrawal: d.nextSolWithdrawalFee ? feeOf(d.nextSolWithdrawalFee) : undefined, stakeWithdrawal: feeOf(d.stakeWithdrawalFee), solDeposit: feeOf(d.solDepositFee), stakeDeposit: feeOf(d.stakeDepositFee),
    },
  };
}

export interface Built { instructions: TransactionInstruction[]; signers: Signer[] }

/** Deposit SOL, receive LST in the depositor's ATA (created idempotently). */
export async function buildDepositSol(connection: Connection, lst: Pick<LstEntry, "stakePool">, from: PublicKey, lamports: bigint): Promise<Built> {
  const r = await sp.depositSol(connection, new PublicKey(lst.stakePool), from, Number(lamports));
  return { instructions: r.instructions, signers: r.signers };
}

/** Redeem LST from the owner's ATA for SOL from the reserve. amount in LST base units (1:1 lamports). */
export async function buildWithdrawSol(connection: Connection, lst: Pick<LstEntry, "stakePool">, owner: PublicKey, poolTokens: bigint, solReceiver = owner, sourcePoolAccount?: PublicKey): Promise<Built> {
  const poolPk = new PublicKey(lst.stakePool);
  const pool = await sp.getStakePoolAccount(connection, poolPk);
  const d = pool.account.data;
  const source = sourcePoolAccount ?? getAssociatedTokenAddressSync(d.poolMint, owner, true);
  const withdrawAuthority = findWithdrawAuthority(poolPk);
  const transferAuthority = Keypair.generate();
  const instructions = [
    createApproveInstruction(source, transferAuthority.publicKey, owner, poolTokens),
    sp.StakePoolInstruction.withdrawSol({
      stakePool: poolPk, sourcePoolAccount: source, withdrawAuthority, reserveStake: d.reserveStake, destinationSystemAccount: solReceiver,
      sourceTransferAuthority: transferAuthority.publicKey, solWithdrawAuthority: d.solWithdrawAuthority ?? undefined, managerFeeAccount: d.managerFeeAccount, poolMint: d.poolMint, poolTokens: Number(poolTokens),
    }),
  ];
  return { instructions, signers: [transferAuthority] };
}

/** Deposit an active stake account (delegated to the pool's validator) for LST. */
export async function buildDepositStake(connection: Connection, lst: Pick<LstEntry, "stakePool">, authorized: PublicKey, validatorVote: PublicKey, stakeAccount: PublicKey): Promise<Built> {
  const r = await sp.depositStake(connection, new PublicKey(lst.stakePool), authorized, validatorVote, stakeAccount);
  return { instructions: r.instructions, signers: r.signers };
}

/** Full epoch update: returns two phases; send updateList txs first (5 validators per ix), then final. */
export async function buildUpdatePool(connection: Connection, lst: Pick<LstEntry, "stakePool">): Promise<{ updateList: TransactionInstruction[]; final: TransactionInstruction[] }> {
  const pool = await sp.getStakePoolAccount(connection, new PublicKey(lst.stakePool));
  const r = await sp.updateStakePool(connection, pool);
  return { updateList: r.updateListInstructions, final: r.finalInstructions };
}

export async function buildIncreaseValidatorStake(connection: Connection, lst: Pick<LstEntry, "stakePool">, vote: PublicKey, lamports: bigint): Promise<TransactionInstruction[]> {
  return (await sp.increaseValidatorStake(connection, new PublicKey(lst.stakePool), vote, Number(lamports))).instructions;
}

export async function buildDecreaseValidatorStake(connection: Connection, lst: Pick<LstEntry, "stakePool">, vote: PublicKey, lamports: bigint): Promise<TransactionInstruction[]> {
  return (await sp.decreaseValidatorStake(connection, new PublicKey(lst.stakePool), vote, Number(lamports))).instructions;
}

export async function buildAddValidator(connection: Connection, lst: Pick<LstEntry, "stakePool">, vote: PublicKey): Promise<TransactionInstruction[]> {
  return (await sp.addValidatorToPool(connection, new PublicKey(lst.stakePool), vote)).instructions;
}

export async function buildCreatePoolTokenMetadata(connection: Connection, lst: Pick<LstEntry, "stakePool">, payer: PublicKey, name: string, symbol: string, uri: string): Promise<TransactionInstruction[]> {
  return (await sp.createPoolTokenMetadata(connection, new PublicKey(lst.stakePool), payer, name, symbol, uri)).instructions;
}

/** Move fee tokens from a non-ATA manager fee account into the manager's ATA (only needed if the CLI made a plain account). */
export function buildMoveFeeTokensToAta(mint: PublicKey, managerFeeAccount: PublicKey, manager: PublicKey, amount: bigint): { ata: PublicKey; instructions: TransactionInstruction[] } {
  const dest = getAssociatedTokenAddressSync(mint, manager, true);
  if (dest.equals(managerFeeAccount)) return { ata: dest, instructions: [] };
  return {
    ata: dest,
    instructions: [createAssociatedTokenAccountIdempotentInstruction(manager, dest, manager, mint), createTransferInstruction(managerFeeAccount, dest, manager, amount)],
  };
}

/** Reserve policy: how many lamports should sit liquid in the reserve. */
export function reserveTarget(stats: Pick<PoolStats, "totalLamports" | "reserveRentExempt">, policy: { targetBps: number; minSol: number }): bigint {
  const byBps = (stats.totalLamports * BigInt(policy.targetBps)) / 10_000n;
  const min = BigInt(Math.round(policy.minSol * LAMPORTS_PER_SOL));
  return (byBps > min ? byBps : min) + stats.reserveRentExempt;
}
