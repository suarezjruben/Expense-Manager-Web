import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
import { PwaInstallService } from './core/pwa-install.service';
import { SupabaseService } from './core/supabase.service';
import { PwaInstallBannerComponent } from './components/pwa-install-banner.component';

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule, RouterOutlet, RouterLink, RouterLinkActive, PwaInstallBannerComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  private readonly pwaInstall = inject(PwaInstallService);
  email = '';
  password = '';
  nextPassword = '';
  confirmNextPassword = '';
  showPasswordPanel = false;
  authBusy = false;
  authMessage = '';

  constructor(
    readonly auth: AuthService,
    readonly supabase: SupabaseService
  ) {}

  async signInWithMagicLink(): Promise<void> {
    const email = this.email.trim();
    if (!email) {
      this.authMessage = 'Email is required.';
      return;
    }

    this.authBusy = true;
    this.authMessage = '';

    try {
      await this.auth.signInWithOtp(email);
      this.authMessage = 'Check your email for the sign-in link.';
      this.email = '';
    } catch (error) {
      this.authMessage = this.toMessage(error);
    } finally {
      this.authBusy = false;
    }
  }

  async sendPasswordReset(): Promise<void> {
    const email = this.email.trim();
    if (!email) {
      this.authMessage = 'Enter your email address to reset your password.';
      return;
    }

    this.authBusy = true;
    this.authMessage = '';

    try {
      await this.auth.resetPasswordForEmail(email);
      this.authMessage = 'If that account exists, a password reset link is on the way.';
    } catch (error) {
      this.authMessage = this.toMessage(error);
    } finally {
      this.authBusy = false;
    }
  }

  async updatePassword(): Promise<void> {
    const nextPassword = this.nextPassword;
    const confirmNextPassword = this.confirmNextPassword;

    if (!nextPassword) {
      this.authMessage = 'New password is required.';
      return;
    }

    if (nextPassword.length < 8) {
      this.authMessage = 'Use at least 8 characters for the new password.';
      return;
    }

    if (nextPassword !== confirmNextPassword) {
      this.authMessage = 'Passwords do not match.';
      return;
    }

    this.authBusy = true;
    this.authMessage = '';

    try {
      await this.auth.updatePassword(nextPassword);
      this.authMessage = 'Password updated.';
      this.showPasswordPanel = false;
      this.resetPasswordFields();
    } catch (error) {
      this.authMessage = this.toMessage(error);
    } finally {
      this.authBusy = false;
    }
  }

  openPasswordPanel(): void {
    this.showPasswordPanel = true;
    this.authMessage = '';
    this.resetPasswordFields();
  }

  cancelPasswordPanel(): void {
    this.showPasswordPanel = false;
    this.authMessage = '';
    this.resetPasswordFields();
  }

  async signInWithPassword(): Promise<void> {
    const credentials = this.getEmailPasswordCredentials();
    if (!credentials) {
      return;
    }

    this.authBusy = true;
    this.authMessage = '';

    try {
      await this.auth.signInWithPassword(credentials.email, credentials.password);
      this.password = '';
    } catch (error) {
      this.authMessage = this.toMessage(error);
    } finally {
      this.authBusy = false;
    }
  }

  async signUpWithPassword(): Promise<void> {
    const credentials = this.getEmailPasswordCredentials();
    if (!credentials) {
      return;
    }

    this.authBusy = true;
    this.authMessage = '';

    try {
      const result = await this.auth.signUpWithPassword(credentials.email, credentials.password);
      this.password = '';
      this.authMessage = result.emailConfirmationRequired
        ? 'Check your email to confirm the new account, then sign in.'
        : 'Account created and signed in.';
    } catch (error) {
      this.authMessage = this.toMessage(error);
    } finally {
      this.authBusy = false;
    }
  }

  async signOut(): Promise<void> {
    this.authBusy = true;
    this.authMessage = '';
    this.showPasswordPanel = false;

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

  private getEmailPasswordCredentials(): { email: string; password: string } | null {
    const email = this.email.trim();
    const password = this.password;

    if (!email) {
      this.authMessage = 'Email is required.';
      return null;
    }

    if (!password) {
      this.authMessage = 'Password is required.';
      return null;
    }

    return { email, password };
  }

  private resetPasswordFields(): void {
    this.nextPassword = '';
    this.confirmNextPassword = '';
  }
}
