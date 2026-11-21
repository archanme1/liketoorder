import config from '../../../../app.config';

// The promise made to the person about their location must match what the app does: the exact
// position stays on the phone, and only a rough area (a grid-snapped box or grid point) is sent.
function whenInUseText(): string {
  const plugins = config.plugins as (string | [string, Record<string, unknown>])[] | undefined;
  const plugin = plugins?.find((p) => Array.isArray(p) && p[0] === 'expo-location');
  if (!Array.isArray(plugin)) throw new Error('expo-location plugin missing');
  return String(plugin[1].locationWhenInUsePermission);
}

describe('the location permission text', () => {
  it('says the exact location stays on the phone and only a rough area is received', () => {
    const text = whenInUseText();
    expect(text).toContain('Your exact location stays on your phone');
    expect(text).toContain('We only receive a rough area');
  });

  it('no longer claims the location "stays on your phone" without the rough-area caveat', () => {
    expect(whenInUseText()).not.toMatch(/Your location stays on your phone\.\s*$/);
  });
});
