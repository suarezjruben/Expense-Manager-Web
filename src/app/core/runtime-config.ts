import { environment } from '../../environments/environment';

const DEFAULT_SUPABASE_SCHEMA = 'expense_manager';

export interface AppRuntimeConfig {
  supabase: {
    url: string;
    publishableKey?: string;
    anonKey?: string;
    schema: string;
  };
}

declare global {
  interface Window {
    __appConfig__?: {
      supabase?: Partial<AppRuntimeConfig['supabase']>;
    };
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
      anonKey: normalize(runtimeConfig?.supabase?.anonKey) || normalize(environment.supabase.anonKey) || undefined,
      schema: normalize(runtimeConfig?.supabase?.schema) || normalize(environment.supabase.schema) || DEFAULT_SUPABASE_SCHEMA
    }
  };
}

export function getSupabaseClientConfig(): { key: string; schema: string; url: string } {
  const config = getRuntimeConfig();
  return {
    url: config.supabase.url,
    key: config.supabase.publishableKey || config.supabase.anonKey || '',
    schema: config.supabase.schema
  };
}

export function getSupabasePublicCredentials(): { key: string; url: string } {
  const config = getSupabaseClientConfig();
  return {
    url: config.url,
    key: config.key
  };
}

export {};
