import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { Session } from '@supabase/supabase-js';
import { AppComponent } from './app.component';
import { AuthService } from './core/auth.service';
import { PwaInstallService, PwaInstallState } from './core/pwa-install.service';
import { SupabaseService } from './core/supabase.service';

class MockAuthService {
  private readonly sessionSubject = new BehaviorSubject<Session | null>(null);

  readonly session$ = this.sessionSubject.asObservable();

  async signInWithOtp(_email: string): Promise<void> {
    return Promise.resolve();
  }

  async signOut(): Promise<void> {
    return Promise.resolve();
  }

  setSession(session: Session | null): void {
    this.sessionSubject.next(session);
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
    expect(compiled.textContent).toContain('Sign in with Supabase');
    expect(compiled.querySelector('app-pwa-install-banner')).toBeNull();
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
