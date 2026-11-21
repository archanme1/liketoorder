import { resetModuleMocks } from '../__fixtures__/foodLog';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));
jest.mock('@/features/map/api', () => ({
  ...jest.requireActual('@/features/map/api'),
  fetchPinsInBounds: jest.fn(),
}));

// The shared reset helper (spec 16 PR 4 review): a path that would reset nothing throws.
describe('resetModuleMocks', () => {
  it('resets the mock functions of a mocked module', () => {
    const api = jest.requireMock<{ fetchPinsInBounds: jest.Mock }>('@/features/map/api');
    api.fetchPinsInBounds.mockResolvedValue({ pins: [] });
    api.fetchPinsInBounds('x');
    resetModuleMocks('@/features/map/api');
    expect(api.fetchPinsInBounds).not.toHaveBeenCalled();
    expect(api.fetchPinsInBounds.getMockImplementation()).toBeUndefined();
  });

  it('also resets the mocks inside an exported object (the mocked supabase client)', () => {
    const { supabase } = jest.requireMock<{ supabase: { rpc: jest.Mock; from: jest.Mock } }>(
      '@/lib/supabase',
    );
    supabase.rpc.mockResolvedValue({ data: 1, error: null });
    supabase.rpc('list_offers_near', {});
    resetModuleMocks('@/lib/supabase');
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.rpc.getMockImplementation()).toBeUndefined();
  });

  it('throws for a path whose module has no mock functions', () => {
    expect(() => resetModuleMocks('@/theme/tokens')).toThrow(
      "resetModuleMocks('@/theme/tokens'): no mock functions found",
    );
  });
});
