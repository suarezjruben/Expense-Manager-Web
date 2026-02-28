import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getSupabasePublicCredentials } from './runtime-config';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private clientInstance: SupabaseClient | null = null;

  get isConfigured(): boolean {
    const { key, url } = getSupabasePublicCredentials();
    return Boolean(url && key);
  }

  get client(): SupabaseClient {
    const { key, url } = getSupabasePublicCredentials();

    if (!this.isConfigured) {
      throw new Error('Supabase is not configured. Copy public/runtime-config.example.js to public/runtime-config.js.');
    }

    if (!this.clientInstance) {
      this.clientInstance = createClient(url, key, {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: true,
          persistSession: true
        }
      });
    }

    return this.clientInstance;
  }

  async getRequiredUserId(): Promise<string> {
    const { data, error } = await this.client.auth.getSession();
    if (error) {
      throw new Error(error.message);
    }

    const userId = data.session?.user.id;
    if (!userId) {
      throw new Error('Sign in required.');
    }

    return userId;
  }
}
