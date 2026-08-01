import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ActivityFeed from './ActivityFeed.jsx';

describe('ActivityFeed', () => {
  it('shows an empty state when there are no events', () => {
    render(<ActivityFeed events={[]} live={false} />);
    expect(screen.getByText(/no on-chain activity yet/i)).toBeInTheDocument();
    expect(screen.getByText(/paused/i)).toBeInTheDocument();
  });

  it('renders events with human-readable descriptions', () => {
    const events = [
      { id: '1', ledger: 100, topic: ['funded', 0] },
      { id: '2', ledger: 101, topic: ['rep_upd'] },
    ];
    render(<ActivityFeed events={events} live />);
    expect(screen.getByText(/milestone 1 funded/i)).toBeInTheDocument();
    expect(screen.getByText(/reputation updated on-chain/i)).toBeInTheDocument();
    expect(screen.getByText(/live/i)).toBeInTheDocument();
  });
});
