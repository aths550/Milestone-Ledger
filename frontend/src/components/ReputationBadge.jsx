import React from 'react';

export default function ReputationBadge({ reputation, loading }) {
  if (loading) {
    return <div className="reputation-badge skeleton" aria-busy="true">Loading reputation…</div>;
  }
  if (!reputation) {
    return null;
  }

  let avg = 0;
  if (typeof reputation.average_rating_x100 === 'number') {
    avg = reputation.average_rating_x100 / 100;
  } else if (reputation.rating_count && Number(reputation.rating_count) > 0) {
    avg = Number(reputation.rating_sum) / Number(reputation.rating_count);
  }

  const completed = Number(reputation.completed_milestones ?? 0);

  return (
    <div className="reputation-badge">
      <div className="reputation-score">{avg.toFixed(2)}<span>/5</span></div>
      <div className="reputation-detail">
        <strong>{completed}</strong> milestone{completed === 1 ? '' : 's'} completed on-chain
      </div>
    </div>
  );
}
