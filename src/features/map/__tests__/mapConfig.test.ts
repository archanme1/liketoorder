import { isMapConfigured, mapKeyName } from '../mapConfig';

describe('mapConfig', () => {
  it('needs the key for the current platform', () => {
    expect(isMapConfigured({ EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY: 'k' }, 'ios')).toBe(true);
    expect(isMapConfigured({ EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY: 'k' }, 'ios')).toBe(false);
    expect(isMapConfigured({ EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY: 'k' }, 'android')).toBe(true);
    expect(isMapConfigured({ EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY: 'k' }, 'android')).toBe(false);
  });

  it('treats empty or missing keys, and web, as not configured', () => {
    expect(isMapConfigured({ EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY: '' }, 'ios')).toBe(false);
    expect(isMapConfigured({}, 'ios')).toBe(false);
    expect(isMapConfigured({ EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY: 'k' }, 'web')).toBe(false);
  });

  it('names the variable for the platform', () => {
    expect(mapKeyName('ios')).toBe('EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY');
    expect(mapKeyName('android')).toBe('EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY');
  });
});
