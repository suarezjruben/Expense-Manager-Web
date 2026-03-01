import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { PwaInstallService } from '../core/pwa-install.service';

@Component({
  selector: 'app-pwa-install-banner',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pwa-install-banner.component.html',
  styleUrl: './pwa-install-banner.component.scss'
})
export class PwaInstallBannerComponent {
  private readonly pwaInstall = inject(PwaInstallService);
  readonly state$ = this.pwaInstall.state$;

  install(): void {
    void this.pwaInstall.promptInstall();
  }

  dismiss(): void {
    this.pwaInstall.dismiss();
  }

  toggleInstructions(): void {
    this.pwaInstall.toggleInstructions();
  }
}
