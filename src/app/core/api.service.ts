import { Injectable } from '@angular/core';
import { defer, from } from 'rxjs';
import {
  AccountDto,
  CategoryDto,
  CategoryType,
  CsvHeaderMappingInput,
  CreateAccountRequest,
  CreateCategoryRequest,
  MonthSettingsDto,
  MonthSummaryDto,
  PlanItemDto,
  PlanItemRequest,
  StatementImportResponseDto,
  TransactionDto,
  TransactionRequest,
  TransactionType,
  UpdateCategoryRequest
} from './api.models';
import { CsvImportService } from './csv-import.service';
import { SupabaseService } from './supabase.service';
import { AccountRow, CategoryRow, MonthSettingsRow, PlanRow, TransactionRow } from './supabase.models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private static readonly DEFAULT_ACCOUNT_NAME = 'Primary';

  constructor(
    private readonly supabase: SupabaseService,
    private readonly csvImport: CsvImportService
  ) {}

  getSummary(month: string) {
    return defer(() => from(this.getSummaryAsync(month)));
  }

  getMonthSettings(month: string) {
    return defer(() => from(this.getMonthSettingsAsync(month)));
  }

  updateMonthSettings(month: string, startingBalance: number) {
    return defer(() => from(this.updateMonthSettingsAsync(month, startingBalance)));
  }

  listAccounts(includeInactive = false) {
    return defer(() => from(this.listAccountsAsync(includeInactive)));
  }

  createAccount(request: CreateAccountRequest) {
    return defer(() => from(this.createAccountAsync(request)));
  }

  listCategories(type?: CategoryType) {
    return defer(() => from(this.listCategoriesAsync(type)));
  }

  createCategory(request: CreateCategoryRequest) {
    return defer(() => from(this.createCategoryAsync(request)));
  }

  updateCategory(id: number, request: UpdateCategoryRequest) {
    return defer(() => from(this.updateCategoryAsync(id, request)));
  }

  deleteCategory(id: number) {
    return defer(() => from(this.deleteCategoryAsync(id)));
  }

  listPlans(month: string, type: CategoryType) {
    return defer(() => from(this.listPlansAsync(month, type)));
  }

  upsertPlans(month: string, type: CategoryType, request: PlanItemRequest[]) {
    return defer(() => from(this.upsertPlansAsync(month, type, request)));
  }

  listTransactions(month: string, type: TransactionType, accountId?: number) {
    return defer(() => from(this.listTransactionsAsync(month, type, accountId)));
  }

  createTransaction(month: string, type: TransactionType, request: TransactionRequest, accountId?: number) {
    return defer(() => from(this.createTransactionAsync(month, type, request, accountId)));
  }

  updateTransaction(month: string, type: TransactionType, id: number, request: TransactionRequest, accountId?: number) {
    return defer(() => from(this.updateTransactionAsync(month, type, id, request, accountId)));
  }

  deleteTransaction(month: string, type: TransactionType, id: number, accountId?: number) {
    return defer(() => from(this.deleteTransactionAsync(month, type, id, accountId)));
  }

  importStatement(accountId: number, file: File, mapping?: CsvHeaderMappingInput) {
    return this.csvImport.importStatement(accountId, file, mapping);
  }

  private async getSummaryAsync(month: string): Promise<MonthSummaryDto> {
    this.validateMonth(month);
    const userId = await this.supabase.getRequiredUserId();

    const [settings, categories, planRows, transactionRows] = await Promise.all([
      this.getMonthSettingsForUser(userId, month),
      this.listCategoriesForUser(userId),
      this.listPlanRowsForUser(userId, month),
      this.listTransactionRowsForMonth(userId, month)
    ]);

    const categoryById = new Map(categories.map((category) => [category.id, category]));
    const expenseCategories = this.buildSummaryRows('EXPENSE', categories, categoryById, planRows, transactionRows);
    const incomeCategories = this.buildSummaryRows('INCOME', categories, categoryById, planRows, transactionRows);
    const expenseTotals = this.buildTotals(expenseCategories);
    const incomeTotals = this.buildTotals(incomeCategories);
    const netChange = this.roundCurrency(incomeTotals.actual - expenseTotals.actual);

    return {
      month,
      startingBalance: settings.startingBalance,
      netChange,
      endingBalance: this.roundCurrency(settings.startingBalance + netChange),
      savingsLabel: netChange < 0 ? 'Spent this month' : 'Saved this month',
      expenseTotals,
      incomeTotals,
      expenseCategories,
      incomeCategories
    };
  }

  private async getMonthSettingsAsync(month: string): Promise<MonthSettingsDto> {
    this.validateMonth(month);
    const userId = await this.supabase.getRequiredUserId();
    return this.getMonthSettingsForUser(userId, month);
  }

  private async updateMonthSettingsAsync(month: string, startingBalance: number): Promise<MonthSettingsDto> {
    this.validateMonth(month);
    const userId = await this.supabase.getRequiredUserId();
    const rounded = this.roundCurrency(startingBalance);

    const { error } = await this.supabase.client.from('month_settings').upsert(
      {
        user_id: userId,
        month_key: month,
        starting_balance: rounded
      },
      { onConflict: 'user_id,month_key' }
    );
    this.throwIfError(error);

    return { month, startingBalance: rounded };
  }

  private async listAccountsAsync(includeInactive: boolean): Promise<AccountDto[]> {
    const userId = await this.supabase.getRequiredUserId();
    await this.ensureDefaultAccount(userId);

    let query = this.supabase.client
      .from('accounts')
      .select('id, user_id, name, institution_name, last4, active')
      .eq('user_id', userId)
      .order('name', { ascending: true });

    if (!includeInactive) {
      query = query.eq('active', true);
    }

    const { data, error } = await query;
    this.throwIfError(error);

    return ((data as AccountRow[] | null) ?? []).map((row) => this.toAccountDto(row));
  }

  private async createAccountAsync(request: CreateAccountRequest): Promise<AccountDto> {
    const userId = await this.supabase.getRequiredUserId();
    const name = request.name.trim();
    if (!name) {
      throw new Error('Account name is required');
    }

    const accounts = await this.listAccountRows(userId);
    if (accounts.some((account) => account.name.trim().toLowerCase() === name.toLowerCase())) {
      throw new Error(`Account already exists: ${name}`);
    }

    const { data, error } = await this.supabase.client
      .from('accounts')
      .insert({
        user_id: userId,
        name,
        institution_name: this.normalizeOptional(request.institutionName),
        last4: this.normalizeOptional(request.last4),
        active: true
      })
      .select('id, user_id, name, institution_name, last4, active')
      .single();
    this.throwIfError(error);

    const account = data as AccountRow | null;
    if (!account) {
      throw new Error('Unable to create account');
    }

    return this.toAccountDto(account);
  }

  private async listCategoriesAsync(type?: CategoryType): Promise<CategoryDto[]> {
    const userId = await this.supabase.getRequiredUserId();
    return this.listCategoriesForUser(userId, type);
  }

  private async createCategoryAsync(request: CreateCategoryRequest): Promise<CategoryDto> {
    const userId = await this.supabase.getRequiredUserId();
    const name = request.name.trim();
    if (!name) {
      throw new Error('Category name is required');
    }

    const categories = await this.listCategoryRows(userId, request.type);
    if (categories.some((category) => category.name.trim().toLowerCase() === name.toLowerCase())) {
      throw new Error(`Category already exists for type: ${name}`);
    }

    const { data, error } = await this.supabase.client
      .from('categories')
      .insert({
        user_id: userId,
        name,
        type: request.type,
        sort_order: request.sortOrder ?? 0,
        active: request.active ?? true
      })
      .select('id, user_id, name, type, sort_order, active')
      .single();
    this.throwIfError(error);

    const category = data as CategoryRow | null;
    if (!category) {
      throw new Error('Unable to create category');
    }

    return this.toCategoryDto(category);
  }

  private async updateCategoryAsync(id: number, request: UpdateCategoryRequest): Promise<CategoryDto> {
    const userId = await this.supabase.getRequiredUserId();
    const category = await this.getCategoryRow(userId, id);

    let nextName = category.name;
    if (request.name != null && request.name.trim()) {
      nextName = request.name.trim();
      const siblings = await this.listCategoryRows(userId, category.type);
      const conflict = siblings.find((item) => item.id !== id && item.name.trim().toLowerCase() === nextName.toLowerCase());
      if (conflict) {
        throw new Error(`Category already exists for type: ${nextName}`);
      }
    }

    const { data, error } = await this.supabase.client
      .from('categories')
      .update({
        name: nextName,
        sort_order: request.sortOrder ?? category.sort_order,
        active: request.active ?? category.active
      })
      .eq('id', id)
      .eq('user_id', userId)
      .select('id, user_id, name, type, sort_order, active')
      .single();
    this.throwIfError(error);

    const updatedCategory = data as CategoryRow | null;
    if (!updatedCategory) {
      throw new Error(`Category not found: ${id}`);
    }

    return this.toCategoryDto(updatedCategory);
  }

  private async deleteCategoryAsync(id: number): Promise<void> {
    const userId = await this.supabase.getRequiredUserId();
    await this.getCategoryRow(userId, id);

    const [planCount, transactionCount] = await Promise.all([
      this.countRows('plans', userId, id),
      this.countRows('transactions', userId, id)
    ]);

    if (planCount > 0 || transactionCount > 0) {
      throw new Error('Category is referenced by plans or transactions and cannot be deleted');
    }

    const { error } = await this.supabase.client.from('categories').delete().eq('id', id).eq('user_id', userId);
    this.throwIfError(error);
  }

  private async listPlansAsync(month: string, type: CategoryType): Promise<PlanItemDto[]> {
    this.validateMonth(month);
    const userId = await this.supabase.getRequiredUserId();
    const categories = await this.listCategoryRows(userId, type);
    const plans = await this.listPlanRowsForUser(userId, month);
    const plannedByCategoryId = new Map<number, number>();

    for (const plan of plans) {
      plannedByCategoryId.set(plan.category_id, this.toNumber(plan.planned_amount));
    }

    return categories
      .sort((left, right) => this.compareCategories(left, right))
      .map((category) => ({
        categoryId: category.id,
        categoryName: category.name,
        categoryType: category.type,
        sortOrder: category.sort_order,
        plannedAmount: plannedByCategoryId.get(category.id) ?? 0
      }));
  }

  private async upsertPlansAsync(month: string, type: CategoryType, request: PlanItemRequest[]): Promise<PlanItemDto[]> {
    this.validateMonth(month);
    const userId = await this.supabase.getRequiredUserId();
    if (!request) {
      throw new Error('Request body is required');
    }

    const categories = await this.listCategoryRows(userId, type);
    const categoryIds = new Set(categories.map((category) => category.id));

    for (const item of request) {
      if (!categoryIds.has(item.categoryId)) {
        throw new Error(`Category ${item.categoryId} does not belong to ${type}`);
      }
    }

    if (request.length) {
      const rows = request.map((item) => ({
        user_id: userId,
        month_key: month,
        category_id: item.categoryId,
        planned_amount: this.roundCurrency(item.plannedAmount)
      }));

      const { error } = await this.supabase.client.from('plans').upsert(rows, {
        onConflict: 'user_id,month_key,category_id'
      });
      this.throwIfError(error);
    }

    return this.listPlansAsync(month, type);
  }

  private async listTransactionsAsync(month: string, type: TransactionType, accountId?: number): Promise<TransactionDto[]> {
    this.validateMonth(month);
    const userId = await this.supabase.getRequiredUserId();
    const account = await this.resolveAccount(userId, accountId);

    const { data, error } = await this.supabase.client
      .from('transactions')
      .select('id, user_id, month_key, type, txn_date, amount, description, category_id, account_id, source_external_id, dedupe_fingerprint, import_batch_id')
      .eq('user_id', userId)
      .eq('month_key', month)
      .eq('type', type)
      .eq('account_id', account.id)
      .order('txn_date', { ascending: false })
      .order('id', { ascending: false });
    this.throwIfError(error);

    return this.mapTransactionsToDto(userId, (data as TransactionRow[] | null) ?? []);
  }

  private async createTransactionAsync(
    month: string,
    type: TransactionType,
    request: TransactionRequest,
    accountId?: number
  ): Promise<TransactionDto> {
    this.validateMonth(month);
    this.validateDateInMonth(request.date, month);

    const userId = await this.supabase.getRequiredUserId();
    const account = await this.resolveAccount(userId, accountId);
    const category = await this.resolveCategoryForType(userId, request.categoryId, type);

    const { data, error } = await this.supabase.client
      .from('transactions')
      .insert({
        user_id: userId,
        month_key: month,
        type,
        txn_date: request.date,
        amount: this.roundCurrency(request.amount),
        description: request.description.trim(),
        category_id: category.id,
        account_id: account.id,
        source_external_id: null,
        dedupe_fingerprint: null,
        import_batch_id: null
      })
      .select('id, user_id, month_key, type, txn_date, amount, description, category_id, account_id, source_external_id, dedupe_fingerprint, import_batch_id')
      .single();
    this.throwIfError(error);

    const transaction = data as TransactionRow | null;
    if (!transaction) {
      throw new Error('Unable to create transaction');
    }

    return this.toTransactionDto(transaction, category, account);
  }

  private async updateTransactionAsync(
    month: string,
    type: TransactionType,
    id: number,
    request: TransactionRequest,
    accountId?: number
  ): Promise<TransactionDto> {
    this.validateMonth(month);
    this.validateDateInMonth(request.date, month);

    const userId = await this.supabase.getRequiredUserId();
    const account = await this.resolveAccount(userId, accountId);
    const category = await this.resolveCategoryForType(userId, request.categoryId, type);
    await this.getTransactionRow(userId, month, type, account.id, id);

    const { data, error } = await this.supabase.client
      .from('transactions')
      .update({
        txn_date: request.date,
        amount: this.roundCurrency(request.amount),
        description: request.description.trim(),
        category_id: category.id
      })
      .eq('id', id)
      .eq('user_id', userId)
      .select('id, user_id, month_key, type, txn_date, amount, description, category_id, account_id, source_external_id, dedupe_fingerprint, import_batch_id')
      .single();
    this.throwIfError(error);

    const transaction = data as TransactionRow | null;
    if (!transaction) {
      throw new Error(`Transaction not found: ${id}`);
    }

    return this.toTransactionDto(transaction, category, account);
  }

  private async deleteTransactionAsync(
    month: string,
    type: TransactionType,
    id: number,
    accountId?: number
  ): Promise<void> {
    this.validateMonth(month);
    const userId = await this.supabase.getRequiredUserId();
    const account = await this.resolveAccount(userId, accountId);
    await this.getTransactionRow(userId, month, type, account.id, id);

    const { error } = await this.supabase.client
      .from('transactions')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)
      .eq('account_id', account.id)
      .eq('month_key', month)
      .eq('type', type);
    this.throwIfError(error);
  }

  private async getMonthSettingsForUser(userId: string, month: string): Promise<MonthSettingsDto> {
    const { data, error } = await this.supabase.client
      .from('month_settings')
      .select('id, user_id, month_key, starting_balance')
      .eq('user_id', userId)
      .eq('month_key', month)
      .maybeSingle();
    this.throwIfError(error);

    const settings = data as MonthSettingsRow | null;

    return {
      month,
      startingBalance: settings ? this.toNumber(settings.starting_balance) : 0
    };
  }

  private async ensureDefaultAccount(userId: string): Promise<AccountRow> {
    const accounts = await this.listAccountRows(userId);
    const existing = accounts.find((account) => account.name.trim().toLowerCase() === ApiService.DEFAULT_ACCOUNT_NAME.toLowerCase());
    if (existing) {
      return existing;
    }

    const { data, error } = await this.supabase.client
      .from('accounts')
      .insert({
        user_id: userId,
        name: ApiService.DEFAULT_ACCOUNT_NAME,
        institution_name: null,
        last4: null,
        active: true
      })
      .select('id, user_id, name, institution_name, last4, active')
      .single();
    this.throwIfError(error);

    const account = data as AccountRow | null;
    if (!account) {
      throw new Error('Unable to create default account');
    }

    return account;
  }

  private async resolveAccount(userId: string, accountId?: number): Promise<AccountRow> {
    if (accountId == null) {
      return this.ensureDefaultAccount(userId);
    }

    const { data, error } = await this.supabase.client
      .from('accounts')
      .select('id, user_id, name, institution_name, last4, active')
      .eq('user_id', userId)
      .eq('id', accountId)
      .eq('active', true)
      .maybeSingle();
    this.throwIfError(error);

    const account = data as AccountRow | null;
    if (!account) {
      throw new Error(`Account not found: ${accountId}`);
    }

    return account;
  }

  private async resolveCategoryForType(userId: string, categoryId: number, type: TransactionType): Promise<CategoryRow> {
    const category = await this.getCategoryRow(userId, categoryId);
    if (category.type !== type) {
      throw new Error('Category type does not match transaction type');
    }
    return category;
  }

  private async getCategoryRow(userId: string, id: number): Promise<CategoryRow> {
    const { data, error } = await this.supabase.client
      .from('categories')
      .select('id, user_id, name, type, sort_order, active')
      .eq('user_id', userId)
      .eq('id', id)
      .maybeSingle();
    this.throwIfError(error);

    const category = data as CategoryRow | null;
    if (!category) {
      throw new Error(`Category not found: ${id}`);
    }

    return category;
  }

  private async getTransactionRow(
    userId: string,
    month: string,
    type: TransactionType,
    accountId: number,
    id: number
  ): Promise<TransactionRow> {
    const { data, error } = await this.supabase.client
      .from('transactions')
      .select('id, user_id, month_key, type, txn_date, amount, description, category_id, account_id, source_external_id, dedupe_fingerprint, import_batch_id')
      .eq('user_id', userId)
      .eq('month_key', month)
      .eq('type', type)
      .eq('account_id', accountId)
      .eq('id', id)
      .maybeSingle();
    this.throwIfError(error);

    const transaction = data as TransactionRow | null;
    if (!transaction) {
      throw new Error(`Transaction not found: ${id}`);
    }

    return transaction;
  }

  private async listCategoriesForUser(userId: string, type?: CategoryType): Promise<CategoryDto[]> {
    const rows = await this.listCategoryRows(userId, type);
    return rows.map((row) => this.toCategoryDto(row));
  }

  private async listCategoryRows(userId: string, type?: CategoryType): Promise<CategoryRow[]> {
    let query = this.supabase.client
      .from('categories')
      .select('id, user_id, name, type, sort_order, active')
      .eq('user_id', userId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (type) {
      query = query.eq('type', type);
    }

    const { data, error } = await query;
    this.throwIfError(error);

    return (data as CategoryRow[] | null) ?? [];
  }

  private async listAccountRows(userId: string): Promise<AccountRow[]> {
    const { data, error } = await this.supabase.client
      .from('accounts')
      .select('id, user_id, name, institution_name, last4, active')
      .eq('user_id', userId)
      .order('name', { ascending: true });
    this.throwIfError(error);

    return (data as AccountRow[] | null) ?? [];
  }

  private async listPlanRowsForUser(userId: string, month: string): Promise<PlanRow[]> {
    const { data, error } = await this.supabase.client
      .from('plans')
      .select('id, user_id, month_key, category_id, planned_amount')
      .eq('user_id', userId)
      .eq('month_key', month);
    this.throwIfError(error);

    return (data as PlanRow[] | null) ?? [];
  }

  private async listTransactionRowsForMonth(userId: string, month: string): Promise<TransactionRow[]> {
    const { data, error } = await this.supabase.client
      .from('transactions')
      .select('id, user_id, month_key, type, txn_date, amount, description, category_id, account_id, source_external_id, dedupe_fingerprint, import_batch_id')
      .eq('user_id', userId)
      .eq('month_key', month);
    this.throwIfError(error);

    return (data as TransactionRow[] | null) ?? [];
  }

  private async mapTransactionsToDto(userId: string, rows: TransactionRow[]): Promise<TransactionDto[]> {
    const categoryIds = [...new Set(rows.map((row) => row.category_id))];
    const accountIds = [...new Set(rows.map((row) => row.account_id))];
    const [categoriesById, accountsById] = await Promise.all([
      this.fetchCategoriesById(userId, categoryIds),
      this.fetchAccountsById(userId, accountIds)
    ]);

    return rows.map((row) => {
      const category = categoriesById.get(row.category_id);
      const account = accountsById.get(row.account_id);

      return {
        id: row.id,
        month: row.month_key,
        type: row.type,
        date: row.txn_date,
        amount: this.toNumber(row.amount),
        description: row.description,
        categoryId: row.category_id,
        categoryName: category?.name ?? 'Unknown category',
        accountId: row.account_id,
        accountName: account?.name ?? 'Unknown account'
      };
    });
  }

  private async fetchCategoriesById(userId: string, ids: number[]): Promise<Map<number, CategoryRow>> {
    if (!ids.length) {
      return new Map<number, CategoryRow>();
    }

    const { data, error } = await this.supabase.client
      .from('categories')
      .select('id, user_id, name, type, sort_order, active')
      .eq('user_id', userId)
      .in('id', ids);
    this.throwIfError(error);

    return new Map(((data as CategoryRow[] | null) ?? []).map((row) => [row.id, row]));
  }

  private async fetchAccountsById(userId: string, ids: number[]): Promise<Map<number, AccountRow>> {
    if (!ids.length) {
      return new Map<number, AccountRow>();
    }

    const { data, error } = await this.supabase.client
      .from('accounts')
      .select('id, user_id, name, institution_name, last4, active')
      .eq('user_id', userId)
      .in('id', ids);
    this.throwIfError(error);

    return new Map(((data as AccountRow[] | null) ?? []).map((row) => [row.id, row]));
  }

  private buildSummaryRows(
    categoryType: CategoryType,
    categories: CategoryDto[],
    categoryById: Map<number, CategoryDto>,
    plans: PlanRow[],
    transactions: TransactionRow[]
  ) {
    const orderedCategories = new Map<number, CategoryDto>();
    for (const category of categories.filter((item) => item.type === categoryType && item.active)) {
      orderedCategories.set(category.id, category);
    }

    const plannedByCategoryId = new Map<number, number>();
    for (const plan of plans) {
      const category = categoryById.get(plan.category_id);
      if (!category || category.type !== categoryType) {
        continue;
      }

      orderedCategories.set(category.id, category);
      plannedByCategoryId.set(
        category.id,
        this.roundCurrency((plannedByCategoryId.get(category.id) ?? 0) + this.toNumber(plan.planned_amount))
      );
    }

    const actualByCategoryId = new Map<number, number>();
    for (const transaction of transactions) {
      if (transaction.type !== categoryType) {
        continue;
      }

      const category = categoryById.get(transaction.category_id);
      if (!category) {
        continue;
      }

      orderedCategories.set(category.id, category);
      actualByCategoryId.set(
        category.id,
        this.roundCurrency((actualByCategoryId.get(category.id) ?? 0) + this.toNumber(transaction.amount))
      );
    }

    return [...orderedCategories.values()].map((category) => {
      const planned = this.roundCurrency(plannedByCategoryId.get(category.id) ?? 0);
      const actual = this.roundCurrency(actualByCategoryId.get(category.id) ?? 0);
      const diff = categoryType === 'EXPENSE'
        ? this.roundCurrency(planned - actual)
        : this.roundCurrency(actual - planned);

      return {
        categoryId: category.id,
        categoryName: category.name,
        planned,
        actual,
        diff
      };
    });
  }

  private buildTotals(rows: Array<{ planned: number; actual: number; diff: number }>) {
    return rows.reduce(
      (totals, row) => ({
        planned: this.roundCurrency(totals.planned + row.planned),
        actual: this.roundCurrency(totals.actual + row.actual),
        diff: this.roundCurrency(totals.diff + row.diff)
      }),
      { planned: 0, actual: 0, diff: 0 }
    );
  }

  private async countRows(table: 'plans' | 'transactions', userId: string, categoryId: number): Promise<number> {
    const { count, error } = await this.supabase.client
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('category_id', categoryId);
    this.throwIfError(error);

    return count ?? 0;
  }

  private validateMonth(month: string): void {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new Error(`Invalid month: ${month}`);
    }

    const monthNumber = Number(month.slice(5, 7));
    if (monthNumber < 1 || monthNumber > 12) {
      throw new Error(`Invalid month: ${month}`);
    }
  }

  private validateDateInMonth(date: string, month: string): void {
    if (!date || date.slice(0, 7) !== month) {
      throw new Error(`Transaction date must belong to month ${month}`);
    }
  }

  private toAccountDto(row: AccountRow): AccountDto {
    return {
      id: row.id,
      name: row.name,
      institutionName: row.institution_name,
      last4: row.last4,
      active: row.active
    };
  }

  private toCategoryDto(row: CategoryRow): CategoryDto {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      sortOrder: row.sort_order,
      active: row.active
    };
  }

  private toTransactionDto(row: TransactionRow, category: CategoryRow, account: AccountRow): TransactionDto {
    return {
      id: row.id,
      month: row.month_key,
      type: row.type,
      date: row.txn_date,
      amount: this.toNumber(row.amount),
      description: row.description,
      categoryId: row.category_id,
      categoryName: category.name,
      accountId: row.account_id,
      accountName: account.name
    };
  }

  private compareCategories(left: CategoryRow, right: CategoryRow): number {
    return left.sort_order - right.sort_order || left.name.localeCompare(right.name);
  }

  private toNumber(value: number | string | null | undefined): number {
    const parsed = typeof value === 'number' ? value : Number(value ?? 0);
    return Number.isNaN(parsed) ? 0 : this.roundCurrency(parsed);
  }

  private roundCurrency(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private normalizeOptional(value: string | undefined): string | null {
    if (!value) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  private throwIfError(error: { message: string } | null): void {
    if (error) {
      throw new Error(error.message);
    }
  }
}
