import React from 'react';

function truncate(address) {
  if (!address) return '';
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export default function WalletConnect({ address, connecting, error, onConnect }) {
  return (
    <div className="wallet-connect">
      {address ? (
        <span className="wallet-pill" title={address}>
          <span className="wallet-dot" aria-hidden="true" />
          {truncate(address)}
        </span>
      ) : (
        <button
          type="button"
          className="btn btn-primary"
          onClick={(e) => { e.preventDefault(); onConnect(); }}
          disabled={connecting}
          aria-busy={connecting}
        >
          {connecting ? 'Connecting…' : 'Connect Freighter'}
        </button>
      )}
      {error && <p className="inline-error" role="alert">{error}</p>}
    </div>
  );
}
