import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from './App.jsx';

describe('App', () => {
  it('renders contract milestones header and role toggles', async () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /Milestone Ledger/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Client' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Freelancer' })).toBeInTheDocument();
  });

  it('lets the user switch between client and freelancer views', async () => {
    render(<App />);
    const freelancerToggle = screen.getByRole('button', { name: 'Freelancer' });
    fireEvent.click(freelancerToggle);
    expect(freelancerToggle.className).toContain('active');
  });
});
