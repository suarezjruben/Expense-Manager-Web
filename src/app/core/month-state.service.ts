import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class MonthStateService {
  private readonly storageKey = 'expense_manager.selected_month';
  private readonly monthSubject = new BehaviorSubject<string>(this.loadInitialMonth());

  readonly month$ = this.monthSubject.asObservable();

  get month(): string {
    return this.monthSubject.value;
  }

  setMonth(month: string): void {
    if (!this.isValidMonth(month)) {
      return;
    }
    if (month === this.monthSubject.value) {
      return;
    }
    this.monthSubject.next(month);
    localStorage.setItem(this.storageKey, month);
  }

  private loadInitialMonth(): string {
    const storedMonth = localStorage.getItem(this.storageKey);
    if (storedMonth && this.isValidMonth(storedMonth)) {
      return storedMonth;
    }
    return this.currentMonth();
  }

  private currentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  private isValidMonth(month: string): boolean {
    const match = /^(\d{4})-(\d{2})$/.exec(month);
    if (!match) {
      return false;
    }
    const monthNumber = Number(match[2]);
    return monthNumber >= 1 && monthNumber <= 12;
  }
}
