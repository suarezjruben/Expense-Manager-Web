import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private clientInstance: SupabaseClient | null = null;

  get isConfigured(): boolean {
    return Boolean(environment.supabase.url && environment.supabase.anonKey);
  }

  get client(): SupabaseClient {
    if (!this.isConfigured) {
      throw new Error('Supabase is not configured. Update src/environments/environment.ts.');
    }

    if (!this.clientInstance) {
      this.clientInstance = createClient(environment.supabase.url, environment.supabase.anonKey, {
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
