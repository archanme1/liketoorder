import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';

import { RequestAppError, markArrived } from '../api';
import { ArrivedButton } from '../components/ArrivedButton';
import type { TableRequest } from '../schema';

import { dump } from '../__fixtures__/dump';
import { makeTableRequest } from '../__fixtures__/tableRequests';

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  markArrived: jest.fn(),
}));

const arrivedMock = jest.mocked(markArrived);

// The table is at 2026-11-09 00:00 UTC. The window is 2026-11-08 22:00 UTC to 2026-11-09 04:00 UTC.
const TABLE_AT = '2026-11-09T00:00:00+00:00';
const T = Date.parse(TABLE_AT);
const HOUR = 3_600_000;
const accepted = (over: Partial<TableRequest> = {}) =>
  makeTableRequest({ status: 'accepted', display_status: 'accepted', table_at: TABLE_AT, ...over });
const iso = (ms: number) => new Date(ms).toISOString();

let client: QueryClient;
// `serverNowMs` is what the server said the time was when the request was read. The phone's clock
// (Date.now, faked) is set separately, so a wrong phone clock can be played.
async function renderButton(
  request: TableRequest,
  { serverNowMs, phoneNowMs }: { serverNowMs: number; phoneNowMs: number },
) {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
  jest.setSystemTime(phoneNowMs);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <ArrivedButton request={request} serverNow={iso(serverNowMs)} fetchedAt={phoneNowMs} />
    </QueryClientProvider>,
  );
}

const button = () => screen.queryByRole('button', { name: /you've arrived/i });

beforeEach(() => {
  jest.clearAllMocks();
  arrivedMock.mockReset();
});

afterEach(async () => {
  await cleanup();
  client?.clear();
  jest.useRealTimers();
});

describe('when the button shows (server clock)', () => {
  it('inside the window: shown, with a spoken label', async () => {
    await renderButton(accepted(), { serverNowMs: T - HOUR, phoneNowMs: T - HOUR });
    expect(screen.getByRole('button', { name: "Tell Luigi's you've arrived" })).toBeOnTheScreen();
    expect(screen.getByText("I've arrived")).toBeOnTheScreen();
  });

  it.each([
    ['exactly 2 hours before', T - 2 * HOUR, true],
    ['one second before that', T - 2 * HOUR - 1_000, false],
    ['exactly 4 hours after', T + 4 * HOUR, true],
    ['one second after that', T + 4 * HOUR + 1_000, false],
  ])('%s', async (_label, serverNowMs, shown) => {
    await renderButton(accepted(), { serverNowMs, phoneNowMs: serverNowMs });
    expect(button() !== null).toBe(shown);
  });

  it('a phone clock far inside the window does not show it when the server says it is too early', async () => {
    await renderButton(accepted(), { serverNowMs: T - 10 * HOUR, phoneNowMs: T });
    expect(button()).toBeNull();
  });

  it('a phone clock far outside the window does not hide it when the server says it is open', async () => {
    await renderButton(accepted(), { serverNowMs: T, phoneNowMs: T + 30 * 24 * HOUR });
    expect(button()).not.toBeNull();
  });

  it('opens by itself when the server clock reaches 2 hours before (the phone only schedules)', async () => {
    await renderButton(accepted(), {
      serverNowMs: T - 2 * HOUR - 60_000,
      phoneNowMs: T - 2 * HOUR - 60_000,
    });
    expect(button()).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(61_000);
    });
    expect(button()).not.toBeNull();
  });

  it.each(['pending', 'declined', 'expired', 'cancelled', 'completed', 'no_show'] as const)(
    'never on a %s request, even inside the window',
    async (status) => {
      await renderButton(accepted({ status, display_status: status }), {
        serverNowMs: T,
        phoneNowMs: T,
      });
      expect(button()).toBeNull();
    },
  );

  it('never once arrived: the done line instead', async () => {
    await renderButton(accepted({ arrived_at: iso(T - HOUR) }), { serverNowMs: T, phoneNowMs: T });
    expect(button()).toBeNull();
    expect(screen.getByText("You've told the restaurant you arrived")).toBeOnTheScreen();
  });
});

describe('the tap', () => {
  it('sends one call, is off and says Sending... while it runs, then reads as done', async () => {
    let finish: (value: TableRequest) => void = () => undefined;
    arrivedMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await renderButton(accepted(), { serverNowMs: T, phoneNowMs: T });

    await fireEvent.press(button()!);
    // react-query notifies on a timer, which is faked here.
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    await fireEvent.press(screen.getByRole('button', { name: /^Telling Luigi's/ }));
    expect(arrivedMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Sending...')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /^Telling Luigi's/ })).toBeDisabled();

    await act(async () => finish(accepted({ arrived_at: iso(T) })));
    expect(await screen.findByText("You've told the restaurant you arrived")).toBeOnTheScreen();
    expect(button()).toBeNull();
  });

  it.each([
    ['already_arrived', "You've already told the restaurant you arrived."],
    ['arrival_window', /^You can tell the restaurant you've arrived from 2 hours before/],
  ] as const)('a refused tap (%s) says so and re-reads the request', async (code, message) => {
    arrivedMock.mockRejectedValue(new RequestAppError(code));
    await renderButton(accepted(), { serverNowMs: T, phoneNowMs: T });
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    await fireEvent.press(button()!);
    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(invalidate).toHaveBeenCalled();
  });

  it('reads no location: it only ever calls markArrived with the request id', async () => {
    arrivedMock.mockResolvedValue(accepted({ arrived_at: iso(T) }));
    await renderButton(accepted(), { serverNowMs: T, phoneNowMs: T });
    await fireEvent.press(button()!);
    expect(arrivedMock).toHaveBeenCalledWith(accepted().id);
    expect(arrivedMock.mock.calls[0]).toHaveLength(1);
  });

  it('a pending request is never spoken as accepted or confirmed here', async () => {
    await renderButton(accepted({ status: 'pending', display_status: 'pending' }), {
      serverNowMs: T,
      phoneNowMs: T,
    });
    expect(dump()).not.toMatch(/accepted|confirm|booked/i);
  });
});
