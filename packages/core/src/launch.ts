/**
 * Stake pool creation without the CLI. Every instruction here is ported from the SPL stake pool program
 * (solana-program/stake-pool program/src/instruction.rs + clients/cli command_create_pool) and verified on a
 * Surfpool fork by diffing against the transactions the CLI itself produces (apps/ops e2e --via ts --verify-cli).
 *
 * Signing model for self-service launches: the launcher (user) is the fee payer on every transaction and pays the
 * seed deposit; the backend holds manager + staker and the one-shot account keypairs (mint, pool, validator list,
 * reserve) and adds those signatures server-side. Neither side can complete a step alone.
 */
import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, StakeProgram, Authorized, Lockup,
  SYSVAR_RENT_PUBKEY, SYSVAR_CLOCK_PUBKEY, SYSVAR_STAKE_HISTORY_PUBKEY, STAKE_CONFIG_ID,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, MINT_SIZE, ACCOUNT_SIZE, createInitializeMint2Instruction, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { Fee, Registry } from "./registry.js";
import { STAKE_POOL_PROGRAM_ID, findWithdrawAuthority } from "./stakepool.js";

export const STAKE_STATE_LEN = 200;
/** Pre-SIMD-0437 rent for a 200-byte stake account (6960 lamports/byte). On devnet the stake program still records this as the
 *  account's rent_exempt_reserve even though the RPC quotes the reduced figure, and Initialize underflows if the reserve holds less.
 *  Funding max(rpc, legacy) + 1 is safe everywhere; the surplus is minted to the manager fee account as pool tokens. */
export const LEGACY_STAKE_RENT = 2_282_880n;
export const reserveFunding = (rpcRent: bigint) => (rpcRent > LEGACY_STAKE_RENT ? rpcRent : LEGACY_STAKE_RENT) + 1n;
/** borsh packed length of StakePool (get_packed_len::<StakePool>()); every mainnet pool account is this size */
export const STAKE_POOL_LEN = 611;
export const VALIDATOR_STAKE_INFO_LEN = 73;
export const validatorListLen = (maxValidators: number) => 1 + 4 + 4 + maxValidators * VALIDATOR_STAKE_INFO_LEN; // header(account_type u8 + max_validators u32) + vec len + entries
export const MPL_TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
export const POOL_TOKEN_DECIMALS = 9;

// StakePoolInstruction enum indices (instruction.rs order)
const IX = { Initialize: 0, AddValidatorToPool: 1, SetFee: 12, DepositSol: 14, CreateTokenMetadata: 17 } as const;
// FeeType enum indices (state.rs order)
export const FEE_TYPE = { SolReferral: 0, StakeReferral: 1, Epoch: 2, StakeWithdrawal: 3, SolDeposit: 4, StakeDeposit: 5, SolWithdrawal: 6 } as const;
export type FeeKind = keyof typeof FEE_TYPE;

const u64 = (n: bigint | number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const feeBytes = (f: Fee) => Buffer.concat([u64(f.denominator), u64(f.numerator)]); // Fee { denominator, numerator }
const str = (s: string) => { const b = Buffer.from(s, "utf8"); return Buffer.concat([u32(b.length), b]); };

export const findStakeForValidator = (pool: PublicKey, vote: PublicKey) => PublicKey.findProgramAddressSync([vote.toBuffer(), pool.toBuffer()], STAKE_POOL_PROGRAM_ID)[0];
export const findMetadata = (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("metadata"), MPL_TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()], MPL_TOKEN_METADATA_PROGRAM_ID)[0];

export function ixInitialize(p: { pool: PublicKey; manager: PublicKey; staker: PublicKey; validatorList: PublicKey; reserve: PublicKey; mint: PublicKey; managerFeeAccount: PublicKey; epochFee: Fee; withdrawalFee: Fee; depositFee: Fee; referralFee: number; maxValidators: number }): TransactionInstruction {
  const withdrawAuthority = findWithdrawAuthority(p.pool);
  return new TransactionInstruction({
    programId: STAKE_POOL_PROGRAM_ID,
    keys: [
      { pubkey: p.pool, isSigner: false, isWritable: true },
      { pubkey: p.manager, isSigner: true, isWritable: false },
      { pubkey: p.staker, isSigner: false, isWritable: false },
      { pubkey: withdrawAuthority, isSigner: false, isWritable: false },
      { pubkey: p.validatorList, isSigner: false, isWritable: true },
      { pubkey: p.reserve, isSigner: false, isWritable: false },
      { pubkey: p.mint, isSigner: false, isWritable: true },
      { pubkey: p.managerFeeAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([IX.Initialize]), feeBytes(p.epochFee), feeBytes(p.withdrawalFee), feeBytes(p.depositFee), Buffer.from([p.referralFee & 0xff]), u32(p.maxValidators)]),
  });
}

export function ixSetFee(pool: PublicKey, manager: PublicKey, kind: FeeKind, fee: Fee | number): TransactionInstruction {
  const payload = typeof fee === "number" ? Buffer.from([fee & 0xff]) : feeBytes(fee);
  return new TransactionInstruction({
    programId: STAKE_POOL_PROGRAM_ID,
    keys: [{ pubkey: pool, isSigner: false, isWritable: true }, { pubkey: manager, isSigner: true, isWritable: false }],
    data: Buffer.concat([Buffer.from([IX.SetFee, FEE_TYPE[kind]]), payload]),
  });
}

export function ixAddValidator(p: { pool: PublicKey; staker: PublicKey; reserve: PublicKey; validatorList: PublicKey; vote: PublicKey }): TransactionInstruction {
  const withdrawAuthority = findWithdrawAuthority(p.pool);
  const stake = findStakeForValidator(p.pool, p.vote);
  return new TransactionInstruction({
    programId: STAKE_POOL_PROGRAM_ID,
    keys: [
      { pubkey: p.pool, isSigner: false, isWritable: true },
      { pubkey: p.staker, isSigner: true, isWritable: false },
      { pubkey: p.reserve, isSigner: false, isWritable: true },
      { pubkey: withdrawAuthority, isSigner: false, isWritable: false },
      { pubkey: p.validatorList, isSigner: false, isWritable: true },
      { pubkey: stake, isSigner: false, isWritable: true },
      { pubkey: p.vote, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_STAKE_HISTORY_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: STAKE_CONFIG_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: StakeProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([IX.AddValidatorToPool]), u32(0)]),
  });
}

export function ixDepositSol(p: { pool: PublicKey; reserve: PublicKey; from: PublicKey; destination: PublicKey; managerFeeAccount: PublicKey; mint: PublicKey; lamports: bigint }): TransactionInstruction {
  const withdrawAuthority = findWithdrawAuthority(p.pool);
  return new TransactionInstruction({
    programId: STAKE_POOL_PROGRAM_ID,
    keys: [
      { pubkey: p.pool, isSigner: false, isWritable: true },
      { pubkey: withdrawAuthority, isSigner: false, isWritable: false },
      { pubkey: p.reserve, isSigner: false, isWritable: true },
      { pubkey: p.from, isSigner: true, isWritable: true },
      { pubkey: p.destination, isSigner: false, isWritable: true },
      { pubkey: p.managerFeeAccount, isSigner: false, isWritable: true },
      { pubkey: p.destination, isSigner: false, isWritable: true }, // referrer = depositor, referral fee is 0
      { pubkey: p.mint, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([IX.DepositSol]), u64(p.lamports)]),
  });
}

export function ixCreateTokenMetadata(p: { pool: PublicKey; manager: PublicKey; mint: PublicKey; payer: PublicKey; name: string; symbol: string; uri: string }): TransactionInstruction {
  return new TransactionInstruction({
    programId: STAKE_POOL_PROGRAM_ID,
    keys: [
      { pubkey: p.pool, isSigner: false, isWritable: false },
      { pubkey: p.manager, isSigner: true, isWritable: false },
      { pubkey: findWithdrawAuthority(p.pool), isSigner: false, isWritable: false },
      { pubkey: p.mint, isSigner: false, isWritable: false },
      { pubkey: p.payer, isSigner: true, isWritable: true },
      { pubkey: findMetadata(p.mint), isSigner: false, isWritable: true },
      { pubkey: MPL_TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([IX.CreateTokenMetadata]), str(p.name), str(p.symbol), str(p.uri)]),
  });
}

export interface LaunchKeys { mint: Keypair; pool: Keypair; validatorList: Keypair; reserve: Keypair }
export interface LaunchParams {
  /** fee payer on every transaction; also makes the seed deposit and receives the seed LST */
  payer: PublicKey;
  manager: PublicKey; staker: PublicKey;
  keys: LaunchKeys;
  fees: Registry["fees"];
  maxValidators: number;
  validatorVote: PublicKey;
  name: string; symbol: string; uri: string;
  seedLamports: bigint;
  /** default true. False leaves the pool with no validator (everything stays in the reserve); used on devnet, whose old stake-pool build cannot read current vote accounts. */
  addValidator?: boolean;
  /** default true. False skips the stake-pool CreateTokenMetadata step (devnet's old program build lacks it). */
  createMetadata?: boolean;
}
export type LaunchStep = "accounts" | "initialize" | "seed" | "configure" | "metadata";
export interface LaunchTx {
  step: LaunchStep;
  label: string;
  tx: Transaction;
  /** keypairs the backend must add before the user signs (manager/staker are passed in separately by the caller) */
  backendSigners: Keypair[];
  /** which of manager / staker must sign */
  needsManager: boolean; needsStaker: boolean;
  requiresUser: true;
}
export interface LaunchAddresses { pool: string; mint: string; validatorList: string; reserve: string; managerFeeAccount: string; withdrawAuthority: string; validatorStake: string; metadata: string; payerLstAccount: string }

export interface LaunchCosts { reserveRent: bigint; mintRent: bigint; feeAccountRent: bigint; poolRent: bigint; validatorListRent: bigint; metadataRentEstimate: bigint; seedLamports: bigint; totalLamports: bigint }

export async function launchCosts(conn: Connection, maxValidators: number, seedLamports: bigint): Promise<LaunchCosts> {
  const [reserveRent, mintRent, feeAccountRent, poolRent, validatorListRent, metadataRentEstimate] = (await Promise.all([
    conn.getMinimumBalanceForRentExemption(STAKE_STATE_LEN), conn.getMinimumBalanceForRentExemption(MINT_SIZE), conn.getMinimumBalanceForRentExemption(ACCOUNT_SIZE),
    conn.getMinimumBalanceForRentExemption(STAKE_POOL_LEN), conn.getMinimumBalanceForRentExemption(validatorListLen(maxValidators)), conn.getMinimumBalanceForRentExemption(679),
  ])).map(BigInt);
  const totalLamports = reserveFunding(reserveRent) + mintRent + feeAccountRent + poolRent + validatorListRent + metadataRentEstimate + seedLamports;
  return { reserveRent, mintRent, feeAccountRent, poolRent, validatorListRent, metadataRentEstimate, seedLamports, totalLamports };
}

export function launchAddresses(p: Pick<LaunchParams, "keys" | "manager" | "payer" | "validatorVote">): LaunchAddresses {
  const pool = p.keys.pool.publicKey, mint = p.keys.mint.publicKey;
  return {
    pool: pool.toBase58(), mint: mint.toBase58(), validatorList: p.keys.validatorList.publicKey.toBase58(), reserve: p.keys.reserve.publicKey.toBase58(),
    managerFeeAccount: getAssociatedTokenAddressSync(mint, p.manager, true).toBase58(), withdrawAuthority: findWithdrawAuthority(pool).toBase58(),
    validatorStake: findStakeForValidator(pool, p.validatorVote).toBase58(), metadata: findMetadata(mint).toBase58(), payerLstAccount: getAssociatedTokenAddressSync(mint, p.payer, true).toBase58(),
  };
}

/**
 * The five transactions of a launch, in the order they must land. Blockhashes are NOT set here: the caller sets one
 * right before signing (and again on refresh), then adds backend signatures, then the user signs and submits.
 */
export async function buildLaunchTransactions(conn: Connection, p: LaunchParams): Promise<{ txs: LaunchTx[]; addresses: LaunchAddresses; costs: LaunchCosts }> {
  const costs = await launchCosts(conn, p.maxValidators, p.seedLamports);
  const pool = p.keys.pool.publicKey, mint = p.keys.mint.publicKey, list = p.keys.validatorList.publicKey, reserve = p.keys.reserve.publicKey;
  const withdrawAuthority = findWithdrawAuthority(pool);
  const managerFeeAccount = getAssociatedTokenAddressSync(mint, p.manager, true);
  const payerLst = getAssociatedTokenAddressSync(mint, p.payer, true);
  const mk = (step: LaunchStep, label: string, ixs: TransactionInstruction[], backendSigners: Keypair[], needsManager: boolean, needsStaker: boolean): LaunchTx => {
    const tx = new Transaction(); tx.feePayer = p.payer; tx.add(...ixs);
    return { step, label, tx, backendSigners, needsManager, needsStaker, requiresUser: true };
  };
  const txs: LaunchTx[] = [
    mk("accounts", "Create the reserve, the mint and the fee account", [
      ...StakeProgram.createAccount({ fromPubkey: p.payer, stakePubkey: reserve, authorized: new Authorized(withdrawAuthority, withdrawAuthority), lockup: new Lockup(0, 0, PublicKey.default), lamports: Number(reserveFunding(costs.reserveRent)) }).instructions,
      SystemProgram.createAccount({ fromPubkey: p.payer, newAccountPubkey: mint, lamports: Number(costs.mintRent), space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
      createInitializeMint2Instruction(mint, POOL_TOKEN_DECIMALS, withdrawAuthority, null),
      createAssociatedTokenAccountIdempotentInstruction(p.payer, managerFeeAccount, p.manager, mint),
    ], [p.keys.reserve, p.keys.mint], false, false),
    mk("initialize", `Create the ${p.symbol} stake pool`, [
      SystemProgram.createAccount({ fromPubkey: p.payer, newAccountPubkey: pool, lamports: Number(costs.poolRent), space: STAKE_POOL_LEN, programId: STAKE_POOL_PROGRAM_ID }),
      SystemProgram.createAccount({ fromPubkey: p.payer, newAccountPubkey: list, lamports: Number(costs.validatorListRent), space: validatorListLen(p.maxValidators), programId: STAKE_POOL_PROGRAM_ID }),
      ixInitialize({ pool, manager: p.manager, staker: p.staker, validatorList: list, reserve, mint, managerFeeAccount, epochFee: p.fees.epochFee, withdrawalFee: p.fees.stakeWithdrawalFee, depositFee: p.fees.stakeDepositFee, referralFee: 0, maxValidators: p.maxValidators }),
    ], [p.keys.pool, p.keys.validatorList], true, false),
    mk("seed", `Deposit ${(Number(p.seedLamports) / 1e9).toFixed(2)} SOL to seed the reserve (you receive the same amount of ${p.symbol})`, [
      createAssociatedTokenAccountIdempotentInstruction(p.payer, payerLst, p.payer, mint),
      ixDepositSol({ pool, reserve, from: p.payer, destination: payerLst, managerFeeAccount, mint, lamports: p.seedLamports }),
    ], [], false, false),
    mk("configure", "Set the withdrawal fee and add the validator", [
      ixSetFee(pool, p.manager, "SolWithdrawal", p.fees.solWithdrawalFee),
      ...(p.fees.solDepositFee.numerator > 0 ? [ixSetFee(pool, p.manager, "SolDeposit", p.fees.solDepositFee)] : []),
      ...(p.addValidator === false ? [] : [ixAddValidator({ pool, staker: p.staker, reserve, validatorList: list, vote: p.validatorVote })]),
    ], [], true, p.addValidator !== false), // the staker only signs when add-validator is in the transaction
    ...(p.createMetadata === false ? [] : [mk("metadata", `Name the token ${p.symbol}`, [
      ixCreateTokenMetadata({ pool, manager: p.manager, mint, payer: p.payer, name: p.name, symbol: p.symbol, uri: p.uri }),
    ], [], true, false)]),
  ];
  return { txs, addresses: launchAddresses(p), costs };
}

/** Serialise a launch tx for the wire after the backend has signed: base64 of the wire format with the user's signature still missing. */
export function serializePartial(tx: Transaction): string {
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}
