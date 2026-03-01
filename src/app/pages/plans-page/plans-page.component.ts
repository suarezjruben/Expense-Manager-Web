import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize, forkJoin } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CategoryDto, CategoryType, PlanItemDto } from '../../core/api.models';
import { MonthStateService } from '../../core/month-state.service';

type MobileSectionTab = 'EXPENSE_PLANS' | 'INCOME_PLANS' | 'EXPENSE_CATEGORIES' | 'INCOME_CATEGORIES';

interface CategorySnapshot {
  name: string;
  sortOrder: number;
  active: boolean;
}

@Component({
  selector: 'app-plans-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './plans-page.component.html',
  styleUrl: './plans-page.component.scss'
})
export class PlansPageComponent implements OnInit {
  activeMobileSectionTab: MobileSectionTab = 'EXPENSE_PLANS';

  month: string;
  loading = false;
  error = '';

  expensePlans: PlanItemDto[] = [];
  incomePlans: PlanItemDto[] = [];
  expenseCategories: CategoryDto[] = [];
  incomeCategories: CategoryDto[] = [];

  newExpenseCategory = '';
  newIncomeCategory = '';

  private originalExpensePlanAmounts: Record<number, number> = {};
  private originalIncomePlanAmounts: Record<number, number> = {};
  private originalExpenseCategoriesById: Record<number, CategorySnapshot> = {};
  private originalIncomeCategoriesById: Record<number, CategorySnapshot> = {};

  private readonly savingPlanTypes = new Set<CategoryType>();
  private readonly deletingPlanTypes = new Set<CategoryType>();
  private readonly savingCategoryIds = new Set<number>();
  private readonly deletingCategoryIds = new Set<number>();
  private readonly savingCategoryTypes = new Set<CategoryType>();
  private readonly deletingCategoryTypes = new Set<CategoryType>();

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
        this.resetPlanState('EXPENSE', data.expensePlans);
        this.resetPlanState('INCOME', data.incomePlans);
        this.resetCategoryState('EXPENSE', data.expenseCategories);
        this.resetCategoryState('INCOME', data.incomeCategories);
        this.loading = false;
      },
      error: (error) => {
        this.error = this.toMessage(error);
        this.loading = false;
      }
    });
  }

  savePlans(type: CategoryType): void {
    if (!this.hasPendingPlanChanges(type) || this.hasInvalidPlanChanges(type) || this.isSavingPlanType(type) || this.isDeletingPlanType(type)) {
      return;
    }

    const source = this.getPlanSource(type);
    const request = source
      .filter((row) => this.hasPlanChanged(type, row))
      .map((row) => ({
        categoryId: row.categoryId,
        plannedAmount: this.normalizePlannedAmount(row.plannedAmount)
      }));

    this.error = '';
    this.savingPlanTypes.add(type);
    this.api.upsertPlans(this.month, type, request)
      .pipe(finalize(() => this.savingPlanTypes.delete(type)))
      .subscribe({
        next: (items) => this.applyServerPlanState(type, items),
        error: (error) => (this.error = this.toMessage(error))
      });
  }

  deleteAllPlans(type: CategoryType): void {
    if (!this.hasPlansToDelete(type) || this.isSavingPlanType(type) || this.isDeletingPlanType(type)) {
      return;
    }

    const typeLabel = type === 'EXPENSE' ? 'expense' : 'income';
    const confirmed = window.confirm(`Clear all ${typeLabel} plans for ${this.month}? This will set every planned amount back to zero.`);
    if (!confirmed) {
      return;
    }

    this.error = '';
    this.deletingPlanTypes.add(type);
    this.api.deletePlans(this.month, type)
      .pipe(finalize(() => this.deletingPlanTypes.delete(type)))
      .subscribe({
        next: (items) => this.applyServerPlanState(type, items),
        error: (error) => (this.error = this.toMessage(error))
      });
  }

  addCategory(type: CategoryType): void {
    this.activeMobileSectionTab = type === 'EXPENSE' ? 'EXPENSE_CATEGORIES' : 'INCOME_CATEGORIES';

    const name = (type === 'EXPENSE' ? this.newExpenseCategory : this.newIncomeCategory).trim();
    if (!name) {
      this.error = 'Category name is required';
      return;
    }

    const target = this.getCategorySource(type);
    const sortOrder = target.length + 1;

    this.error = '';
    this.api.createCategory({
      name,
      type,
      sortOrder,
      active: true
    }).subscribe({
      next: (category) => {
        if (type === 'EXPENSE') {
          this.newExpenseCategory = '';
        } else {
          this.newIncomeCategory = '';
        }

        this.addCategoryToState(category);
      },
      error: (error) => (this.error = this.toMessage(error))
    });
  }

  saveCategory(category: CategoryDto): void {
    if (!this.hasCategoryChanged(category) || !this.isCategoryValid(category) || this.isSavingCategoryType(category.type) || this.isDeletingCategoryType(category.type)) {
      return;
    }

    this.error = '';
    this.savingCategoryIds.add(category.id);
    this.api.updateCategory(category.id, {
      name: this.normalizeCategoryName(category.name),
      sortOrder: this.normalizeSortOrder(category.sortOrder),
      active: category.active
    }).pipe(finalize(() => this.savingCategoryIds.delete(category.id)))
      .subscribe({
        next: (updated) => this.applySavedCategory(updated),
        error: (error) => (this.error = this.toMessage(error))
      });
  }

  saveAllCategories(type: CategoryType): void {
    if (!this.hasPendingCategoryChanges(type) || this.hasInvalidCategoryChanges(type) || this.isSavingCategoryType(type) || this.isDeletingCategoryType(type)) {
      return;
    }

    const changed = this.getCategorySource(type).filter((category) => this.hasCategoryChanged(category));
    this.error = '';
    this.savingCategoryTypes.add(type);

    forkJoin(
      changed.map((category) =>
        this.api.updateCategory(category.id, {
          name: this.normalizeCategoryName(category.name),
          sortOrder: this.normalizeSortOrder(category.sortOrder),
          active: category.active
        })
      )
    ).pipe(finalize(() => this.savingCategoryTypes.delete(type)))
      .subscribe({
        next: (updatedCategories) => {
          updatedCategories.forEach((updatedCategory) => this.applySavedCategory(updatedCategory));
        },
        error: (error) => (this.error = this.toMessage(error))
      });
  }

  deleteCategory(category: CategoryDto): void {
    if (this.isSavingCategoryType(category.type) || this.isDeletingCategoryType(category.type)) {
      return;
    }

    this.error = '';
    this.deletingCategoryIds.add(category.id);
    this.api.deleteCategory(category.id)
      .pipe(finalize(() => this.deletingCategoryIds.delete(category.id)))
      .subscribe({
        next: () => this.removeCategoryFromState(category.type, category.id),
        error: (error) => (this.error = this.toMessage(error))
      });
  }

  deleteAllCategories(type: CategoryType): void {
    if (!this.hasCategories(type) || this.isSavingCategoryType(type) || this.isDeletingCategoryType(type)) {
      return;
    }

    const typeLabel = type === 'EXPENSE' ? 'expense' : 'income';
    const confirmed = window.confirm(`Delete all ${typeLabel} categories? Categories referenced by plans or transactions cannot be deleted.`);
    if (!confirmed) {
      return;
    }

    this.error = '';
    this.deletingCategoryTypes.add(type);
    this.api.deleteCategoriesByType(type)
      .pipe(finalize(() => this.deletingCategoryTypes.delete(type)))
      .subscribe({
        next: () => this.clearCategoryTypeState(type),
        error: (error) => (this.error = this.toMessage(error))
      });
  }

  savePlansAndStayOnTab(type: CategoryType): void {
    this.activeMobileSectionTab = type === 'EXPENSE' ? 'EXPENSE_PLANS' : 'INCOME_PLANS';
    this.savePlans(type);
  }

  setActiveMobileSectionTab(tab: MobileSectionTab): void {
    this.activeMobileSectionTab = tab;
  }

  hasPlanChanged(type: CategoryType, row: PlanItemDto): boolean {
    return this.normalizePlannedAmount(row.plannedAmount) !== this.getOriginalPlanAmounts(type)[row.categoryId];
  }

  hasPendingPlanChanges(type: CategoryType): boolean {
    return this.getPlanSource(type).some((row) => this.hasPlanChanged(type, row));
  }

  hasPlansToDelete(type: CategoryType): boolean {
    return this.getPlanSource(type).some((row) => this.normalizePlannedAmount(row.plannedAmount) !== 0);
  }

  hasCategoryChanged(category: CategoryDto): boolean {
    const original = this.getOriginalCategoryStates(category.type)[category.id];
    if (!original) {
      return false;
    }

    return (
      this.normalizeCategoryName(category.name) !== original.name ||
      this.normalizeSortOrder(category.sortOrder) !== original.sortOrder ||
      category.active !== original.active
    );
  }

  hasPendingCategoryChanges(type: CategoryType): boolean {
    return this.getCategorySource(type).some((category) => this.hasCategoryChanged(category));
  }

  hasCategories(type: CategoryType): boolean {
    return this.getCategorySource(type).length > 0;
  }

  isSavingPlanType(type: CategoryType): boolean {
    return this.savingPlanTypes.has(type);
  }

  isDeletingPlanType(type: CategoryType): boolean {
    return this.deletingPlanTypes.has(type);
  }

  isSavingCategory(category: CategoryDto): boolean {
    return this.savingCategoryIds.has(category.id);
  }

  isDeletingCategory(category: CategoryDto): boolean {
    return this.deletingCategoryIds.has(category.id);
  }

  isSavingCategoryType(type: CategoryType): boolean {
    return this.savingCategoryTypes.has(type) || this.getCategorySource(type).some((category) => this.savingCategoryIds.has(category.id));
  }

  isDeletingCategoryType(type: CategoryType): boolean {
    return this.deletingCategoryTypes.has(type) || this.getCategorySource(type).some((category) => this.deletingCategoryIds.has(category.id));
  }

  hasInvalidPlanChanges(type: CategoryType): boolean {
    return this.getPlanSource(type).some((row) => this.hasPlanChanged(type, row) && !this.isPlanValid(row));
  }

  hasInvalidCategoryChanges(type: CategoryType): boolean {
    return this.getCategorySource(type).some((category) => this.hasCategoryChanged(category) && !this.isCategoryValid(category));
  }

  private isPlanValid(row: PlanItemDto): boolean {
    const amount = Number(row.plannedAmount);
    return Number.isFinite(amount) && amount >= 0;
  }

  private isCategoryValid(category: CategoryDto): boolean {
    return this.normalizeCategoryName(category.name).length > 0;
  }

  private resetPlanState(type: CategoryType, items: PlanItemDto[]): void {
    const sorted = this.sortPlanItems(items);

    if (type === 'EXPENSE') {
      this.expensePlans = sorted;
      this.originalExpensePlanAmounts = Object.fromEntries(
        sorted.map((row) => [row.categoryId, this.normalizePlannedAmount(row.plannedAmount)])
      );
      return;
    }

    this.incomePlans = sorted;
    this.originalIncomePlanAmounts = Object.fromEntries(
      sorted.map((row) => [row.categoryId, this.normalizePlannedAmount(row.plannedAmount)])
    );
  }

  private resetCategoryState(type: CategoryType, categories: CategoryDto[]): void {
    const sorted = this.sortCategories(categories);

    if (type === 'EXPENSE') {
      this.expenseCategories = sorted;
      this.originalExpenseCategoriesById = Object.fromEntries(
        sorted.map((category) => [category.id, this.toCategorySnapshot(category)])
      );
      return;
    }

    this.incomeCategories = sorted;
    this.originalIncomeCategoriesById = Object.fromEntries(
      sorted.map((category) => [category.id, this.toCategorySnapshot(category)])
    );
  }

  private applyServerPlanState(type: CategoryType, items: PlanItemDto[]): void {
    const categoryOverrides = new Map(
      this.getCategorySource(type).map((category) => [
        category.id,
        {
          categoryName: category.name,
          sortOrder: this.normalizeSortOrder(category.sortOrder)
        }
      ])
    );

    const nextItems = items.map((row) => {
      const override = categoryOverrides.get(row.categoryId);
      return {
        ...row,
        categoryName: override?.categoryName ?? row.categoryName,
        sortOrder: override?.sortOrder ?? row.sortOrder
      };
    });

    this.resetPlanState(type, nextItems);
  }

  private addCategoryToState(category: CategoryDto): void {
    const type = category.type;
    const nextCategories = this.sortCategories([...this.getCategorySource(type), category]);
    this.setCurrentCategorySource(type, nextCategories);
    this.getOriginalCategoryStates(type)[category.id] = this.toCategorySnapshot(category);

    const nextPlans = this.sortPlanItems([
      ...this.getPlanSource(type),
      {
        categoryId: category.id,
        categoryName: category.name,
        categoryType: category.type,
        sortOrder: category.sortOrder,
        plannedAmount: 0
      }
    ]);
    this.setCurrentPlanSource(type, nextPlans);
    this.getOriginalPlanAmounts(type)[category.id] = 0;
  }

  private applySavedCategory(category: CategoryDto): void {
    const type = category.type;
    const nextCategories = this.getCategorySource(type).map((item) => (item.id === category.id ? category : item));
    this.setCurrentCategorySource(type, this.sortCategories(nextCategories));
    this.getOriginalCategoryStates(type)[category.id] = this.toCategorySnapshot(category);

    const nextPlans = this.getPlanSource(type).map((row) =>
      row.categoryId === category.id
        ? {
            ...row,
            categoryName: category.name,
            sortOrder: category.sortOrder
          }
        : row
    );
    this.setCurrentPlanSource(type, this.sortPlanItems(nextPlans));
  }

  private removeCategoryFromState(type: CategoryType, categoryId: number): void {
    const nextCategories = this.getCategorySource(type).filter((category) => category.id !== categoryId);
    const nextPlans = this.getPlanSource(type).filter((row) => row.categoryId !== categoryId);

    this.setCurrentCategorySource(type, nextCategories);
    delete this.getOriginalCategoryStates(type)[categoryId];

    this.setCurrentPlanSource(type, nextPlans);
    delete this.getOriginalPlanAmounts(type)[categoryId];
  }

  private clearCategoryTypeState(type: CategoryType): void {
    this.resetCategoryState(type, []);
    this.resetPlanState(type, []);
  }

  private getPlanSource(type: CategoryType): PlanItemDto[] {
    return type === 'EXPENSE' ? this.expensePlans : this.incomePlans;
  }

  private setCurrentPlanSource(type: CategoryType, items: PlanItemDto[]): void {
    if (type === 'EXPENSE') {
      this.expensePlans = items;
      return;
    }

    this.incomePlans = items;
  }

  private getCategorySource(type: CategoryType): CategoryDto[] {
    return type === 'EXPENSE' ? this.expenseCategories : this.incomeCategories;
  }

  private setCurrentCategorySource(type: CategoryType, categories: CategoryDto[]): void {
    if (type === 'EXPENSE') {
      this.expenseCategories = categories;
      return;
    }

    this.incomeCategories = categories;
  }

  private getOriginalPlanAmounts(type: CategoryType): Record<number, number> {
    return type === 'EXPENSE' ? this.originalExpensePlanAmounts : this.originalIncomePlanAmounts;
  }

  private getOriginalCategoryStates(type: CategoryType): Record<number, CategorySnapshot> {
    return type === 'EXPENSE' ? this.originalExpenseCategoriesById : this.originalIncomeCategoriesById;
  }

  private sortPlanItems(items: PlanItemDto[]): PlanItemDto[] {
    return [...items].sort(
      (left, right) => left.sortOrder - right.sortOrder || left.categoryName.localeCompare(right.categoryName)
    );
  }

  private sortCategories(categories: CategoryDto[]): CategoryDto[] {
    return [...categories].sort(
      (left, right) => this.normalizeSortOrder(left.sortOrder) - this.normalizeSortOrder(right.sortOrder) || left.name.localeCompare(right.name)
    );
  }

  private toCategorySnapshot(category: CategoryDto): CategorySnapshot {
    return {
      name: this.normalizeCategoryName(category.name),
      sortOrder: this.normalizeSortOrder(category.sortOrder),
      active: category.active
    };
  }

  private normalizeCategoryName(value: string): string {
    return value.trim();
  }

  private normalizeSortOrder(value: number): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private normalizePlannedAmount(value: number): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private toMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    const payload = (error as { error?: { message?: string } }).error;
    return payload?.message ?? 'Request failed';
  }
}
