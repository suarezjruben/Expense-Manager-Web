import { TestBed } from '@angular/core/testing';
import { PwaInstallService, PwaInstallState, WINDOW } from './pwa-install.service';

interface MockNavigator {
  userAgent: string;
  maxTouchPoints: number;
  standalone: boolean;
}

class MockStorage implements Storage {
  private readonly store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

class MockWindow {
  readonly localStorage = new MockStorage();
  readonly navigator: MockNavigator = {
    userAgent: '',
    maxTouchPoints: 0,
    standalone: false
  };

  private readonly eventTarget = new EventTarget();
  private standaloneDisplayMode = false;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (listener) {
      this.eventTarget.addEventListener(type, listener);
    }
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (listener) {
      this.eventTarget.removeEventListener(type, listener);
    }
  }

  dispatchEvent(event: Event): boolean {
    return this.eventTarget.dispatchEvent(event);
  }

  matchMedia(query: string): MediaQueryList {
    return {
      matches: query === '(display-mode: standalone)' ? this.standaloneDisplayMode : false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true
    } as MediaQueryList;
  }

  setStandaloneDisplayMode(enabled: boolean): void {
    this.standaloneDisplayMode = enabled;
  }
}

class MockBeforeInstallPromptEvent extends Event implements BeforeInstallPromptEvent {
  readonly platforms = ['web'];
  readonly prompt = jasmine.createSpy('prompt').and.resolveTo(undefined);
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;

  constructor(outcome: 'accepted' | 'dismissed' = 'accepted') {
    super('beforeinstallprompt');
    this.userChoice = Promise.resolve({ outcome, platform: 'web' });
  }
}

describe('PwaInstallService', () => {
  let mockWindow: MockWindow;
  let service: PwaInstallService;

  function configureService(): void {
    TestBed.configureTestingModule({
      providers: [
        PwaInstallService,
        { provide: WINDOW, useValue: mockWindow as unknown as Window }
      ]
    });

    service = TestBed.inject(PwaInstallService);
  }

  function readState(): PwaInstallState {
    let snapshot!: PwaInstallState;
    service.state$.subscribe((state) => (snapshot = state)).unsubscribe();
    return snapshot;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    mockWindow = new MockWindow();
  });

  afterEach(() => {
    service?.ngOnDestroy();
    TestBed.resetTestingModule();
  });

  it('returns a hidden state on desktop browsers', () => {
    mockWindow.navigator.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36';

    configureService();

    expect(readState()).toEqual({
      platform: 'none',
      visible: false,
      expandedInstructions: false,
      canPrompt: false,
      isStandalone: false
    });
  });

  it('shows a native install prompt state for supported mobile browsers', () => {
    mockWindow.navigator.userAgent = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/123.0.0.0 Mobile Safari/537.36';

    configureService();
    mockWindow.dispatchEvent(new MockBeforeInstallPromptEvent());

    expect(readState()).toEqual({
      platform: 'chromium-prompt',
      visible: true,
      expandedInstructions: false,
      canPrompt: true,
      isStandalone: false
    });
  });

  it('shows manual instructions on iOS Safari', () => {
    mockWindow.navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

    configureService();

    expect(readState()).toEqual({
      platform: 'ios-safari',
      visible: true,
      expandedInstructions: false,
      canPrompt: false,
      isStandalone: false
    });
  });

  it('hides the prompt when already running in standalone mode', () => {
    mockWindow.navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
    mockWindow.navigator.standalone = true;

    configureService();

    expect(readState()).toEqual({
      platform: 'none',
      visible: false,
      expandedInstructions: false,
      canPrompt: false,
      isStandalone: true
    });
  });

  it('suppresses the prompt for 14 days after dismissal', () => {
    mockWindow.navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
    mockWindow.localStorage.setItem('expense_manager.install_prompt.dismissed_at', Date.now().toString());

    configureService();

    expect(readState().visible).toBeFalse();
  });

  it('hides the prompt and clears the deferred install event after appinstalled', async () => {
    mockWindow.navigator.userAgent = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/123.0.0.0 Mobile Safari/537.36';

    configureService();
    const promptEvent = new MockBeforeInstallPromptEvent();
    mockWindow.dispatchEvent(promptEvent);

    expect(readState().visible).toBeTrue();

    mockWindow.dispatchEvent(new Event('appinstalled'));

    expect(readState().visible).toBeFalse();
    await service.promptInstall();
    expect(promptEvent.prompt).not.toHaveBeenCalled();
    expect(mockWindow.localStorage.getItem('expense_manager.install_prompt.installed')).toBe('true');
  });
});
