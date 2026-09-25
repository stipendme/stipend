# Vanity mint keys

Every Stipend LST mint is a vanity address: `<TICKER>…stip` for flagship assets, `<TICKER>…` or `…stip` otherwise. Keys are ground ahead of time into a bank and consumed once at pool creation.

## Why a bank is safe

A mint keypair signs exactly twice, in the same transaction: the system `create_account` for the mint and the token `initialize_mint`. The stake pool `Initialize` then sets the mint authority to the pool's withdraw authority PDA. From that point the keypair can do nothing: it cannot mint, freeze, or change the pool. So a pre-ground key's only value is its address, and only until it is used. The bank lives in `keys/vanity/` (git-ignored, files mode 600); a used key can be deleted.

## Grinder

`tools/vanity/upstream` is [cavemanloverboy/vanity](https://github.com/cavemanloverboy/vanity) built with the CUDA backend. Its `grind-keypair` generates ed25519 keypairs on the GPU and tests each public key against up to 64 patterns at once, with `--case-insensitive` folding A-Z/a-z (base58 has no lowercase `l`, so `L` only matches itself). Patterns are `Prefix...Suffix`.

Build (this box has an RTX 3080 Ti, compute 8.6; the system `nvcc` is CUDA 10.1 which cannot target it, so use 11.7):

```bash
cd tools/vanity/upstream
PATH=/usr/local/cuda-11.7/bin:$PATH VANITY_CUDA_ARCH=86 cargo build --release --features=gpu
```

Measured: about 85 million keys per second on the 3080 Ti.

## Targets

`tools/vanity/targets.json` is built from the tokens.xyz curated lists (stocks by 30-day volume, metals, majors) plus Solana-native majors verified on Jupiter (JTO, JUP, JLP, ORE, BONK, WIF, PYTH, RAY, DRIFT, KMNO, TNSR, HNT, RENDER, ME, PENGU, ...). tokens.xyz "majors" are bridged assets and are flagged `solanaNative: false`; the native list is flagged true. 459 targets.

## The base58 first-character constraint

A 32-byte key encodes to 43 or 44 base58 characters. A 44-character address is a number in [58^43, 2^256), and 2^256 / 58^43 ≈ 17.3, so its first character can only be one of the first seventeen non-zero symbols: `2`-`9`, `A`-`H`, `J`. Only 43-character addresses (about 5.9% of keys) can start with anything else, including any lowercase letter. A case-sensitive lowercase prefix like `aapl…` therefore costs about 17x more than `AAPL…`. Case-insensitive matching sidesteps this: `aapl` matches `AAPL…`, `AapL…`, and so on.

## Cost

Measured on this box (RTX 3080 Ti, CUDA 11.7 build, 85-95M keys/s, unchanged with 64 patterns in the batch). "Expected" is the grinder's own estimate for case-insensitive matching; prefixes are dearer than suffixes because of the first-character constraint above, and a prefix whose first letter is outside `2-9 A-H J` (most of them) is dearer still.

| pattern | expected keys | GPU here | 24-core CPU (~20M/s) |
|---|---:|---:|---:|
| `…stip` (4-char suffix) | 1.4 million | 0.02 s | 0.07 s |
| `JTO…` (3-char prefix) | 0.8 million | 0.01 s | 0.04 s |
| `NVDA…` (4-char prefix) | 12 million | 0.15 s | 0.6 s |
| `GOOGL…` (5-char prefix) | 2.8 billion | 30 s | 2.3 min |
| `RENDER…` (6-char prefix) | 10 billion | 2 min | 8 min |
| `SPY…stip` (3+4) | ~1.2 trillion | ~4 h | ~17 h |
| `NVDA…stip` (4+4) | 17 trillion | ~53 h | ~10 days |

Several patterns in one run cost nothing extra per key, so with 24 flagship `both` patterns the first hit arrives in a few hours and the whole set takes the single-target time times the 24th harmonic number, roughly two to three weeks of GPU for the 4+4 ones. The `both` mode is capped at 4-character prefixes (`--max-prefix`), so GOOGL is ground as GOOG; 5- and 6-character tickers get a prefix-only key and a `…stip` reserve key instead. Grinding is a background job that never blocks a launch: `takeVanityKey` falls through both > prefix > suffix.

Keep `--num-cpus` at 1: the grinder's CPU path saturates every core for a few percent more throughput and starves everything else on the box.

## Ops commands

```bash
pnpm ops vanity grind --mode suffix --count 50        # ...stip reserve, seconds
pnpm ops vanity grind --mode prefix                    # <TICKER>... for every target, minutes
tools/vanity/run-bank.sh                              # prefix pass then the flagship `both` set; run under setsid/nohup, log in data/vanity-grind.log
pnpm ops vanity list
pnpm ops vanity take --ticker NVDA --dry-run
```

Resumable: targets already holding a free key of the requested kind are skipped; hits are ingested after each batch; a killed run leaves its in-flight hits in `tools/vanity/work/<mode>/` and the next run ingests them first. Batches are 64 patterns (the kernel's table size). Env: `STIPEND_VANITY_DIR` (default `keys/vanity`), `VANITY_BIN`, `VANITY_GPUS`, `VANITY_CPUS`.

## At launch

`takeVanityKey({ ticker })` from `@stipend/core` returns the best free key for the ticker (`both` > `prefix` > suffix-only reserve), marks it used in `index.json` atomically, and the launch flow passes it as the mint keypair. `listVanityBank()` backs the admin view.
