import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Session } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly sessionSubject = new BehaviorSubject<Session | null>(null);

  readonly session$ = this.sessionSubject.asObservable();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly zone: NgZone
  ) {
    if (!this.supabase.isConfigured) {
      return;
    }

    void this.loadInitialSession();
    this.supabase.client.auth.onAuthStateChange((_event, session) => {
      this.zone.run(() => this.sessionSubject.next(session));
    });
  }

  async signInWithOtp(email: string): Promise<void> {
    const { error } = await this.supabase.client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin
      }
    });

    if (error) {
      throw new Error(error.message);
    }
  }

  async signOut(): Promise<void> {
    const { error } = await this.supabase.client.auth.signOut();
    if (error) {
      throw new Error(error.message);
    }
  }

  private async loadInitialSession(): Promise<void> {
    const { data, error } = await this.supabase.client.auth.getSession();
    if (error) {
      throw new Error(error.message);
    }

    this.sessionSubject.next(data.session);
  }
}
