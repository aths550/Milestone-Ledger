import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import App from './App.jsx';

// No VITE_ESCROW_CONTRACT_ID / VITE_REPUTATION_CONTRACT_ID are set in the
// test environment, so the app should fall back to demo mode and render
// mock data without touching the network.
describe('App (demo mode)', () => {
  it('renders the demo banner and mock milestones', async () => {
    render(<App />);
    expect(screen.getByText(/demo mode/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/design mockups/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/final delivery/i)).toBeInTheDocument();
  });

  it('lets the user switch between client and freelancer views', async () => {
    render(<App />);
    const freelancerToggle = screen.getByRole('button', { name: 'Freelancer' });
    fireEvent.click(freelancerToggle);
    expect(freelancerToggle.className).toContain('active');
  });
});
