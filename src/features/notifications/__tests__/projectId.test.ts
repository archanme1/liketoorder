import { getProjectId, getPushToken } from '../pushModule';

// The real app config under jest-expo: no `eas init` yet, so no EAS project id (Decision 19).
describe('the app as configured today', () => {
  it('has no EAS project id', () => {
    expect(getProjectId()).toBeNull();
  });

  it('asks for no push token and does not throw', async () => {
    await expect(getPushToken()).resolves.toBeNull();
  });
});
