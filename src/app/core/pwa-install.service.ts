import { Inject, Injectable, InjectionToken, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type PwaInstallPlatform = 'none' | 'chromium-prompt' | 'ios-safari';

export interface PwaInstallState {
  platform: PwaInstallPlatform;
  visible: boolean;
  expandedInstructions: boolean;
  canPrompt: boolean;
  isStandalone: boolean;
}

export const WINDOW = new InjectionToken<Window | null>('WindowToken', {
  providedIn: 'root',
  factory: () => (typeof window === 'undefined' ? null : window)
});

@Injectable({ providedIn: 'root' })
export class PwaInstallService implements OnDestroy {
  private readonly dismissalStorageKey = 'expense_manager.install_prompt.dismissed_at';
  private readonly installedStorageKey = 'expense_manager.install_prompt.installed';
  private readonly dismissalCooldownMs = 14 * 24 * 60 * 60 * 1000;
  private readonly stateSubject = new BehaviorSubject<PwaInstallState>(this.hiddenState());
  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  private readonly beforeInstallPromptHandler?: EventListener;
  private readonly appInstalledHandler?: EventListener;

  readonly state$ = this.stateSubject.asObservable();

  constructor(
    @Inject(WINDOW) private readonly windowRef: Window | null,
    private readonly zone: NgZone
  ) {
    if (!this.windowRef) {
      return;
    }

    this.beforeInstallPromptHandler = (event: Event) => {
      const promptEvent = event as BeforeInstallPromptEvent;
      promptEvent.preventDefault();
      this.zone.run(() => {
        this.deferredPrompt = promptEvent;
        this.publishState();
      });
    };

    this.appInstalledHandler = () => {
      this.zone.run(() => {
        this.setStorageValue(this.installedStorageKey, 'true');
        this.deferredPrompt = null;
        this.publishState();
      });
    };

    this.windowRef.addEventListener('beforeinstallprompt', this.beforeInstallPromptHandler);
    this.windowRef.addEventListener('appinstalled', this.appInstalledHandler);
    this.publishState();
  }

  ngOnDestroy(): void {
    if (!this.windowRef) {
      return;
    }

    if (this.beforeInstallPromptHandler) {
      this.windowRef.removeEventListener('beforeinstallprompt', this.beforeInstallPromptHandler);
    }

    if (this.appInstalledHandler) {
      this.windowRef.removeEventListener('appinstalled', this.appInstalledHandler);
    }
  }

  async promptInstall(): Promise<void> {
    if (!this.deferredPrompt) {
      return;
    }

    const promptEvent = this.deferredPrompt;
    this.deferredPrompt = null;
    this.publishState();

    try {
      await promptEvent.prompt();
      await promptEvent.userChoice;
    } catch {
      // The browser controls the install UI and can reject the prompt.
    } finally {
      this.publishState();
    }
  }

  dismiss(): void {
    this.setStorageValue(this.dismissalStorageKey, Date.now().toString());
    this.deferredPrompt = null;
    this.publishState();
  }

  toggleInstructions(): void {
    const currentState = this.stateSubject.value;
    if (!currentState.visible || currentState.platform !== 'ios-safari') {
      return;
    }

    this.stateSubject.next({
      ...currentState,
      expandedInstructions: !currentState.expandedInstructions
    });
  }

  private publishState(): void {
    this.stateSubject.next(this.computeState(this.stateSubject.value.expandedInstructions));
  }

  private computeState(expandedInstructions: boolean): PwaInstallState {
    const isStandalone = this.isStandalone();
    const isInstalled = this.getStorageValue(this.installedStorageKey) === 'true';
    const dismissedRecently = this.wasDismissedRecently();

    if (isStandalone || isInstalled || dismissedRecently) {
      return this.hiddenState(isStandalone);
    }

    if (this.isIosSafari()) {
      return {
        platform: 'ios-safari',
        visible: true,
        expandedInstructions,
        canPrompt: false,
        isStandalone
      };
    }

    if (this.canUseNativePrompt()) {
      return {
        platform: 'chromium-prompt',
        visible: true,
        expandedInstructions: false,
        canPrompt: true,
        isStandalone
      };
    }

    return this.hiddenState(isStandalone);
  }

  private hiddenState(isStandalone = false): PwaInstallState {
    return {
      platform: 'none',
      visible: false,
      expandedInstructions: false,
      canPrompt: false,
      isStandalone
    };
  }

  private canUseNativePrompt(): boolean {
    return Boolean(this.deferredPrompt && this.isNonIosMobile());
  }

  private isStandalone(): boolean {
    if (!this.windowRef) {
      return false;
    }

    const displayModeStandalone = this.windowRef.matchMedia('(display-mode: standalone)').matches;
    return displayModeStandalone || this.windowRef.navigator.standalone === true;
  }

  private isIosSafari(): boolean {
    return this.isIos() && this.isSafari();
  }

  private isIos(): boolean {
    if (!this.windowRef) {
      return false;
    }

    const userAgent = this.windowRef.navigator.userAgent ?? '';
    const isIphoneOrIpad = /iPad|iPhone|iPod/i.test(userAgent);
    const isTouchMac = /Macintosh/i.test(userAgent) && this.windowRef.navigator.maxTouchPoints > 1;

    return isIphoneOrIpad || isTouchMac;
  }

  private isSafari(): boolean {
    if (!this.windowRef) {
      return false;
    }

    const userAgent = this.windowRef.navigator.userAgent ?? '';
    return /Safari/i.test(userAgent)
      && !/CriOS|Chrome|FxiOS|Firefox|EdgiOS|Edg\/|OPRiOS|OPR\/|SamsungBrowser/i.test(userAgent);
  }

  private isNonIosMobile(): boolean {
    if (!this.windowRef) {
      return false;
    }

    if (this.isIos()) {
      return false;
    }

    const userAgent = this.windowRef.navigator.userAgent ?? '';
    return /Android|webOS|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(userAgent);
  }

  private wasDismissedRecently(): boolean {
    const rawValue = this.getStorageValue(this.dismissalStorageKey);
    if (!rawValue) {
      return false;
    }

    const dismissedAt = Number(rawValue);
    if (!Number.isFinite(dismissedAt)) {
      return false;
    }

    return Date.now() - dismissedAt < this.dismissalCooldownMs;
  }

  private getStorageValue(key: string): string | null {
    if (!this.windowRef) {
      return null;
    }

    try {
      return this.windowRef.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private setStorageValue(key: string, value: string): void {
    if (!this.windowRef) {
      return;
    }

    try {
      this.windowRef.localStorage.setItem(key, value);
    } catch {
      // Ignore storage write failures and fall back to the in-memory session state.
    }
  }
}
