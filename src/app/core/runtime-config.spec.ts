import { getRuntimeConfig, getSupabasePublicCredentials } from './runtime-config';

describe('runtime-config', () => {
  afterEach(() => {
    delete window.__appConfig__;
  });

  it('prefers publishableKey when both keys are present', () => {
    window.__appConfig__ = {
      supabase: {
        url: 'https://example.supabase.co',
        publishableKey: 'publishable-key',
        anonKey: 'legacy-anon-key'
      }
    };

    expect(getSupabasePublicCredentials()).toEqual({
      url: 'https://example.supabase.co',
      key: 'publishable-key'
    });
  });

  it('falls back to anonKey when publishableKey is missing', () => {
    window.__appConfig__ = {
      supabase: {
        url: 'https://example.supabase.co',
        anonKey: 'legacy-anon-key'
      }
    };

    expect(getSupabasePublicCredentials()).toEqual({
      url: 'https://example.supabase.co',
      key: 'legacy-anon-key'
    });
  });

  it('returns placeholder config when runtime config is missing', () => {
    expect(getRuntimeConfig()).toEqual({
      supabase: {
        url: '',
        publishableKey: undefined,
        anonKey: undefined
      }
    });
  });
});
