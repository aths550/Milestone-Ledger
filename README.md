# Milestone Ledger — Freelance Escrow on Stellar (Soroban)

A production-style dApp for freelance milestone payments, built on **Stellar / Soroban**. A client funds a project milestone by milestone; when a milestone is approved, the freelancer is paid **and** their on-chain reputation is updated — atomically, via a real cross-contract call.

This is not a token/NFT/DAO clone. It's a two-contract system designed around a genuine inter-contract dependency: payment and reputation are two separate concerns owned by two separate contracts, wired together at the protocol level.

---

## Why two contracts?

| Contract | Responsibility |
|---|---|
| **`MilestoneEscrow`** | Holds funds in escrow, tracks milestone status (`Created → Funded → Submitted → Approved`), pays the freelancer on approval. |
| **`ReputationRegistry`** | Tracks a freelancer's completed-milestone count and running average client rating. Only contracts explicitly authorized by its admin may write to it. |

When a client calls `approve_milestone`, `MilestoneEscrow`:
1. Transfers the milestone's funds from escrow to the freelancer (SEP-41 token transfer)
2. Makes a **cross-contract call** into `ReputationRegistry.record_completion(...)`, passing its own contract address so the registry can verify the caller is authorized

Both steps happen inside a single transaction. If the payment fails, the reputation update never fires.

---

## Architecture

```
┌─────────────────────┐        cross-contract call        ┌──────────────────────┐
│   MilestoneEscrow    │ ─────────────────────────────────▶│  ReputationRegistry   │
│                      │   record_completion(caller,        │                      │
│  - fund_milestone    │     freelancer, rating)            │  - authorize_caller   │
│  - submit_milestone  │                                    │  - record_completion  │
│  - approve_milestone │                                    │  - get_reputation     │
│  - get_milestones    │                                    │                      │
└──────────┬───────────┘                                    └──────────┬───────────┘
           │ events: funded, submitted,                                │ events: rep_upd
           │ approved, paid                                            │
           ▼                                                           ▼
                    ┌─────────────────────────────────────┐
                    │      React frontend (Vite)           │
                    │  - Freighter wallet connect           │
                    │  - Milestone ledger (client/freelancer│
                    │    role views)                        │
                    │  - Live activity feed (event polling) │
                    │  - Reputation badge                   │
                    └─────────────────────────────────────┘
```

---

## Repository layout

```
contracts/
  Cargo.toml                    # Workspace
  milestone_escrow/              # Escrow contract + tests
  reputation_registry/           # Reputation contract + tests
frontend/
  src/
    lib/stellar.js               # Soroban RPC client, Freighter wallet, event polling
    components/                  # WalletConnect, MilestoneCard, ActivityFeed, ReputationBadge
    App.jsx                      # Dashboard (demo mode + live mode)
    styles.css                   # Design system
scripts/
  deploy.sh                      # Deploys both contracts to testnet, wires authorization
  init_project.sh                # Initializes a sample 2-milestone project
.github/workflows/ci.yml         # CI: contract tests, frontend tests, builds
```

---

## Contract details

### `ReputationRegistry`

- `initialize(admin: Address)` — one-time setup.
- `authorize_caller(caller: Address)` — admin-only; whitelists a contract address (e.g. a deployed `MilestoneEscrow`) to write reputation data.
- `record_completion(caller: Address, freelancer: Address, rating_1_to_5: u32) -> Reputation` — requires `caller.require_auth()` and that `caller` is authorized. Increments `completed_milestones`, adds to the running rating sum.
- `get_reputation(freelancer: Address) -> Reputation` — read-only.

### `MilestoneEscrow`

- `initialize(client, freelancer, token, reputation_contract, milestones: Vec<(Symbol, i128)>)` — sets up the project. Funds are **not** pulled at init time; each milestone is funded individually.
- `fund_milestone(index: u32)` — client-only; transfers the milestone's token amount into escrow.
- `submit_milestone(index: u32)` — freelancer-only; marks work as ready for review.
- `approve_milestone(index: u32, rating_1_to_5: u32)` — client-only; pays the freelancer, then calls into `ReputationRegistry`.
- `get_milestone(index) / get_milestones()` — read-only.

Errors are typed (`Error::WrongStatus`, `Error::InvalidRating`, `Error::InvalidIndex`, etc.) rather than generic panics, so the frontend can show meaningful messages.

### Events

| Event | Emitted by | When |
|---|---|---|
| `funded` | Escrow | milestone funded |
| `submitted` | Escrow | freelancer submits work |
| `approved` | Escrow | client approves |
| `paid` | Escrow | payout transfer completes |
| `rep_upd` | Reputation | reputation record updated |

The frontend polls `getEvents` on the Soroban RPC every 6 seconds (Soroban RPC has no websocket push, so short-interval polling is the standard "real-time" pattern) and renders them in a live activity feed.

---

## Running the contract tests

Requires Rust + the `wasm32-unknown-unknown` target.

```bash
rustup target add wasm32-unknown-unknown
cd contracts
cargo test --workspace
```

Test coverage includes:
- Full milestone lifecycle (fund → submit → approve) with real token transfer assertions
- **Cross-contract call verification**: after `approve_milestone`, the test asserts `ReputationRegistry.get_reputation()` was actually updated
- Rejection of unauthorized reputation-writer contracts
- Rejection of invalid ratings, invalid milestone indices, and out-of-order state transitions
- Accumulation across multiple milestones (average rating math)

## Running the frontend tests

```bash
cd frontend
npm install
npm test        # runs the Vitest suite (11 tests)
npm run build   # production build
```

---

## Live Deployed Testnet Instance

- **MilestoneEscrow Contract ID:** `CB3JEPHMBJQ4DSLP3LHAJVKAG7EK5IDU26WK3OR23XY6AB6E376745IK`
- **ReputationRegistry Contract ID:** `CBMEKNGXFKG5EKE6DOQJDQ3E2V5RYS3LTTZU7WLRNLHARARCWAPZP4BB`
- **Demo Client Address:** `GD4FAPMD2226ZEUSYT2ZDOVIVYVRODILOCPJHPTE2Z6EQJ3JXHTV7JPP`
- **Demo Freelancer Address:** `GAKQ5QEIWIHP6ACNZAM2EQ6WMHFPDAIQ5WCSVZKN3MTCLUF7RF6IOG5R`
- **Native XLM Token Contract ID (SAC):** `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`

---

## Deploying to Stellar Testnet

1. Install the Soroban / Stellar CLI (`stellar-cli` or `soroban-cli`).
2. From the repo root:
   ```bash
   cargo build --target wasm32-unknown-unknown --release --manifest-path contracts/Cargo.toml
   stellar contract optimize --wasm contracts/target/wasm32-unknown-unknown/release/reputation_registry.wasm
   stellar contract optimize --wasm contracts/target/wasm32-unknown-unknown/release/milestone_escrow.wasm
   ```
3. Deploy both contracts to Testnet:
   ```bash
   REPUTATION_ID=$(stellar contract deploy --wasm contracts/target/wasm32-unknown-unknown/release/reputation_registry.optimized.wasm --source-account deployer --rpc-url https://soroban-testnet.stellar.org --network-passphrase "Test SDF Network ; September 2015")
   ESCROW_ID=$(stellar contract deploy --wasm contracts/target/wasm32-unknown-unknown/release/milestone_escrow.optimized.wasm --source-account deployer --rpc-url https://soroban-testnet.stellar.org --network-passphrase "Test SDF Network ; September 2015")
   ```
3. Initialize a sample project:
   ```bash
   soroban keys generate freelancer --network testnet
   FREELANCER_ADDR=$(soroban keys address freelancer)
   ./scripts/init_project.sh <ESCROW_ID> <REPUTATION_ID> $FREELANCER_ADDR
   ```
4. Fund → submit → approve the first milestone (each prints a transaction hash — save one for your submission):
   ```bash
   soroban contract invoke --id <ESCROW_ID> --source deployer --network testnet -- fund_milestone --index 0
   soroban contract invoke --id <ESCROW_ID> --source freelancer --network testnet -- submit_milestone --index 0
   soroban contract invoke --id <ESCROW_ID> --source deployer --network testnet -- approve_milestone --index 0 --rating_1_to_5 5
   ```

### Frontend configuration

```bash
cd frontend
cp .env.example .env
# then fill in VITE_ESCROW_CONTRACT_ID and VITE_REPUTATION_CONTRACT_ID
npm run dev
```

Without those two env vars set, the app runs in **demo mode** automatically (mock data, no network calls) so it's always safe to open.

---

## Deploying the frontend (Vercel/Netlify)

```bash
cd frontend
npm run build
```
Deploy the `frontend` directory as the project root (build command `npm run build`, output directory `dist`). Set the same environment variables from `.env` in your hosting provider's dashboard.

---

## Production-readiness notes

- **Error handling**: every contract call returns a typed `Result<T, Error>`; the frontend surfaces failures in an error panel with a retry action rather than crashing.
- **Loading states**: skeleton placeholders for milestones and reputation while data loads; disabled/`aria-busy` buttons during in-flight transactions.
- **Auth**: every state-changing contract method calls `.require_auth()` on the relevant party (client or freelancer), so the Soroban runtime enforces who can call what — this isn't just a frontend-level check.
- **Access control between contracts**: `ReputationRegistry` only accepts writes from addresses the admin has explicitly authorized, preventing arbitrary contracts from inflating someone's reputation.
- **Accessibility**: visible focus states, `aria-live`/`role="alert"` on errors, `prefers-reduced-motion` respected.
- **Mobile responsive**: layout collapses from a two-column (ledger + activity feed) to single-column below 860px, with stacked controls below 520px.

---

## Submission checklist mapping

| Requirement | Where |
|---|---|
| Inter-contract communication | `MilestoneEscrow::approve_milestone` → `ReputationRegistry::record_completion` (see `contracts/milestone_escrow/src/lib.rs`) |
| Event streaming / real-time updates | `frontend/src/lib/stellar.js: pollEvents`, rendered in `ActivityFeed.jsx` |
| CI/CD pipeline | `.github/workflows/ci.yml` |
| Deployment workflow | `scripts/deploy.sh`, `scripts/init_project.sh` |
| Mobile responsive frontend | `frontend/src/styles.css` media queries |
| Error handling & loading states | `App.jsx` (`milestonesError`, skeleton states), typed contract `Error` enums |
| Tests (contracts + frontend) | `contracts/*/src/test.rs` (10 tests), `frontend/src/**/*.test.jsx` (11 tests) |
| Documentation | this file |

---

## License

MIT — see `LICENSE` (add one if your submission requires it).
