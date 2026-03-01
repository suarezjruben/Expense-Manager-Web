import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { Session } from '@supabase/supabase-js';
import { AppComponent } from './app.component';
import { AuthService } from '../core/auth.service';
import { PwaInstallService, PwaInstallState } from '../core/pwa-install.service';
import { SupabaseService } from '../core/supabase.service';

class MockAuthService {
  private readonly sessionSubject = new BehaviorSubject<Session | null>(null);
  private readonly recoveryModeSubject = new BehaviorSubject<boolean>(false);

  readonly session$ = this.sessionSubject.asObservable();
  readonly recoveryMode$ = this.recoveryModeSubject.asObservable();

  signInWithOtpCalls: string[] = [];
  signInWithPasswordCalls: Array<{ email: string; password: string }> = [];
  signUpWithPasswordCalls: Array<{ email: string; password: string }> = [];
  resetPasswordForEmailCalls: string[] = [];
  updatePasswordCalls: string[] = [];

  async signInWithOtp(_email: string): Promise<void> {
    this.signInWithOtpCalls.push(_email);
    return Promise.resolve();
  }

  async signInWithPassword(email: string, password: string): Promise<void> {
    this.signInWithPasswordCalls.push({ email, password });
    return Promise.resolve();
  }

  async signUpWithPassword(email: string, password: string): Promise<{ emailConfirmationRequired: boolean }> {
    this.signUpWithPasswordCalls.push({ email, password });
    return Promise.resolve({ emailConfirmationRequired: true });
  }

  async resetPasswordForEmail(email: string): Promise<void> {
    this.resetPasswordForEmailCalls.push(email);
    return Promise.resolve();
  }

  async updatePassword(password: string): Promise<void> {
    this.updatePasswordCalls.push(password);
    return Promise.resolve();
  }

  async signOut(): Promise<void> {
    return Promise.resolve();
  }

  setSession(session: Session | null): void {
    this.sessionSubject.next(session);
  }

  setRecoveryMode(isRecoveryMode: boolean): void {
    this.recoveryModeSubject.next(isRecoveryMode);
  }
}

class MockSupabaseService {
  isConfigured = true;
}

class MockPwaInstallService {
  private readonly stateSubject = new BehaviorSubject<PwaInstallState>({
    platform: 'none',
    visible: false,
    expandedInstructions: false,
    canPrompt: false,
    isStandalone: false
  });

  readonly state$ = this.stateSubject.asObservable();

  promptInstall(): Promise<void> {
    return Promise.resolve();
  }

  dismiss(): void {}

  toggleInstructions(): void {}

  setState(state: PwaInstallState): void {
    this.stateSubject.next(state);
  }
}

describe('AppComponent', () => {
  let authService: MockAuthService;
  let supabaseService: MockSupabaseService;
  let pwaInstallService: MockPwaInstallService;

  beforeEach(async () => {
    authService = new MockAuthService();
    supabaseService = new MockSupabaseService();
    pwaInstallService = new MockPwaInstallService();

    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authService },
        { provide: SupabaseService, useValue: supabaseService },
        { provide: PwaInstallService, useValue: pwaInstallService }
      ]
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the sign-in state without the install banner', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Expense Manager');
    expect(compiled.textContent).toContain('Welcome back');
    expect(compiled.textContent).toContain('Sign in with your email and password');
    expect(compiled.textContent).toContain('Create Account');
    expect(compiled.textContent).not.toContain('Sign in with Supabase');
    expect(compiled.querySelector('app-pwa-install-banner')).toBeNull();
  });

  it('should sign in with email and password from the auth form', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const app = fixture.componentInstance;
    app.email = ' person@example.com ';
    app.password = 'secret-password';

    await app.signInWithPassword();

    expect(authService.signInWithPasswordCalls).toEqual([
      {
        email: 'person@example.com',
        password: 'secret-password'
      }
    ]);
  });

  it('should send a password reset email for the entered address', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const app = fixture.componentInstance;
    app.email = ' reset@example.com ';

    await app.sendPasswordReset();

    expect(authService.resetPasswordForEmailCalls).toEqual(['reset@example.com']);
  });

  it('should render the password recovery card while recovery mode is active', async () => {
    authService.setRecoveryMode(true);
    authService.setSession({
      user: { email: 'recover@example.com' }
    } as Session);

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Choose a new password');
    expect(compiled.textContent).not.toContain('Dashboard');
  });

  it('should open the signed-in password panel from the authenticated shell', async () => {
    authService.setSession({
      user: { email: 'member@example.com' }
    } as Session);

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const app = fixture.componentInstance;
    app.openPasswordPanel();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Set a password');
    expect(compiled.textContent).toContain('Save Password');
  });

  it('should update the password from the signed-in password panel', async () => {
    authService.setSession({
      user: { email: 'member@example.com' }
    } as Session);

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const app = fixture.componentInstance;
    app.openPasswordPanel();
    app.nextPassword = 'new-password';
    app.confirmNextPassword = 'new-password';

    await app.updatePassword();

    expect(authService.updatePasswordCalls).toEqual(['new-password']);
    expect(app.showPasswordPanel).toBeFalse();
    expect(app.authMessage).toBe('Password updated.');
  });

  it('should render the authenticated shell with the install banner', async () => {
    authService.setSession({
      user: { email: 'mobile@example.com' }
    } as Session);
    pwaInstallService.setState({
      platform: 'ios-safari',
      visible: true,
      expandedInstructions: false,
      canPrompt: false,
      isStandalone: false
    });

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('mobile@example.com');
    expect(compiled.querySelector('app-pwa-install-banner')).not.toBeNull();
  });
});
