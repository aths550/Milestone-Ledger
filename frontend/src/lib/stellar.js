import {
  Contract,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  rpc,
  nativeToScVal,
  scValToNative,
  Address,
  Account,
  Keypair,
} from '@stellar/stellar-sdk';
import freighterApi from '@stellar/freighter-api';

// --- Configuration -----------------------------------------------------
// All of these are injected at build time via a `.env` file (see .env.example).
// They intentionally have safe fallbacks so the app can render in a demo/mock
// mode before you've deployed anything.
export const CONFIG = {
  rpcUrl: import.meta.env.VITE_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org',
  networkPassphrase: import.meta.env.VITE_NETWORK_PASSPHRASE || Networks.TESTNET,
  escrowContractId: import.meta.env.VITE_ESCROW_CONTRACT_ID || '',
  reputationContractId: import.meta.env.VITE_REPUTATION_CONTRACT_ID || '',
};

export const isConfigured = () =>
  Boolean(CONFIG.escrowContractId && CONFIG.reputationContractId);

let serverInstance = null;
function getServer() {
  if (!serverInstance) {
    serverInstance = new rpc.Server(CONFIG.rpcUrl, { allowHttp: CONFIG.rpcUrl.startsWith('http://') });
  }
  return serverInstance;
}

// --- Wallet (Freighter) --------------------------------------------------
export async function isFreighterInstalled() {
  try {
    const result = await freighterApi.isConnected();
    return Boolean(result?.isConnected ?? result);
  } catch {
    return false;
  }
}

export async function connectWallet() {
  const { isAllowed } = await freighterApi.isAllowed();
  if (!isAllowed) {
    await freighterApi.setAllowed();
  }
  const { address } = await freighterApi.getAddress();
  if (!address) {
    throw new Error('No address returned by Freighter. Is a wallet unlocked and selected?');
  }
  return address;
}

// --- Generic contract invocation ------------------------------------------
/**
 * Build, simulate, sign (via Freighter), and submit a Soroban contract call.
 * Read-only calls can skip signing/submission by passing { simulateOnly: true }.
 */
async function invokeContract({
  contractId,
  method,
  args = [],
  sourcePublicKey,
  simulateOnly = false,
}) {
  const server = getServer();
  const contract = new Contract(contractId);

  // Read-only simulated calls (get_milestones, get_reputation, ...) don't
  // need a real, funded source account -- a synthetic one is sufficient for
  // building a well-formed transaction to simulate against the RPC.
  const account = sourcePublicKey
    ? await server.getAccount(sourcePublicKey)
    : new Account(Keypair.random().publicKey(), '0');

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: CONFIG.networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(60)
    .build();

  const simulated = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulated)) {
    throw new Error(`Simulation failed for ${method}: ${simulated.error}`);
  }

  if (simulateOnly) {
    return simulated.result?.retval ? scValToNative(simulated.result.retval) : null;
  }

  const prepared = await server.prepareTransaction(tx);
  const signedResult = await freighterApi.signTransaction(prepared.toXDR(), {
    networkPassphrase: CONFIG.networkPassphrase,
  });
  const signedXdr = signedResult.signedTxXdr || signedResult;

  const signedTx = TransactionBuilder.fromXDR(signedXdr, CONFIG.networkPassphrase);
  const sendResult = await server.sendTransaction(signedTx);

  if (sendResult.status === 'ERROR') {
    throw new Error(`Transaction failed: ${JSON.stringify(sendResult.errorResult)}`);
  }

  // Poll for final status so callers get a confirmed tx hash.
  let getResult = await server.getTransaction(sendResult.hash);
  let attempts = 0;
  while (getResult.status === 'NOT_FOUND' && attempts < 10) {
    await new Promise((r) => setTimeout(r, 1500));
    getResult = await server.getTransaction(sendResult.hash);
    attempts += 1;
  }

  return { hash: sendResult.hash, status: getResult.status };
}

// --- MilestoneEscrow contract calls ----------------------------------------
export async function fetchMilestones() {
  const raw = await invokeContract({
    contractId: CONFIG.escrowContractId,
    method: 'get_milestones',
    args: [],
    simulateOnly: true,
  });
  return raw || [];
}

export async function fundMilestone(sourcePublicKey, index) {
  return invokeContract({
    contractId: CONFIG.escrowContractId,
    method: 'fund_milestone',
    args: [nativeToScVal(index, { type: 'u32' })],
    sourcePublicKey,
  });
}

export async function submitMilestone(sourcePublicKey, index) {
  return invokeContract({
    contractId: CONFIG.escrowContractId,
    method: 'submit_milestone',
    args: [nativeToScVal(index, { type: 'u32' })],
    sourcePublicKey,
  });
}

export async function approveMilestone(sourcePublicKey, index, rating) {
  return invokeContract({
    contractId: CONFIG.escrowContractId,
    method: 'approve_milestone',
    args: [nativeToScVal(index, { type: 'u32' }), nativeToScVal(rating, { type: 'u32' })],
    sourcePublicKey,
  });
}

// --- ReputationRegistry contract calls --------------------------------------
export async function fetchReputation(freelancerAddress) {
  const raw = await invokeContract({
    contractId: CONFIG.reputationContractId,
    method: 'get_reputation',
    args: [new Address(freelancerAddress).toScVal()],
    simulateOnly: true,
  });
  return raw;
}

// --- Event streaming ---------------------------------------------------
/**
 * Poll the RPC's getEvents endpoint for new contract events since a given
 * ledger, returning a normalized list. Soroban RPC does not offer
 * websockets, so short-interval polling is the standard "real-time" pattern.
 */
export async function pollEvents({ startLedger, contractIds }) {
  const server = getServer();
  const response = await server.getEvents({
    startLedger,
    filters: [
      {
        type: 'contract',
        contractIds,
      },
    ],
    limit: 50,
  });

  return (response.events || []).map((evt) => ({
    id: evt.id,
    ledger: evt.ledger,
    contractId: evt.contractId,
    topic: evt.topic?.map((t) => {
      try {
        return scValToNative(t);
      } catch {
        return null;
      }
    }),
    value: (() => {
      try {
        return scValToNative(evt.value);
      } catch {
        return null;
      }
    })(),
    txHash: evt.txHash,
  }));
}

export async function getLatestLedger() {
  const server = getServer();
  const { sequence } = await server.getLatestLedger();
  return sequence;
}
