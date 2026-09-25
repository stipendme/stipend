/**
 * Devnet/testnet environment: test asset mints, a registry copy, two live pools.
 *   RPC_URL=https://api.devnet.solana.com STIPEND_KEYS_DIR=keys/devnet STIPEND_REGISTRY=config/registry.devnet.json pnpm ops testnet setup
 * Phantom's "Testnet mode" uses Solana DEVNET, so devnet is the cluster a phone tester actually reaches.
 */
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, ExtensionType, getMintLen, TYPE_SIZE, LENGTH_SIZE,
  createInitializeMintInstruction, createInitializeMetadataPointerInstruction, createInitializeTransferHookInstruction, createInitializeTransferFeeConfigInstruction,
} from "@solana/spl-token";
import { createInitializeInstruction as createInitializeMetadataInstruction, pack, type TokenMetadata } from "@solana/spl-token-metadata";
import { findRepoRoot, loadRegistry, saveRegistry, makeConnection, getNetwork, loadKeypair, getPoolStats, type Registry, type LstEntry } from "@stipend/core";
import { createLstTs } from "./createLst.js";
import { adminLive } from "./admin.js";

// test assets: symbol -> { mainnet price mint, decimals, transfer hook (null program) like the real xStocks }
const TEST_ASSETS: Record<string, { name: string; priceMint: string; decimals: number; hook: boolean; category: string; transferFeeBps?: number; logo?: string }> = {
  // PreStocks mirror the mainnet mints: Token-2022, null transfer hook, 3% transfer fee (mainnet also has pausable, permanent delegate, freeze)
  ANTHROPIC: { name: "Anthropic PreStocks", priceMint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw", decimals: 9, hook: true, category: "prestock", transferFeeBps: 300, logo: "https://www.prestocks.com/logos/anthropic.png?cachebust=1" },
  OPENAI: { name: "OpenAI PreStocks", priceMint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF", decimals: 9, hook: true, category: "prestock", transferFeeBps: 300, logo: "https://www.prestocks.com/logos/openai.png?cachebust=1" },
  NVDAx: { name: "NVIDIA xStock", priceMint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", decimals: 8, hook: true, category: "stock" },
  AAPLx: { name: "Apple xStock", priceMint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", decimals: 8, hook: true, category: "stock" },
  TSLAx: { name: "Tesla xStock", priceMint: "XsDoVfqeBukxuZHWhdvWHBhgnNdZbqqhpqq4vrgN9mv", decimals: 8, hook: true, category: "stock" },
  SPYx: { name: "SP500 xStock", priceMint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", decimals: 8, hook: true, category: "etf" },
  GLDx: { name: "Gold xStock", priceMint: "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re", decimals: 8, hook: true, category: "metal" },
  cbBTC: { name: "Coinbase Wrapped BTC", priceMint: "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij", decimals: 8, hook: false, category: "crypto" },
  USDC: { name: "USD Coin", priceMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, hook: false, category: "stable" },
};
const LSTS: Record<string, string> = { anthSOL: "ANTHROPIC", openaiSOL: "OPENAI", nvdaSOL: "NVDAx", aaplSOL: "AAPLx", tslaSOL: "TSLAx", spySOL: "SPYx", goldSOL: "GLDx", btcSOL: "cbBTC", usdcSOL: "USDC" };

function keysDir(root: string) { return process.env.STIPEND_KEYS_DIR ?? join(root, "keys", "devnet"); }
function regPath(root: string) { return process.env.STIPEND_REGISTRY ?? join(root, "config", "registry.devnet.json"); }

async function createTestMint(conn: Connection, payer: Keypair, authorityKp: Keypair, symbol: string, spec: (typeof TEST_ASSETS)[string], mintKp: Keypair, uri: string) {
  const authority = authorityKp.publicKey;
  const metadata: TokenMetadata = { mint: mintKp.publicKey, name: `${symbol} (devnet)`, symbol, uri, updateAuthority: authority, additionalMetadata: [] };
  const exts = [ExtensionType.MetadataPointer, ...(spec.hook ? [ExtensionType.TransferHook] : []), ...(spec.transferFeeBps ? [ExtensionType.TransferFeeConfig] : [])];
  const mintLen = getMintLen(exts);
  const space = mintLen + TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
  const lamports = await conn.getMinimumBalanceForRentExemption(space);
  const tx = new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mintKp.publicKey, space: mintLen, lamports, programId: TOKEN_2022_PROGRAM_ID }),
    createInitializeMetadataPointerInstruction(mintKp.publicKey, authority, mintKp.publicKey, TOKEN_2022_PROGRAM_ID),
  );
  if (spec.hook) tx.add(createInitializeTransferHookInstruction(mintKp.publicKey, authority, PublicKey.default, TOKEN_2022_PROGRAM_ID));
  if (spec.transferFeeBps) tx.add(createInitializeTransferFeeConfigInstruction(mintKp.publicKey, authority, authority, spec.transferFeeBps, BigInt("18446744073709551615"), TOKEN_2022_PROGRAM_ID));
  tx.add(
    createInitializeMintInstruction(mintKp.publicKey, spec.decimals, authority, null, TOKEN_2022_PROGRAM_ID),
    createInitializeMetadataInstruction({ programId: TOKEN_2022_PROGRAM_ID, metadata: mintKp.publicKey, updateAuthority: authority, mint: mintKp.publicKey, mintAuthority: authority, name: metadata.name, symbol, uri }),
  );
  // the metadata initialize instruction is signed by the mint authority (the worker)
  const sig = await sendAndConfirmTransaction(conn, tx, [payer, mintKp, authorityKp], { commitment: "confirmed" });
  return sig;
}

export async function testnetSetup(args: { symbols?: string; skipPools?: boolean }) {
  const root = findRepoRoot();
  const conn = makeConnection();
  const net = await getNetwork(conn);
  if (net === "mainnet-beta") throw new Error("refusing: RPC_URL is mainnet");
  const kd = keysDir(root);
  const rp = regPath(root);
  const worker = loadKeypair(join(kd, "worker.json"));
  const manager = loadKeypair(join(kd, "manager.json"));
  console.log(`network ${net}; keys ${kd}; registry ${rp}; worker ${worker.publicKey.toBase58()} (test mint authority)`);
  for (const [n, kp] of [["manager", manager], ["worker", worker]] as const) console.log(`  ${n} balance ${(await conn.getBalance(kp.publicKey)) / LAMPORTS_PER_SOL} SOL`);

  // registry copy
  let reg: Registry;
  if (existsSync(rp)) reg = loadRegistry(rp);
  else {
    reg = loadRegistry(join(root, "config", "registry.json"));
    reg.network = net === "testnet" ? "testnet" : "devnet";
    reg.lsts = [];
    reg.treasury = loadKeypair(join(kd, "treasury.json")).publicKey.toBase58();
    reg.demo = { enabled: true, intervalMinutes: 60, apyPct: 5 };
    reg.distribution = { ...reg.distribution, minSwapLamports: 1_000_000 };
    reg.reserve = { targetBps: 1000, minSol: 1 };
    // validator: highest-stake non-delinquent vote account on this cluster
    const va = await conn.getVoteAccounts();
    const best = [...va.current].sort((a, b) => b.activatedStake - a.activatedStake)[0];
    reg.validator = { ...reg.validator, voteAccount: best.votePubkey, name: `${net} validator ${best.votePubkey.slice(0, 6)}` };
    saveRegistry(reg, rp);
    console.log(`wrote ${rp}: validator ${best.votePubkey} (${Math.round(best.activatedStake / 1e9)} SOL)`);
  }

  // test mints
  const wanted = (args.symbols ? args.symbols.split(",") : Object.keys(LSTS)).map((s) => s.trim()).filter(Boolean);
  for (const lstSym of wanted) {
    const assetSym = LSTS[lstSym];
    if (!assetSym) throw new Error(`unknown LST ${lstSym}`);
    const spec = TEST_ASSETS[assetSym];
    let entry = reg.lsts.find((l) => l.symbol === lstSym);
    if (!entry) {
      const mintPath = join(kd, `asset-${assetSym}.json`);
      let mintKp: Keypair;
      if (existsSync(mintPath)) mintKp = loadKeypair(mintPath);
      else { mintKp = Keypair.generate(); writeFileSync(mintPath, JSON.stringify(Array.from(mintKp.secretKey))); }
      if (!(await conn.getAccountInfo(mintKp.publicKey))) {
        const sig = await createTestMint(conn, manager, worker, assetSym, spec, mintKp, `https://${reg.brand.domain}/meta/asset-${assetSym}.json`);
        console.log(`created test mint ${assetSym} ${mintKp.publicKey.toBase58()}: ${sig}`);
      } else console.log(`test mint ${assetSym} ${mintKp.publicKey.toBase58()} exists`);
      entry = {
        symbol: lstSym, name: `Stipend ${spec.name.replace(" xStock", "").replace(" PreStocks", "")} SOL`, blurb: `Hold ${lstSym}, get paid ${assetSym} every epoch.`,
        asset: { symbol: assetSym, name: spec.name, mint: mintKp.publicKey.toBase58(), decimals: spec.decimals, tokenProgram: "token-2022", category: spec.category, priceMint: spec.priceMint, logo: spec.logo ?? `/tokens/assets/${assetSym}.png` },
        stakePool: "", mint: "", validatorList: "", reserve: "", managerFeeAccount: "", createdEpoch: 0, status: "draft", delivery: "direct",
      } as LstEntry;
      reg.lsts.push(entry);
      saveRegistry(reg, rp);
    }
  }
  if (args.skipPools) return;

  // pools (TS launch path; manager pays and is the creator so the seed LST lands with it)
  for (const lstSym of wanted) {
    const entry = reg.lsts.find((l) => l.symbol === lstSym)!;
    if (entry.stakePool) { console.log(`${lstSym}: pool ${entry.stakePool} exists`); continue; }
    const mintPath = join(kd, `${lstSym.toLowerCase()}-mint.json`);
    if (!existsSync(mintPath)) writeFileSync(mintPath, JSON.stringify(Array.from(Keypair.generate().secretKey)));
    process.env.STIPEND_REGISTRY = rp; process.env.STIPEND_KEYS_DIR = kd;
    // devnet runs a 2023 build of the stake pool program that cannot deserialize current vote accounts (add-validator fails with BorshIoError); pools run reserve-only there
    if (net === "devnet") { process.env.STIPEND_SKIP_VALIDATOR = "1"; process.env.STIPEND_SKIP_METADATA = "1"; }
    process.env.STIPEND_MANAGER_KEY = join(kd, "manager.json"); process.env.STIPEND_STAKER_KEY = join(kd, "staker.json"); process.env.STIPEND_WORKER_KEY = join(kd, "worker.json");
    await createLstTs({ symbol: lstSym, mintKeypair: mintPath, payer: manager, creator: manager.publicKey.toBase58() });
    await adminLive({ lst: lstSym });
    const fresh = loadRegistry(rp).lsts.find((l) => l.symbol === lstSym)!;
    const s = await getPoolStats(conn, fresh);
    console.log(`${lstSym}: pool ${s.address} mint ${s.mint} live; total ${Number(s.totalLamports) / 1e9} SOL`);
  }
}

export async function testnetStatus() {
  const root = findRepoRoot();
  const conn = makeConnection();
  const reg = loadRegistry(regPath(root));
  const kd = keysDir(root);
  console.log(`network ${await getNetwork(conn)}; registry ${regPath(root)}; validator ${reg.validator.voteAccount}`);
  for (const k of ["manager", "staker", "worker", "faucet", "treasury"]) {
    const p = join(kd, `${k}.json`);
    if (!existsSync(p)) { console.log(`  ${k}: missing`); continue; }
    const kp = loadKeypair(p);
    console.log(`  ${k} ${kp.publicKey.toBase58()} ${(await conn.getBalance(kp.publicKey)) / LAMPORTS_PER_SOL} SOL`);
  }
  for (const l of reg.lsts) console.log(`  ${l.symbol} ${l.status} pool ${l.stakePool || "-"} asset ${l.asset.mint}`);
}
