#!/usr/bin/env bash
# Fetch and build the GPU grinder (cavemanloverboy/vanity) at the pinned commit.
# Needs CUDA 11.x+ for sm_86 (RTX 30xx); the system nvcc 10.1 cannot target it.
set -euo pipefail
cd "$(dirname "$0")"
PIN=4e0f88d60f16f4e5336b2d688c119dd96173834e
if [[ ! -d upstream/.git ]]; then git clone -q https://github.com/cavemanloverboy/vanity upstream; fi
git -C upstream fetch -q && git -C upstream checkout -q "$PIN"
export PATH=/usr/local/cuda-11.7/bin:$PATH VANITY_CUDA_ARCH=${VANITY_CUDA_ARCH:-86}
( cd upstream && cargo build --release --features=gpu )
echo "built: $(pwd)/upstream/target/release/vanity"
