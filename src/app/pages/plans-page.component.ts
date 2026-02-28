import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiService } from '../core/api.service';
import { CategoryDto, CategoryType, PlanItemDto } from '../core/api.models';
import { MonthStateService } from '../core/month-state.service';

@Component({
  selector: 'app-plans-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './plans-page.component.html',
  styleUrl: './plans-page.component.scss'
})
export class PlansPageComponent implements OnInit {
  month: string;
  loading = false;
  error = '';

  expensePlans: PlanItemDto[] = [];
  incomePlans: PlanItemDto[] = [];
  expenseCategories: CategoryDto[] = [];
  incomeCategories: CategoryDto[] = [];

  newExpenseCategory = '';
  newIncomeCategory = '';

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
      expensePlans: this.api.listPlans(this.month, 'EXPENSE'),
      incomePlans: this.api.listPlans(this.month, 'INCOME'),
      expenseCategories: this.api.listCategories('EXPENSE'),
      incomeCategories: this.api.listCategories('INCOME')
    }).subscribe({
      next: (data) => {
        this.expensePlans = data.expensePlans;
        this.incomePlans = data.incomePlans;
        this.expenseCategories = data.expenseCategories;
        this.incomeCategories = data.incomeCategories;
        this.loading = false;
      },
      error: (error) => {
        this.error = this.toMessage(error);
        this.loading = false;
      }
    });
  }

  savePlans(type: CategoryType): void {
    const source = type === 'EXPENSE' ? this.expensePlans : this.incomePlans;
    const request = source.map((row) => ({
      categoryId: row.categoryId,
      plannedAmount: Number(row.plannedAmount ?? 0)
    }));

    this.api.upsertPlans(this.month, type, request).subscribe({
      next: (items) => {
        if (type === 'EXPENSE') {
          this.expensePlans = items;
        } else {
          this.incomePlans = items;
        }
      },
      error: (error) => (this.error = this.toMessage(error))
    });
  }

  addCategory(type: CategoryType): void {
    const name = (type === 'EXPENSE' ? this.newExpenseCategory : this.newIncomeCategory).trim();
    if (!name) {
      this.error = 'Category name is required';
      return;
    }

    const target = type === 'EXPENSE' ? this.expenseCategories : this.incomeCategories;
    const sortOrder = target.length + 1;

    this.api
      .createCategory({
        name,
        type,
        sortOrder,
        active: true
      })
      .subscribe({
        next: () => {
          this.newExpenseCategory = '';
          this.newIncomeCategory = '';
          this.load();
        },
        error: (error) => (this.error = this.toMessage(error))
      });
  }

  saveCategory(category: CategoryDto): void {
    this.api
      .updateCategory(category.id, {
        name: category.name,
        sortOrder: Number(category.sortOrder),
        active: category.active
      })
      .subscribe({
        next: () => this.load(),
        error: (error) => (this.error = this.toMessage(error))
      });
  }

  deleteCategory(category: CategoryDto): void {
    this.api.deleteCategory(category.id).subscribe({
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
