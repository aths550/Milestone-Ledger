import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MilestoneCard, { formatAmount } from './MilestoneCard.jsx';

describe('formatAmount', () => {
  it('converts stroops to XLM with up to 2 decimals', () => {
    expect(formatAmount(1_000_000)).toBe('0.1 XLM');
    expect(formatAmount(10_000_000)).toBe('1 XLM');
    expect(formatAmount(25_500_000)).toBe('2.55 XLM');
  });
});

describe('MilestoneCard', () => {
  const baseMilestone = { description: 'design_mockups', amount: 1_000_000, status: 'Created' };

  it('shows a fund button to the client when milestone is unfunded', () => {
    const onFund = vi.fn();
    render(
      <ul>
        <MilestoneCard index={0} milestone={baseMilestone} role="client" busy={false} onFund={onFund} onSubmit={() => {}} onApprove={() => {}} />
      </ul>,
    );
    const button = screen.getByRole('button', { name: /fund milestone/i });
    fireEvent.click(button);
    expect(onFund).toHaveBeenCalledWith(0);
  });

  it('does not show a fund button to the freelancer', () => {
    render(
      <ul>
        <MilestoneCard index={0} milestone={baseMilestone} role="freelancer" busy={false} onFund={() => {}} onSubmit={() => {}} onApprove={() => {}} />
      </ul>,
    );
    expect(screen.queryByRole('button', { name: /fund milestone/i })).not.toBeInTheDocument();
  });

  it('shows a submit button to the freelancer once funded', () => {
    const onSubmit = vi.fn();
    const milestone = { ...baseMilestone, status: 'Funded' };
    render(
      <ul>
        <MilestoneCard index={1} milestone={milestone} role="freelancer" busy={false} onFund={() => {}} onSubmit={onSubmit} onApprove={() => {}} />
      </ul>,
    );
    fireEvent.click(screen.getByRole('button', { name: /submit work/i }));
    expect(onSubmit).toHaveBeenCalledWith(1);
  });

  it('shows an approve control with rating to the client once submitted', () => {
    const onApprove = vi.fn();
    const milestone = { ...baseMilestone, status: 'Submitted' };
    render(
      <ul>
        <MilestoneCard index={0} milestone={milestone} role="client" busy={false} onFund={() => {}} onSubmit={() => {}} onApprove={onApprove} />
      </ul>,
    );
    fireEvent.click(screen.getByRole('button', { name: /approve & pay/i }));
    expect(onApprove).toHaveBeenCalledWith(0, 5);
  });

  it('disables action buttons while busy', () => {
    render(
      <ul>
        <MilestoneCard index={0} milestone={baseMilestone} role="client" busy onFund={() => {}} onSubmit={() => {}} onApprove={() => {}} />
      </ul>,
    );
    expect(screen.getByRole('button', { name: /funding/i })).toBeDisabled();
  });

  it('shows a sealed confirmation once approved', () => {
    const milestone = { ...baseMilestone, status: 'Approved' };
    render(
      <ul>
        <MilestoneCard index={0} milestone={milestone} role="client" busy={false} onFund={() => {}} onSubmit={() => {}} onApprove={() => {}} />
      </ul>,
    );
    expect(screen.getByText(/payment released and reputation recorded/i)).toBeInTheDocument();
  });
});
