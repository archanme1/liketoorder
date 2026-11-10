import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { getMyTableRequest, getPickupRequest } from '../api';
import { requestKeys } from '../hooks/keys';
import { useCustomerRequest } from '../hooks/useCustomerRequest';

import { REQUEST_ID, makeRequest } from '../__fixtures__/requests';
import { TABLE_REQUEST_ID, makeTableRequest } from '../__fixtures__/tableRequests';

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getPickupRequest: jest.fn(),
  getMyTableRequest: jest.fn(),
}));

const pickupMock = jest.mocked(getPickupRequest);
const tableMock = jest.mocked(getMyTableRequest);
const NOW = '2026-11-08T17:00:00Z';
const found = <T,>(request: T) => ({ server_now: NOW, request });
const notFound = { server_now: NOW, request: null };

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  pickupMock.mockReset();
  tableMock.mockReset();
});

afterEach(async () => {
  client.clear();
  await cleanup();
});

describe('useCustomerRequest: which read is used', () => {
  it('a table hint reads the table call only', async () => {
    tableMock.mockResolvedValue(found(makeTableRequest()));
    const { result } = await renderHook(() => useCustomerRequest(TABLE_REQUEST_ID, 'table'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data?.request?.kind).toBe('table'));
    expect(pickupMock).not.toHaveBeenCalled();
  });

  it('a pickup hint reads the pickup call only', async () => {
    pickupMock.mockResolvedValue(found(makeRequest()));
    const { result } = await renderHook(() => useCustomerRequest(REQUEST_ID, 'pickup'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data?.request?.kind).toBe('pickup'));
    expect(tableMock).not.toHaveBeenCalled();
  });

  it('with no hint it uses the kind of the row in the loaded Sent list', async () => {
    client.setQueryData(requestKeys.mine, {
      pages: [
        {
          server_now: NOW,
          requests: [makeTableRequest()],
          next_cursor: null,
        },
      ],
      pageParams: [{}],
    });
    tableMock.mockResolvedValue(found(makeTableRequest()));
    const { result } = await renderHook(() => useCustomerRequest(TABLE_REQUEST_ID), { wrapper });
    await waitFor(() => expect(result.current.data?.request?.kind).toBe('table'));
    expect(pickupMock).not.toHaveBeenCalled();
  });

  it('with no hint and no row it tries pickup, then table', async () => {
    pickupMock.mockResolvedValue(notFound);
    tableMock.mockResolvedValue(found(makeTableRequest()));
    const { result } = await renderHook(() => useCustomerRequest(TABLE_REQUEST_ID), { wrapper });
    await waitFor(() => expect(result.current.data?.request?.kind).toBe('table'));
    expect(pickupMock).toHaveBeenCalledTimes(1);
    expect(tableMock).toHaveBeenCalledTimes(1);
  });

  it('a wrong hint is just not found: the server answers null, nothing leaks', async () => {
    tableMock.mockResolvedValue(notFound);
    const { result } = await renderHook(() => useCustomerRequest(REQUEST_ID, 'table'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toEqual(notFound));
    expect(pickupMock).not.toHaveBeenCalled();
  });

  it('not found for both reads is not found', async () => {
    pickupMock.mockResolvedValue(notFound);
    tableMock.mockResolvedValue(notFound);
    const { result } = await renderHook(() => useCustomerRequest(REQUEST_ID), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(notFound));
  });
});
