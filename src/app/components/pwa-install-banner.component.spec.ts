import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { PwaInstallBannerComponent } from './pwa-install-banner.component';
import { PwaInstallService, PwaInstallState } from '../core/pwa-install.service';

class MockPwaInstallService {
  private readonly stateSubject = new BehaviorSubject<PwaInstallState>({
    platform: 'none',
    visible: false,
    expandedInstructions: false,
    canPrompt: false,
    isStandalone: false
  });

  readonly state$ = this.stateSubject.asObservable();
  readonly promptInstall = jasmine.createSpy('promptInstall').and.resolveTo();
  readonly dismiss = jasmine.createSpy('dismiss');
  readonly toggleInstructions = jasmine.createSpy('toggleInstructions');

  setState(state: PwaInstallState): void {
    this.stateSubject.next(state);
  }
}

describe('PwaInstallBannerComponent', () => {
  let fixture: ComponentFixture<PwaInstallBannerComponent>;
  let service: MockPwaInstallService;

  beforeEach(async () => {
    service = new MockPwaInstallService();

    await TestBed.configureTestingModule({
      imports: [PwaInstallBannerComponent],
      providers: [{ provide: PwaInstallService, useValue: service }]
    }).compileComponents();

    fixture = TestBed.createComponent(PwaInstallBannerComponent);
  });

  it('renders the native install CTA when the browser supports it', () => {
    service.setState({
      platform: 'chromium-prompt',
      visible: true,
      expandedInstructions: false,
      canPrompt: true,
      isStandalone: false
    });

    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Install app');
    expect(compiled.textContent).toContain('Not now');
  });

  it('invokes the install prompt and dismissal actions for chromium browsers', () => {
    service.setState({
      platform: 'chromium-prompt',
      visible: true,
      expandedInstructions: false,
      canPrompt: true,
      isStandalone: false
    });

    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
    buttons[0].click();
    buttons[1].click();

    expect(service.promptInstall).toHaveBeenCalled();
    expect(service.dismiss).toHaveBeenCalled();
  });

  it('expands the iOS install flow inline instead of prompting natively', () => {
    service.setState({
      platform: 'ios-safari',
      visible: true,
      expandedInstructions: true,
      canPrompt: false,
      isStandalone: false
    });

    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
    buttons[0].click();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(service.toggleInstructions).toHaveBeenCalled();
    expect(service.promptInstall).not.toHaveBeenCalled();
    expect(compiled.textContent).toContain('Add to Home Screen');
  });
});
