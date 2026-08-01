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
  escrowContractId: import.meta.env.VITE_ESCROW_CONTRACT_ID || 'CB3JEPHMBJQ4DSLP3LHAJVKAG7EK5IDU26WK3OR23XY6AB6E376745IK',
  reputationContractId: import.meta.env.VITE_REPUTATION_CONTRACT_ID || 'CBMEKNGXFKG5EKE6DOQJDQ3E2V5RYS3LTTZU7WLRNLHARARCWAPZP4BB',
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
  try {
    const installed = await isFreighterInstalled();
    if (!installed) {
      throw new Error('Freighter wallet extension not detected. Please install Freighter (freighter.app) and refresh.');
    }
    const { isAllowed } = await freighterApi.isAllowed();
    if (!isAllowed) {
      await freighterApi.setAllowed();
    }
    const { address } = await freighterApi.getAddress();
    if (!address) {
      throw new Error('No address returned by Freighter. Is your wallet unlocked and selected?');
    }
    return address;
  } catch (err) {
    throw new Error(err.message || 'Freighter connection failed.');
  }
}

export const STORED_CLIENT_ADDRESS = 'GD4FAPMD2226ZEUSYT2ZDOVIVYVRODILOCPJHPTE2Z6EQJ3JXHTV7JPP';
export const STORED_FREELANCER_ADDRESS = 'GAKQ5QEIWIHP6ACNZAM2EQ6WMHFPDAIQ5WCSVZKN3MTCLUF7RF6IOG5R';

export function parseSorobanError(error) {
  if (!error) return 'Unknown error occurred.';
  
  const errStr = typeof error === 'string' 
    ? error 
    : (error.message || error.error || JSON.stringify(error));

  if (errStr.includes('Error(Contract, #1)') || errStr.includes('AlreadyInitialized')) {
    return 'Contract is already initialized (Error #1).';
  }
  if (errStr.includes('Error(Contract, #2)') || errStr.includes('NotInitialized')) {
    return 'Contract is not initialized yet (Error #2).';
  }
  if (errStr.includes('Error(Contract, #3)') || errStr.includes('InvalidIndex')) {
    return 'Invalid milestone index (Error #3).';
  }
  if (errStr.includes('Error(Contract, #4)') || errStr.includes('WrongStatus')) {
    return 'Milestone is in the wrong status for this operation (Error #4 - WrongStatus).';
  }
  if (errStr.includes('Error(Contract, #5)') || errStr.includes('InvalidRating')) {
    return 'Rating must be between 1 and 5 (Error #5).';
  }
  if (errStr.includes('NotAuthorized') || errStr.includes('require_auth')) {
    return 'Authorization failed: wallet address is not authorized for this action.';
  }
  if (errStr.includes('User declined') || errStr.includes('cancelled') || errStr.includes('Popup closed')) {
    return 'Transaction signing was cancelled in Freighter.';
  }

  return errStr;
}

export function extractDiagnosticError(simulated) {
  if (!simulated) return null;
  let diagnosticLog = '';

  if (Array.isArray(simulated.events)) {
    diagnosticLog = simulated.events
      .map((e) => {
        try {
          return `${e.topic?.map((t) => scValToNative(t)).join(': ')} => ${e.value ? JSON.stringify(scValToNative(e.value)) : ''}`;
        } catch {
          return JSON.stringify(e);
        }
      })
      .join(' | ');
  }

  const rawError = simulated.error || simulated.result?.error || diagnosticLog || JSON.stringify(simulated);
  console.log('[Soroban Diagnostic Events & Logs]:', { simulated, diagnosticLog, rawError });
  return parseSorobanError(rawError);
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
  try {
    const server = getServer();
    const contract = new Contract(contractId);

    // Read-only simulated calls (get_milestones, get_reputation, ...) don't
    // need a real, funded source account -- a synthetic one is sufficient for
    // building a well-formed transaction to simulate against the RPC.
    const account = sourcePublicKey
      ? await server.getAccount(sourcePublicKey)
      : new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '0');

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: CONFIG.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(60)
      .build();

    const simulated = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulated)) {
      const parsedErr = extractDiagnosticError(simulated);
      throw new Error(`Simulation failed for ${method}: ${parsedErr}`);
    }

    if (simulateOnly) {
      return simulated.result?.retval ? scValToNative(simulated.result.retval) : null;
    }

    let prepared;
    try {
      prepared = await server.prepareTransaction(tx);
    } catch (err) {
      throw new Error(`Transaction preparation failed: ${parseSorobanError(err)}`);
    }

    let signedResult;
    try {
      signedResult = await freighterApi.signTransaction(prepared.toXDR(), {
        networkPassphrase: CONFIG.networkPassphrase,
      });
    } catch (err) {
      throw new Error(`Freighter signing cancelled or failed: ${parseSorobanError(err)}`);
    }

    if (!signedResult) {
      throw new Error('Signing was cancelled in Freighter wallet.');
    }

    if (typeof signedResult === 'object' && signedResult.error) {
      throw new Error(`Freighter error: ${parseSorobanError(signedResult.error)}`);
    }

    const signedXdr = typeof signedResult === 'string'
      ? signedResult
      : (signedResult.signedTxXdr || signedResult.signedXdr || null);

    if (!signedXdr || typeof signedXdr !== 'string') {
      throw new Error('Transaction signing was not completed.');
    }

    let signedTx;
    try {
      signedTx = TransactionBuilder.fromXDR(signedXdr, CONFIG.networkPassphrase);
    } catch (err) {
      throw new Error(`Invalid signed transaction envelope: ${err.message}`);
    }

    const sendResult = await server.sendTransaction(signedTx);

    if (sendResult.status === 'ERROR') {
      const errDetail = parseSorobanError(sendResult.errorResult || sendResult);
      throw new Error(`Transaction submission error: ${errDetail}`);
    }

    // Poll for final status (SUCCESS vs FAILED vs timeout)
    let attempts = 0;
    const maxAttempts = 20;
    let getResult = await server.getTransaction(sendResult.hash);
    while ((!getResult || getResult.status === 'NOT_FOUND') && attempts < maxAttempts) {
      await new Promise((r) => setTimeout(r, 1200));
      getResult = await server.getTransaction(sendResult.hash);
      attempts += 1;
    }

    if (!getResult || getResult.status === 'NOT_FOUND') {
      throw new Error(`Transaction submitted but confirmation timed out (Tx Hash: ${sendResult.hash})`);
    }

    if (getResult.status === 'FAILED') {
      const failDetail = parseSorobanError(getResult.resultXdr || getResult.status);
      throw new Error(`Transaction failed on-chain: ${failDetail}`);
    }

    return { hash: sendResult.hash, status: getResult.status };
  } catch (err) {
    console.error(`[Soroban Error] Method '${method}' failed:`, err);
    throw err;
  }
}

// --- MilestoneEscrow contract calls ----------------------------------------
export async function fetchMilestones() {
  const raw = await invokeContract({
    contractId: CONFIG.escrowContractId,
    method: 'get_milestones',
    args: [],
    simulateOnly: true,
  });
  if (!Array.isArray(raw)) return [];
  return raw.map((m) => {
    let status = m.status;
    if (Array.isArray(status)) status = status[0];
    else if (typeof status === 'object' && status !== null) status = status.name || Object.keys(status)[0];
    return {
      description: String(m.description || ''),
      amount: Number(m.amount || 0),
      status: String(status || 'Created'),
    };
  });
}

export async function fundMilestone(sourcePublicKey, index) {
  console.log('[Audit Check] Invoking fund_milestone', {
    connectedWalletAddress: sourcePublicKey,
    expectedClientAddress: STORED_CLIENT_ADDRESS,
    milestoneIndex: index,
  });
  if (sourcePublicKey && sourcePublicKey !== STORED_CLIENT_ADDRESS) {
    console.warn(`[Address Warning] Connected wallet (${sourcePublicKey}) is not the contract Client address (${STORED_CLIENT_ADDRESS}). Transaction require_auth will fail.`);
  }
  return invokeContract({
    contractId: CONFIG.escrowContractId,
    method: 'fund_milestone',
    args: [nativeToScVal(index, { type: 'u32' })],
    sourcePublicKey,
  });
}

export async function submitMilestone(sourcePublicKey, index) {
  console.log('[Audit Check] Invoking submit_milestone', {
    connectedWalletAddress: sourcePublicKey,
    expectedFreelancerAddress: STORED_FREELANCER_ADDRESS,
    milestoneIndex: index,
  });
  if (sourcePublicKey && sourcePublicKey !== STORED_FREELANCER_ADDRESS) {
    console.warn(`[Address Warning] Connected wallet (${sourcePublicKey}) is not the contract Freelancer address (${STORED_FREELANCER_ADDRESS}). Transaction require_auth will fail.`);
  }
  return invokeContract({
    contractId: CONFIG.escrowContractId,
    method: 'submit_milestone',
    args: [nativeToScVal(index, { type: 'u32' })],
    sourcePublicKey,
  });
}

export async function approveMilestone(sourcePublicKey, index, rating) {
  console.log('[Audit Check] Invoking approve_milestone', {
    connectedWalletAddress: sourcePublicKey,
    expectedClientAddress: STORED_CLIENT_ADDRESS,
    milestoneIndex: index,
    rating,
  });
  if (sourcePublicKey && sourcePublicKey !== STORED_CLIENT_ADDRESS) {
    console.warn(`[Address Warning] Connected wallet (${sourcePublicKey}) is not the contract Client address (${STORED_CLIENT_ADDRESS}). Transaction require_auth will fail.`);
  }
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
  try {
    const server = getServer();
    const response = await server.getEvents({
      startLedger: Number(startLedger),
      filters: [
        {
          type: 'contract',
          contractIds: contractIds.map((id) => String(id)),
        },
      ],
      limit: 50,
    });

    const eventsList = response.events || [];
    console.log(`[Soroban getEvents] startLedger: ${startLedger} | Raw event count: ${eventsList.length}`);

    return eventsList.map((evt) => {
      let cId = '';
      if (typeof evt.contractId === 'string') {
        cId = evt.contractId;
      } else if (evt.contractId?.contractId) {
        cId = typeof evt.contractId.contractId === 'function' ? evt.contractId.contractId() : String(evt.contractId.contractId);
      } else {
        cId = String(evt.contractId || '');
      }

      return {
        id: String(evt.id),
        ledger: Number(evt.ledger),
        contractId: cId,
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
        txHash: String(evt.txHash || ''),
      };
    });
  } catch (err) {
    console.error('[Soroban Poll Events Error]', err);
    throw err;
  }
}

export async function getLatestLedger() {
  const server = getServer();
  const { sequence } = await server.getLatestLedger();
  return sequence;
}
