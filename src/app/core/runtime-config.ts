import { environment } from '../../environments/environment';

export interface AppRuntimeConfig {
  supabase: {
    url: string;
    publishableKey?: string;
    anonKey?: string;
  };
}

declare global {
  interface Window {
    __appConfig__?: Partial<AppRuntimeConfig>;
  }
}

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function getRuntimeConfig(): AppRuntimeConfig {
  const runtimeConfig = typeof window === 'undefined' ? undefined : window.__appConfig__;

  return {
    supabase: {
      url: normalize(runtimeConfig?.supabase?.url) || normalize(environment.supabase.url),
      publishableKey: normalize(runtimeConfig?.supabase?.publishableKey) || normalize(environment.supabase.publishableKey) || undefined,
      anonKey: normalize(runtimeConfig?.supabase?.anonKey) || normalize(environment.supabase.anonKey) || undefined
    }
  };
}

export function getSupabasePublicCredentials(): { key: string; url: string } {
  const config = getRuntimeConfig();
  return {
    url: config.supabase.url,
    key: config.supabase.publishableKey || config.supabase.anonKey || ''
  };
}

export {};
