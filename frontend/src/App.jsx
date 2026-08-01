import React, { useCallback, useEffect, useRef, useState } from 'react';
import WalletConnect from './components/WalletConnect.jsx';
import MilestoneCard from './components/MilestoneCard.jsx';
import ActivityFeed from './components/ActivityFeed.jsx';
import ReputationBadge from './components/ReputationBadge.jsx';
import {
  CONFIG,
  isConfigured,
  connectWallet,
  fetchMilestones,
  fetchReputation,
  fundMilestone,
  submitMilestone,
  approveMilestone,
  pollEvents,
  getLatestLedger,
  parseSorobanError,
} from './lib/stellar.js';

const MOCK_MILESTONES = [
  { description: 'design_mockups', amount: 1_000_000, status: 'Funded' },
  { description: 'final_delivery', amount: 2_000_000, status: 'Created' },
];

const MOCK_FREELANCER = 'GAKQ5QEIWIHP6ACNZAM2EQ6WMHFPDAIQ5WCSVZKN3MTCLUF7RF6IOG5R';

const EVENT_POLL_INTERVAL_MS = 6000;

export default function App() {
  const [address, setAddress] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [walletError, setWalletError] = useState(null);

  const [role, setRole] = useState('client');

  const [milestones, setMilestones] = useState([]);
  const [loadingMilestones, setLoadingMilestones] = useState(true);
  const [milestonesError, setMilestonesError] = useState(null);
  const [txSuccess, setTxSuccess] = useState(null);
  const [busyIndex, setBusyIndex] = useState(null);

  const [reputation, setReputation] = useState(null);
  const [loadingReputation, setLoadingReputation] = useState(true);

  const [events, setEvents] = useState([]);
  const [live, setLive] = useState(false);
  const startLedgerRef = useRef(null);

  const demoMode = !isConfigured();

  const loadMilestones = useCallback(async () => {
    setLoadingMilestones(true);
    try {
      if (demoMode) {
        await new Promise((r) => setTimeout(r, 400));
        setMilestones(MOCK_MILESTONES);
      } else {
        const raw = await fetchMilestones();
        setMilestones(raw);
      }
    } catch (err) {
      console.error('[Load Milestones Error]', err);
      setMilestonesError(parseSorobanError(err));
    } finally {
      setLoadingMilestones(false);
    }
  }, [demoMode]);

  const loadReputation = useCallback(async () => {
    setLoadingReputation(true);
    try {
      if (demoMode) {
        await new Promise((r) => setTimeout(r, 300));
        setReputation({ completed_milestones: 4, average_rating_x100: 480 });
      } else {
        const rep = await fetchReputation(MOCK_FREELANCER);
        setReputation(rep);
      }
    } catch (err) {
      console.error('[Load Reputation Error]', err);
      setReputation(null);
    } finally {
      setLoadingReputation(false);
    }
  }, [demoMode]);

  useEffect(() => {
    loadMilestones();
    loadReputation();
  }, [loadMilestones, loadReputation]);

  // Real-time event polling against Soroban RPC.
  useEffect(() => {
    if (demoMode) return undefined;
    let cancelled = false;
    let timer;

    async function tick() {
      try {
        if (startLedgerRef.current === null) {
          const latest = await getLatestLedger();
          // Look back 10,000 ledgers (~14 hours) on Testnet so historical milestone events render on fresh page load
          startLedgerRef.current = Math.max(1, latest - 10000);
        }
        const newEvents = await pollEvents({
          startLedger: startLedgerRef.current,
          contractIds: [CONFIG.escrowContractId, CONFIG.reputationContractId].filter(Boolean),
        });
        if (!cancelled && newEvents.length) {
          setEvents((prev) => {
            const existingIds = new Set(prev.map((e) => e.id));
            const fresh = newEvents.filter((e) => !existingIds.has(e.id));
            return [...fresh, ...prev].slice(0, 50);
          });
          const maxLedger = Math.max(...newEvents.map((e) => e.ledger));
          startLedgerRef.current = maxLedger + 1;
        }
        if (!cancelled) setLive(true);
      } catch (err) {
        console.error('[Event Loop Tick Error]', err);
        if (startLedgerRef.current !== null) {
          try {
            const latest = await getLatestLedger();
            startLedgerRef.current = Math.max(1, latest - 1000);
          } catch (e) {
            console.error('[Reset Latest Ledger Error]', e);
          }
        }
        if (!cancelled) setLive(false);
      } finally {
        if (!cancelled) timer = setTimeout(tick, EVENT_POLL_INTERVAL_MS);
      }
    }

    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [demoMode]);

  const handleConnect = async () => {
    setConnecting(true);
    setWalletError(null);
    try {
      const addr = await connectWallet();
      setAddress(addr);
      return addr;
    } catch (err) {
      console.error('[Wallet Connect Error]', err);
      setWalletError(parseSorobanError(err));
      return null;
    } finally {
      setConnecting(false);
    }
  };

  const ensureAddress = async () => {
    if (address) return address;
    if (demoMode) return 'DEMO_USER';
    const addr = await handleConnect();
    if (!addr) {
      throw new Error('Please connect your Freighter wallet to perform this on-chain transaction.');
    }
    return addr;
  };

  const withBusy = async (index, action, successEvent) => {
    setBusyIndex(index);
    setMilestonesError(null);
    setTxSuccess(null);
    try {
      if (demoMode) {
        await new Promise((r) => setTimeout(r, 600));
        setMilestones((prev) => {
          const copy = [...prev];
          copy[index] = { ...copy[index], status: successEvent };
          return copy;
        });
        setEvents((prev) => [
          { id: `mock-${Date.now()}`, ledger: '—', topic: [successEvent.toLowerCase(), index] },
          ...prev,
        ].slice(0, 30));
        setTxSuccess({ message: `Milestone #${index + 1} marked as ${successEvent} (Demo mode).` });
      } else {
        const res = await action();
        console.log(`[Soroban Transaction Confirmed] ${successEvent}:`, res);
        await loadMilestones();
        await loadReputation();
        setTxSuccess({
          message: `Milestone #${index + 1} ${successEvent.toLowerCase()} successfully on-chain!`,
          hash: res?.hash,
        });
      }
    } catch (err) {
      console.error(`[Soroban Transaction Error] ${successEvent} failed:`, err);
      const readableErr = parseSorobanError(err);
      setMilestonesError(readableErr);
    } finally {
      setBusyIndex(null);
    }
  };

  const handleFund = async (index) => {
    setMilestonesError(null);
    setTxSuccess(null);
    try {
      const activeAddress = await ensureAddress();
      if (!activeAddress) return;
      await withBusy(index, () => fundMilestone(activeAddress, index), 'Funded');
    } catch (err) {
      console.error('[Fund Milestone Error]', err);
      setMilestonesError(parseSorobanError(err));
    }
  };

  const handleSubmit = async (index) => {
    setMilestonesError(null);
    setTxSuccess(null);
    try {
      const activeAddress = await ensureAddress();
      if (!activeAddress) return;
      await withBusy(index, () => submitMilestone(activeAddress, index), 'Submitted');
    } catch (err) {
      console.error('[Submit Milestone Error]', err);
      setMilestonesError(parseSorobanError(err));
    }
  };

  const handleApprove = async (index, rating) => {
    setMilestonesError(null);
    setTxSuccess(null);
    try {
      const activeAddress = await ensureAddress();
      if (!activeAddress) return;
      await withBusy(index, () => approveMilestone(activeAddress, index, rating), 'Approved');
    } catch (err) {
      console.error('[Approve Milestone Error]', err);
      setMilestonesError(parseSorobanError(err));
    }
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">§</span>
          <div>
            <h1>Milestone Ledger</h1>
            <p className="brand-sub">Escrowed freelance payments, sealed on Stellar</p>
          </div>
        </div>
        <div className="header-controls">
          <div className="role-toggle" role="group" aria-label="View as">
            <button
              type="button"
              className={role === 'client' ? 'active' : ''}
              onClick={() => setRole('client')}
            >
              Client
            </button>
            <button
              type="button"
              className={role === 'freelancer' ? 'active' : ''}
              onClick={() => setRole('freelancer')}
            >
              Freelancer
            </button>
          </div>
          <WalletConnect
            address={address}
            connecting={connecting}
            error={walletError}
            onConnect={handleConnect}
          />
        </div>
      </header>

      {demoMode && (
        <div className="demo-banner">
          Demo mode — showing mock data. Set <code>VITE_ESCROW_CONTRACT_ID</code> and{' '}
          <code>VITE_REPUTATION_CONTRACT_ID</code> in <code>.env</code> to connect to your deployed contracts.
        </div>
      )}

      <main className="app-main">
        <section className="ledger-section" aria-label="Milestones">
          <div className="section-header">
            <h2>Contract milestones</h2>
            <ReputationBadge reputation={reputation} loading={loadingReputation} />
          </div>

          {txSuccess && (
            <div className="success-panel" role="status">
              <p>
                ✓ {txSuccess.message}{' '}
                {txSuccess.hash && (
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${txSuccess.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on Stellar Expert ↗
                  </a>
                )}
              </p>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setTxSuccess(null)}
              >
                Dismiss
              </button>
            </div>
          )}

          {milestonesError && (
            <div className="error-panel" role="alert" aria-live="assertive">
              <p>⚠️ {milestonesError}</p>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => { setMilestonesError(null); loadMilestones(); }}
              >
                Dismiss & Retry
              </button>
            </div>
          )}

          {loadingMilestones && (
            <ul className="milestone-list" aria-busy="true">
              {[0, 1].map((i) => (
                <li key={i} className="milestone-card skeleton">
                  <div className="seal" />
                  <div className="milestone-body">
                    <div className="skeleton-line wide" />
                    <div className="skeleton-line narrow" />
                  </div>
                </li>
              ))}
            </ul>
          )}

          {!loadingMilestones && (
            <ul className="milestone-list">
              {milestones.map((m, i) => (
                <MilestoneCard
                  key={i}
                  index={i}
                  milestone={m}
                  role={role}
                  busy={busyIndex === i}
                  onFund={handleFund}
                  onSubmit={handleSubmit}
                  onApprove={handleApprove}
                />
              ))}
            </ul>
          )}
        </section>

        <aside className="feed-section" aria-label="Activity">
          <ActivityFeed events={events} live={live && !demoMode} />
        </aside>
      </main>
    </div>
  );
}
