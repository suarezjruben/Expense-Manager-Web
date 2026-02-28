import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiService } from '../core/api.service';
import { MonthSummaryDto } from '../core/api.models';
import { MonthStateService } from '../core/month-state.service';

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard-page.component.html',
  styleUrl: './dashboard-page.component.scss'
})
export class DashboardPageComponent implements OnInit {
  month: string;
  loading = false;
  error = '';
  summary: MonthSummaryDto | null = null;
  startingBalance = 0;

  constructor(
    private readonly api: ApiService,
    private readonly monthState: MonthStateService
  ) {
    this.month = this.monthState.month;
  }

  ngOnInit(): void {
    this.load();
  }

  onMonthChanged(): void {
    this.monthState.setMonth(this.month);
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = '';
    forkJoin({
      summary: this.api.getSummary(this.month),
      settings: this.api.getMonthSettings(this.month)
    }).subscribe({
      next: ({ summary, settings }) => {
        this.summary = summary;
        this.startingBalance = settings.startingBalance;
        this.loading = false;
      },
      error: (error) => {
        this.error = this.toMessage(error);
        this.loading = false;
      }
    });
  }

  saveStartingBalance(): void {
    this.api.updateMonthSettings(this.month, this.startingBalance).subscribe({
      next: () => this.load(),
      error: (error) => (this.error = this.toMessage(error))
    });
  }

  private toMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    const payload = (error as { error?: { message?: string } }).error;
    return payload?.message ?? 'Request failed';
  }
}
