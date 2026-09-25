/** Tables owned by the launch + rent + creator features. Created on first use; never touches core's schema. */
import type { Db } from "@stipend/core";

export function ensureLaunchTables(db: Db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS creator_payouts (id INTEGER PRIMARY KEY, lst TEXT NOT NULL, epoch INTEGER NOT NULL, creator TEXT NOT NULL, lamports TEXT NOT NULL, signature TEXT, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS funded_accounts (
  lst TEXT NOT NULL, owner TEXT NOT NULL, account TEXT NOT NULL,
  first_funded_epoch INTEGER NOT NULL, funded_by TEXT NOT NULL, lamports TEXT NOT NULL,
  closures INTEGER NOT NULL DEFAULT 0, last_seen_epoch INTEGER,
  asset_units_deducted TEXT NOT NULL DEFAULT '0',
  PRIMARY KEY (lst, owner));
CREATE TABLE IF NOT EXISTS rent_ledger (id INTEGER PRIMARY KEY, lst TEXT NOT NULL, epoch INTEGER NOT NULL, owner TEXT NOT NULL, lamports TEXT NOT NULL, funded_by TEXT NOT NULL, asset_units TEXT NOT NULL DEFAULT '0', ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS launches (
  id TEXT PRIMARY KEY, symbol TEXT NOT NULL, asset_mint TEXT NOT NULL, creator TEXT NOT NULL,
  pool TEXT NOT NULL, mint TEXT NOT NULL, validator_list TEXT NOT NULL, reserve TEXT NOT NULL,
  keys_json TEXT NOT NULL, params_json TEXT NOT NULL,
  step INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', signatures TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
`);
}
