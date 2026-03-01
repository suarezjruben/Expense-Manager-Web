import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly sessionSubject = new BehaviorSubject<Session | null>(null);
  private readonly recoveryModeSubject = new BehaviorSubject<boolean>(false);

  readonly session$ = this.sessionSubject.asObservable();
  readonly recoveryMode$ = this.recoveryModeSubject.asObservable();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly zone: NgZone
  ) {
    if (!this.supabase.isConfigured) {
      return;
    }

    this.supabase.client.auth.onAuthStateChange((_event, session) => {
      this.zone.run(() => this.handleAuthStateChange(_event, session));
    });
    void this.loadInitialSession();
  }

  async signInWithOtp(email: string): Promise<void> {
    const { error } = await this.supabase.client.auth.signInWithOtp({
      email,
      options: {
        ...this.buildEmailRedirectOptions(),
        shouldCreateUser: false
      }
    });

    if (error) {
      throw new Error(error.message);
    }
  }

  async signInWithPassword(email: string, password: string): Promise<void> {
    const { error } = await this.supabase.client.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      throw new Error(error.message);
    }
  }

  async signUpWithPassword(email: string, password: string): Promise<{ emailConfirmationRequired: boolean }> {
    const { data, error } = await this.supabase.client.auth.signUp({
      email,
      password,
      options: this.buildEmailRedirectOptions()
    });

    if (error) {
      throw new Error(error.message);
    }

    return {
      emailConfirmationRequired: !data.session
    };
  }

  async resetPasswordForEmail(email: string): Promise<void> {
    const redirectTo = this.getRedirectUrl();
    const { error } = await this.supabase.client.auth.resetPasswordForEmail(email, {
      redirectTo
    });

    if (error) {
      throw new Error(error.message);
    }
  }

  async updatePassword(password: string): Promise<void> {
    const { error } = await this.supabase.client.auth.updateUser({
      password
    });

    if (error) {
      throw new Error(error.message);
    }

    this.clearRecoveryMode();
  }

  async signOut(): Promise<void> {
    const { error } = await this.supabase.client.auth.signOut();
    if (error) {
      throw new Error(error.message);
    }

    this.clearRecoveryMode();
  }

  private async loadInitialSession(): Promise<void> {
    const { data, error } = await this.supabase.client.auth.getSession();
    if (error) {
      throw new Error(error.message);
    }

    this.sessionSubject.next(data.session);
    this.recoveryModeSubject.next(Boolean(data.session && this.isRecoveryUrl()));
  }

  private buildEmailRedirectOptions(): { emailRedirectTo?: string } | undefined {
    const redirectTo = this.getRedirectUrl();
    return redirectTo
      ? {
          emailRedirectTo: redirectTo
        }
      : undefined;
  }

  private getRedirectUrl(): string | undefined {
    if (typeof globalThis.location === 'undefined') {
      return undefined;
    }

    return globalThis.location.origin;
  }

  private handleAuthStateChange(event: AuthChangeEvent, session: Session | null): void {
    this.sessionSubject.next(session);

    if (event === 'PASSWORD_RECOVERY') {
      this.recoveryModeSubject.next(true);
      return;
    }

    if (event === 'SIGNED_OUT') {
      this.recoveryModeSubject.next(false);
      return;
    }

    if (event === 'INITIAL_SESSION') {
      this.recoveryModeSubject.next(Boolean(session && this.isRecoveryUrl()));
    }
  }

  private clearRecoveryMode(): void {
    this.recoveryModeSubject.next(false);
    this.clearAuthRedirectState();
  }

  private isRecoveryUrl(): boolean {
    if (typeof globalThis.location === 'undefined') {
      return false;
    }

    const searchParams = new URLSearchParams(globalThis.location.search);
    const hashParams = new URLSearchParams(globalThis.location.hash.replace(/^#/, ''));
    return searchParams.get('type') === 'recovery' || hashParams.get('type') === 'recovery';
  }

  private clearAuthRedirectState(): void {
    if (typeof globalThis.history === 'undefined' || typeof globalThis.location === 'undefined') {
      return;
    }

    const url = new URL(globalThis.location.href);
    const authKeys = ['access_token', 'refresh_token', 'expires_at', 'expires_in', 'token_type', 'type'];

    authKeys.forEach((key) => url.searchParams.delete(key));

    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
    authKeys.forEach((key) => hashParams.delete(key));
    url.hash = hashParams.toString();

    const nextUrl = `${url.pathname}${url.search}${url.hash ? `#${url.hash.replace(/^#/, '')}` : ''}`;
    globalThis.history.replaceState({}, '', nextUrl || '/');
  }
}
