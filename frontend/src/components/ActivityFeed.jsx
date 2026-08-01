import React from 'react';

const EVENT_COPY = {
  added: () => `New milestone added to contract`,
  funded: (t) => `Milestone ${Number(t?.[1]) + 1 || ''} funded`,
  submitted: (t) => `Milestone ${Number(t?.[1]) + 1 || ''} submitted for review`,
  approved: (t) => `Milestone ${Number(t?.[1]) + 1 || ''} approved`,
  paid: (t) => `Payment released for milestone ${Number(t?.[1]) + 1 || ''}`,
  rep_upd: () => `Reputation updated on-chain`,
  caller_ok: () => `Escrow contract authorized in reputation registry`,
};

export default function ActivityFeed({ events, live }) {
  return (
    <div className="activity-feed">
      <div className="activity-feed-header">
        <h2>Ledger activity</h2>
        <span className={`live-dot ${live ? 'live-on' : ''}`} aria-hidden="true" />
        <span className="live-label">{live ? 'Live' : 'Paused'}</span>
      </div>

      {events.length === 0 ? (
        <p className="empty-state">No on-chain activity yet. Actions you take will appear here in real time.</p>
      ) : (
        <ul className="activity-list">
          {events.map((evt) => {
            const key = evt.topic?.[0];
            const describe = EVENT_COPY[key] || (() => key || 'Contract event');
            return (
              <li key={evt.id} className="activity-item">
                <span className="activity-text">{describe(evt.topic)}</span>
                <span className="activity-meta">ledger {evt.ledger}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
