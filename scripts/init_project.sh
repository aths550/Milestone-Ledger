#!/usr/bin/env bash
# Initializes a freshly deployed MilestoneEscrow with a sample two-milestone
# project, using the Stellar native asset (XLM) as the payment token on
# testnet. Run this AFTER scripts/deploy.sh.
#
# Usage:
#   ./scripts/init_project.sh <ESCROW_ID> <REPUTATION_ID> <FREELANCER_ADDRESS>
#
# If you don't have a second identity for the freelancer yet:
#   soroban keys generate freelancer --network testnet
#   soroban keys address freelancer

set -euo pipefail

ESCROW_ID="${1:?Usage: $0 <ESCROW_ID> <REPUTATION_ID> <FREELANCER_ADDRESS>}"
REPUTATION_ID="${2:?Usage: $0 <ESCROW_ID> <REPUTATION_ID> <FREELANCER_ADDRESS>}"
FREELANCER_ADDRESS="${3:?Usage: $0 <ESCROW_ID> <REPUTATION_ID> <FREELANCER_ADDRESS>}"

IDENTITY="deployer"
NETWORK="testnet"
CLIENT_ADDRESS=$(soroban keys address "$IDENTITY")

# Native XLM Stellar Asset Contract ID on testnet (SAC wrapper for the
# native asset -- this is deterministic per network).
NATIVE_TOKEN_ID=$(soroban lab token id --asset native --network "$NETWORK")

echo "Initializing escrow with:"
echo "  client:      $CLIENT_ADDRESS"
echo "  freelancer:  $FREELANCER_ADDRESS"
echo "  token:       $NATIVE_TOKEN_ID"

soroban contract invoke \
  --id "$ESCROW_ID" \
  --source "$IDENTITY" \
  --network "$NETWORK" \
  -- initialize \
  --client "$CLIENT_ADDRESS" \
  --freelancer "$FREELANCER_ADDRESS" \
  --token "$NATIVE_TOKEN_ID" \
  --reputation_contract "$REPUTATION_ID" \
  --milestones '[["design_mockups", "10000000"], ["final_delivery", "20000000"]]'

echo ""
echo "Project initialized. To fund + approve milestone 0 (a good demo flow):"
echo ""
echo "  soroban contract invoke --id $ESCROW_ID --source $IDENTITY --network $NETWORK -- fund_milestone --index 0"
echo "  # (as the freelancer identity) submit_milestone --index 0"
echo "  soroban contract invoke --id $ESCROW_ID --source $IDENTITY --network $NETWORK -- approve_milestone --index 0 --rating_1_to_5 5"
echo ""
echo "Each command above prints a transaction hash -- that's your"
echo "'Transaction hash for contract interaction' submission item."
