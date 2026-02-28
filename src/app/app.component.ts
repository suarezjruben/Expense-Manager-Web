import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
import { SupabaseService } from './core/supabase.service';

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  email = '';
  authBusy = false;
  authMessage = '';

  constructor(
    readonly auth: AuthService,
    readonly supabase: SupabaseService
  ) {}

  async signIn(): Promise<void> {
    const email = this.email.trim();
    if (!email) {
      this.authMessage = 'Email is required.';
      return;
    }

    this.authBusy = true;
    this.authMessage = '';

    try {
      await this.auth.signInWithOtp(email);
      this.authMessage = 'Check your email for the Supabase magic link.';
      this.email = '';
    } catch (error) {
      this.authMessage = this.toMessage(error);
    } finally {
      this.authBusy = false;
    }
  }

  async signOut(): Promise<void> {
    this.authBusy = true;
    this.authMessage = '';

    try {
      await this.auth.signOut();
    } catch (error) {
      this.authMessage = this.toMessage(error);
    } finally {
      this.authBusy = false;
    }
  }

  private toMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return 'Request failed';
  }
}
