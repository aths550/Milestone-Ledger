import React, { useState } from 'react';

const STATUS_LABEL = {
  Created: 'Awaiting funding',
  Funded: 'Funded — work in progress',
  Submitted: 'Submitted for review',
  Approved: 'Sealed & paid',
};

export function formatDescription(description) {
  return String(description).replace(/_/g, ' ');
}

export function formatAmount(stroops) {
  // Native asset amounts on Stellar are in stroops (1 XLM = 10,000,000 stroops).
  const value = Number(stroops) / 10_000_000;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} XLM`;
}

export default function MilestoneCard({ index, milestone, role, busy, onFund, onSubmit, onApprove }) {
  const [rating, setRating] = useState(5);
  const status = milestone.status;
  const sealed = status === 'Approved';

  return (
    <li className={`milestone-card status-${status.toLowerCase()}`}>
      <div className={`seal ${sealed ? 'seal-closed' : ''}`} aria-hidden="true">
        <span>{index + 1}</span>
      </div>

      <div className="milestone-body">
        <div className="milestone-heading">
          <h3>{formatDescription(milestone.description)}</h3>
          <span className="milestone-status">{STATUS_LABEL[status] || status}</span>
        </div>
        <p className="milestone-amount">{formatAmount(milestone.amount)}</p>

        <div className="milestone-actions">
          {role === 'client' && status === 'Created' && (
            <button className="btn btn-outline" onClick={() => onFund(index)} disabled={busy}>
              {busy ? 'Funding…' : 'Fund milestone'}
            </button>
          )}

          {role === 'freelancer' && status === 'Funded' && (
            <button className="btn btn-outline" onClick={() => onSubmit(index)} disabled={busy}>
              {busy ? 'Submitting…' : 'Submit work'}
            </button>
          )}

          {role === 'client' && status === 'Submitted' && (
            <div className="approve-row">
              <label className="rating-label">
                Rating
                <select
                  value={rating}
                  onChange={(e) => setRating(Number(e.target.value))}
                  disabled={busy}
                >
                  {[5, 4, 3, 2, 1].map((r) => (
                    <option key={r} value={r}>{r} ★</option>
                  ))}
                </select>
              </label>
              <button className="btn btn-primary" onClick={() => onApprove(index, rating)} disabled={busy}>
                {busy ? 'Approving…' : 'Approve & pay'}
              </button>
            </div>
          )}

          {status === 'Approved' && <p className="milestone-done">Payment released and reputation recorded.</p>}
        </div>
      </div>
    </li>
  );
}
