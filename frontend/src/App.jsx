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
} from './lib/stellar.js';

const MOCK_MILESTONES = [
  { description: 'design_mockups', amount: 1_000_000, status: 'Funded' },
  { description: 'final_delivery', amount: 2_000_000, status: 'Created' },
];

const MOCK_FREELANCER = 'GDEMO0000000000000000000000000000000000000000000FREELANCER';

const EVENT_POLL_INTERVAL_MS = 6000;

export default function App() {
  const [address, setAddress] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [walletError, setWalletError] = useState(null);

  const [role, setRole] = useState('client');

  const [milestones, setMilestones] = useState([]);
  const [loadingMilestones, setLoadingMilestones] = useState(true);
  const [milestonesError, setMilestonesError] = useState(null);
  const [busyIndex, setBusyIndex] = useState(null);

  const [reputation, setReputation] = useState(null);
  const [loadingReputation, setLoadingReputation] = useState(true);

  const [events, setEvents] = useState([]);
  const [live, setLive] = useState(false);
  const startLedgerRef = useRef(null);

  const demoMode = !isConfigured();

  const loadMilestones = useCallback(async () => {
    setLoadingMilestones(true);
    setMilestonesError(null);
    try {
      if (demoMode) {
        await new Promise((r) => setTimeout(r, 400));
        setMilestones(MOCK_MILESTONES);
      } else {
        const raw = await fetchMilestones();
        setMilestones(raw);
      }
    } catch (err) {
      setMilestonesError(err.message || 'Failed to load milestones from the contract.');
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
    } catch {
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
          startLedgerRef.current = Math.max(1, latest - 100);
        }
        const newEvents = await pollEvents({
          startLedger: startLedgerRef.current,
          contractIds: [CONFIG.escrowContractId, CONFIG.reputationContractId].filter(Boolean),
        });
        if (!cancelled && newEvents.length) {
          setEvents((prev) => [...newEvents, ...prev].slice(0, 30));
          startLedgerRef.current = Math.max(...newEvents.map((e) => e.ledger)) + 1;
        }
        if (!cancelled) setLive(true);
      } catch {
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
    } catch (err) {
      setWalletError(err.message || 'Could not connect to Freighter.');
    } finally {
      setConnecting(false);
    }
  };

  const withBusy = async (index, action, successEvent) => {
    setBusyIndex(index);
    setMilestonesError(null);
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
      } else {
        await action();
        await loadMilestones();
      }
    } catch (err) {
      setMilestonesError(err.message || 'Transaction failed.');
    } finally {
      setBusyIndex(null);
    }
  };

  const handleFund = (index) =>
    withBusy(index, () => fundMilestone(address, index), 'Funded');
  const handleSubmit = (index) =>
    withBusy(index, () => submitMilestone(address, index), 'Submitted');
  const handleApprove = (index, rating) =>
    withBusy(index, () => approveMilestone(address, index, rating), 'Approved');

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
              className={role === 'client' ? 'active' : ''}
              onClick={() => setRole('client')}
            >
              Client
            </button>
            <button
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

          {!loadingMilestones && milestonesError && (
            <div className="error-panel" role="alert">
              <p>{milestonesError}</p>
              <button className="btn btn-outline" onClick={loadMilestones}>Retry</button>
            </div>
          )}

          {!loadingMilestones && !milestonesError && (
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
