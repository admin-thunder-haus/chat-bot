import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SuggestionPanel } from './SuggestionPanel';

const SUGGESTIONS = ['First suggested reply', 'Second suggested reply'];

function renderPanel(
  overrides: Partial<Parameters<typeof SuggestionPanel>[0]> = {},
) {
  const props = {
    suggestions: SUGGESTIONS,
    loading: false,
    composerHasText: false,
    busy: false,
    onUse: vi.fn(),
    onSend: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  render(<SuggestionPanel {...props} />);
  return props;
}

describe('SuggestionPanel', () => {
  it('renders every suggestion with Use and Send actions', () => {
    renderPanel();
    expect(screen.getByText('First suggested reply')).toBeInTheDocument();
    expect(screen.getByText('Second suggested reply')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^use$/i })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /^send$/i })).toHaveLength(2);
  });

  it('fills the composer immediately when it is empty', async () => {
    const user = userEvent.setup();
    const props = renderPanel({ composerHasText: false });

    await user.click(screen.getAllByRole('button', { name: /^use$/i })[0]);

    expect(props.onUse).toHaveBeenCalledWith('First suggested reply');
    expect(screen.queryByText(/replace your reply/i)).not.toBeInTheDocument();
  });

  it('asks for confirmation before overwriting text the agent typed', async () => {
    const user = userEvent.setup();
    const props = renderPanel({ composerHasText: true });

    await user.click(screen.getAllByRole('button', { name: /^use$/i })[1]);

    // Nothing overwritten yet — a confirm dialog gates the action.
    expect(props.onUse).not.toHaveBeenCalled();
    expect(screen.getByText(/replace your reply/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^replace$/i }));
    expect(props.onUse).toHaveBeenCalledWith('Second suggested reply');
  });

  it('keeps the composer untouched when the confirm dialog is cancelled', async () => {
    const user = userEvent.setup();
    const props = renderPanel({ composerHasText: true });

    await user.click(screen.getAllByRole('button', { name: /^use$/i })[0]);
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(props.onUse).not.toHaveBeenCalled();
    expect(screen.queryByText(/replace your reply/i)).not.toBeInTheDocument();
  });

  it('sends a suggestion directly and supports dismissal', async () => {
    const user = userEvent.setup();
    const props = renderPanel();

    await user.click(screen.getAllByRole('button', { name: /^send$/i })[0]);
    expect(props.onSend).toHaveBeenCalledWith('First suggested reply');

    await user.click(
      screen.getByRole('button', { name: /dismiss suggestions/i }),
    );
    expect(props.onDismiss).toHaveBeenCalled();
  });

  it('shows a loading indicator while suggestions are generated', () => {
    renderPanel({ suggestions: null, loading: true });
    expect(screen.getByText(/generating suggestions/i)).toBeInTheDocument();
  });
});
