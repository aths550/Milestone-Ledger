#!/usr/bin/env bash
# Deploys ReputationRegistry + MilestoneEscrow to Stellar Testnet and wires
# them together. Run this from the repo root:
#
#   ./scripts/deploy.sh
#
# Prerequisites:
#   - Rust + wasm32-unknown-unknown target
#   - Soroban CLI (`cargo install --locked soroban-cli` or `stellar-cli`)
#   - A funded testnet identity (created + friendbot-funded below)
#
# This script is meant to be read, not just run blindly -- it prints the
# contract IDs and transaction hashes you need for the submission checklist.

set -euo pipefail

NETWORK="testnet"
IDENTITY="deployer"

echo "== 1. Ensure a funded identity exists =="
if ! soroban keys address "$IDENTITY" >/dev/null 2>&1; then
  soroban keys generate "$IDENTITY" --network "$NETWORK"
fi
DEPLOYER_ADDRESS=$(soroban keys address "$IDENTITY")
echo "Deployer address: $DEPLOYER_ADDRESS"
echo "Funding via Friendbot (safe to re-run)..."
curl -s "https://friendbot.stellar.org/?addr=$DEPLOYER_ADDRESS" > /dev/null || true

echo "== 2. Build contracts =="
cd contracts
cargo build --target wasm32-unknown-unknown --release -p reputation_registry
cargo build --target wasm32-unknown-unknown --release -p milestone_escrow
cd ..

WASM_DIR="contracts/target/wasm32-unknown-unknown/release"

echo "== 3. Deploy ReputationRegistry =="
REPUTATION_ID=$(soroban contract deploy \
  --wasm "$WASM_DIR/reputation_registry.wasm" \
  --source "$IDENTITY" \
  --network "$NETWORK")
echo "ReputationRegistry deployed at: $REPUTATION_ID"

echo "== 4. Deploy MilestoneEscrow =="
ESCROW_ID=$(soroban contract deploy \
  --wasm "$WASM_DIR/milestone_escrow.wasm" \
  --source "$IDENTITY" \
  --network "$NETWORK")
echo "MilestoneEscrow deployed at: $ESCROW_ID"

echo "== 5. Initialize ReputationRegistry =="
soroban contract invoke \
  --id "$REPUTATION_ID" \
  --source "$IDENTITY" \
  --network "$NETWORK" \
  -- initialize --admin "$DEPLOYER_ADDRESS"

echo "== 6. Authorize the escrow contract to write reputation updates =="
soroban contract invoke \
  --id "$REPUTATION_ID" \
  --source "$IDENTITY" \
  --network "$NETWORK" \
  -- authorize_caller --caller "$ESCROW_ID"

cat <<EOF

============================================================
Deployment complete.

  ReputationRegistry contract ID: $REPUTATION_ID
  MilestoneEscrow contract ID:    $ESCROW_ID
  Deployer / client address:     $DEPLOYER_ADDRESS

Next steps:
  1. Copy these two contract IDs into frontend/.env as
     VITE_REPUTATION_CONTRACT_ID and VITE_ESCROW_CONTRACT_ID.
  2. Call MilestoneEscrow.initialize (see README.md "Manual init"
     section) with your client, freelancer, token, and milestone list.
  3. Save the transaction hash from any of the invoke commands above
     (or from fund_milestone/approve_milestone) for your submission --
     you can find it in the CLI output or via:
       soroban events --network testnet --id $ESCROW_ID
============================================================
EOF
