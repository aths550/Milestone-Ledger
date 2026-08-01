import React from 'react';

export default function ReputationBadge({ reputation, loading }) {
  if (loading) {
    return <div className="reputation-badge skeleton" aria-busy="true">Loading reputation…</div>;
  }
  if (!reputation) {
    return null;
  }

  const avg = (reputation.average_rating_x100 ?? 0) / 100;

  return (
    <div className="reputation-badge">
      <div className="reputation-score">{avg.toFixed(2)}<span>/5</span></div>
      <div className="reputation-detail">
        <strong>{reputation.completed_milestones ?? 0}</strong> milestones completed on-chain
      </div>
    </div>
  );
}
