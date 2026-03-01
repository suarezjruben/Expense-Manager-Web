import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize, forkJoin } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { MonthStateService } from '../../core/month-state.service';
import {
  InlineDropdownAction,
  InlineDropdownComponent,
  InlineDropdownItem
} from '../../components/inline-dropdown/inline-dropdown.component';
import {
  AccountDto,
  CategoryDto,
  CsvHeaderMappingInput,
  CsvHeaderMappingPromptDto,
  ImportSummaryDto,
  TransactionDto,
  TransactionType
} from '../../core/api.models';

interface NewTransactionForm {
  date: string;
  amount: number;
  description: string;
  categoryId: number | null;
}

interface CsvHeaderMappingForm {
  dateColumnIndex: number | null;
  amountColumnIndex: number | null;
  descriptionColumnIndex: number | null;
  categoryColumnIndex: number | null;
  externalIdColumnIndex: number | null;
  saveHeaderMapping: boolean;
}

type CategoryDialogSource = 'FORM' | 'TRANSACTION';

@Component({
  selector: 'app-transactions-page',
  standalone: true,
  imports: [CommonModule, FormsModule, InlineDropdownComponent],
  templateUrl: './transactions-page.component.html',
  styleUrl: './transactions-page.component.scss'
})
export class TransactionsPageComponent implements OnInit {
  readonly categoryDropdownActions: InlineDropdownAction[] = [
    {
      id: 'add',
      title: 'Add category',
      ariaLabel: 'Add category',
      icon: 'plus'
    }
  ];

  month: string;
  loading = false;
  uploading = false;
  error = '';
  accountDialogError = '';
  deleteAccountError = '';
  deletingAccount = false;

  accounts: AccountDto[] = [];
  selectedAccountId: number | null = null;
  newAccountName = '';
  deleteAccountConfirmationName = '';
  selectedStatementFile: File | null = null;
  selectedStatementFileName = '';
  importSummary: ImportSummaryDto | null = null;
  headerMappingPrompt: CsvHeaderMappingPromptDto | null = null;
  headerMappingForm: CsvHeaderMappingForm = this.createHeaderMappingForm();

  expenseCategories: CategoryDto[] = [];
  incomeCategories: CategoryDto[] = [];
  expenseCategorySelection: number | string | null = null;
  incomeCategorySelection: number | string | null = null;
  expenseCategoryDraft = '';
  incomeCategoryDraft = '';
  expenseCategoryError = '';
  incomeCategoryError = '';
  expenses: TransactionDto[] = [];
  incomes: TransactionDto[] = [];
  expenseCategoryByTransactionId: Record<number, number> = {};
  incomeCategoryByTransactionId: Record<number, number> = {};
  savingTransactionKeys = new Set<string>();
  savingTypes = new Set<TransactionType>();
  deletingTypes = new Set<TransactionType>();
  showAccountDialog = false;
  showUploadDialog = false;
  showExpenseDialog = false;
  showIncomeDialog = false;
  showCategoryDialog = false;
  showDeleteAccountDialog = false;
  categoryDialogType: TransactionType | null = null;
  categoryDialogSource: CategoryDialogSource = 'FORM';
  categoryDialogTransactionId: number | null = null;
  categoryDialogPreviousSelection: number | null = null;
  activeMobileTransactionTab: TransactionType = 'EXPENSE';

  expenseForm: NewTransactionForm = this.createDefaultForm();
  incomeForm: NewTransactionForm = this.createDefaultForm();

  constructor(
    private readonly api: ApiService,
    private readonly monthState: MonthStateService
  ) {
    this.month = this.monthState.month;
  }

  ngOnInit(): void {
    this.syncFormDates();
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = '';
    this.api.listAccounts().subscribe({
      next: (accounts) => {
        this.accounts = accounts.filter((account) => account.active);
        if (!this.accounts.length) {
          this.error = 'No active accounts available';
          this.expenses = [];
          this.incomes = [];
          this.loading = false;
          return;
        }

        if (this.selectedAccountId == null || !this.accounts.some((account) => account.id === this.selectedAccountId)) {
          this.selectedAccountId = this.accounts[0].id;
        }

        this.loadTransactionsForSelectedAccount();
      },
      error: (error) => {
        this.error = this.toMessage(error);
        this.loading = false;
      }
    });
  }

  onMonthChanged(): void {
    this.monthState.setMonth(this.month);
    this.syncFormDates();
    this.load();
  }

  addExpense(): void {
    this.activeMobileTransactionTab = 'EXPENSE';
    this.addTransaction('EXPENSE', this.expenseForm);
  }

  addIncome(): void {
    this.activeMobileTransactionTab = 'INCOME';
    this.addTransaction('INCOME', this.incomeForm);
  }

  openAccountDialog(): void {
    this.showAccountDialog = true;
    this.newAccountName = '';
    this.accountDialogError = '';
  }

  closeAccountDialog(): void {
    this.showAccountDialog = false;
    this.newAccountName = '';
    this.accountDialogError = '';
  }

  openDeleteAccountDialog(): void {
    if (!this.selectedAccountId) {
      return;
    }

    this.showDeleteAccountDialog = true;
    this.deleteAccountConfirmationName = '';
    this.deleteAccountError = '';
  }

  closeDeleteAccountDialog(): void {
    this.showDeleteAccountDialog = false;
    this.deleteAccountConfirmationName = '';
    this.deleteAccountError = '';
    this.deletingAccount = false;
  }

  deleteSelectedAccount(): void {
    if (!this.selectedAccountId) {
      this.deleteAccountError = 'Account is required.';
      return;
    }

    if (this.deleteAccountConfirmationName.trim() !== this.selectedAccountName) {
      this.deleteAccountError = 'Type the account name exactly to confirm deletion.';
      return;
    }

    this.deletingAccount = true;
    this.deleteAccountError = '';

    this.api.deleteAccount(this.selectedAccountId).subscribe({
      next: () => {
        this.selectedAccountId = null;
        this.showDeleteAccountDialog = false;
        this.deleteAccountConfirmationName = '';
        this.deletingAccount = false;
        this.importSummary = null;
        this.resetUploadDialogState();
        this.load();
      },
      error: (error) => {
        this.deletingAccount = false;
        this.deleteAccountError = this.toMessage(error);
      }
    });
  }

  openUploadDialog(): void {
    this.showUploadDialog = true;
    this.error = '';
  }

  closeUploadDialog(): void {
    this.showUploadDialog = false;
    this.error = '';
    this.resetUploadDialogState();
  }

  openExpenseDialog(): void {
    this.activeMobileTransactionTab = 'EXPENSE';
    this.showExpenseDialog = true;
    this.error = '';
    this.syncDialogCategoryState('EXPENSE');
  }

  closeExpenseDialog(): void {
    this.showExpenseDialog = false;
    this.closeCategoryDialog();
    this.error = '';
    this.expenseCategoryError = '';
  }

  openIncomeDialog(): void {
    this.activeMobileTransactionTab = 'INCOME';
    this.showIncomeDialog = true;
    this.error = '';
    this.syncDialogCategoryState('INCOME');
  }

  setActiveMobileTransactionTab(type: TransactionType): void {
    this.activeMobileTransactionTab = type;
  }

  closeIncomeDialog(): void {
    this.showIncomeDialog = false;
    this.closeCategoryDialog();
    this.error = '';
    this.incomeCategoryError = '';
  }

  openCategoryDialog(type: TransactionType, source: CategoryDialogSource, transactionId?: number): void {
    this.showCategoryDialog = true;
    this.categoryDialogType = type;
    this.categoryDialogSource = source;
    this.categoryDialogTransactionId = transactionId ?? null;
    this.categoryDialogPreviousSelection = this.getCategoryDialogSelection(type, source, transactionId);

    if (type === 'EXPENSE') {
      this.expenseCategoryDraft = '';
      this.expenseCategoryError = '';
      return;
    }

    this.incomeCategoryDraft = '';
    this.incomeCategoryError = '';
  }

  closeCategoryDialog(restorePreviousSelection = true): void {
    if (restorePreviousSelection && this.categoryDialogType) {
      this.restoreCategoryDialogSelection();
    }

    if (this.categoryDialogType === 'EXPENSE') {
      this.expenseCategoryDraft = '';
      this.expenseCategoryError = '';
    }

    if (this.categoryDialogType === 'INCOME') {
      this.incomeCategoryDraft = '';
      this.incomeCategoryError = '';
    }

    this.showCategoryDialog = false;
    this.categoryDialogType = null;
    this.categoryDialogSource = 'FORM';
    this.categoryDialogTransactionId = null;
    this.categoryDialogPreviousSelection = null;
  }

  selectAccount(accountId: number): void {
    this.selectedAccountId = accountId;
    this.load();
  }

  onAccountDropdownAction(actionId: string): void {
    if (actionId === 'delete') {
      this.openDeleteAccountDialog();
      return;
    }

    this.openAccountDialog();
  }

  selectDialogCategoryOption(type: TransactionType, categoryId: number): void {
    this.selectDialogCategory(type, categoryId);
  }

  onCategoryDropdownAction(type: TransactionType, source: CategoryDialogSource, transactionId?: number): void {
    this.openCategoryDialog(type, source, transactionId);
  }

  selectTransactionCategoryOption(type: TransactionType, transactionId: number, categoryId: number): void {
    this.selectTransactionCategory(type, transactionId, categoryId);
  }

  createCategoryFromDialog(type: TransactionType): void {
    const name = (type === 'EXPENSE' ? this.expenseCategoryDraft : this.incomeCategoryDraft).trim();
    if (!name) {
      if (type === 'EXPENSE') {
        this.expenseCategoryError = 'Category name is required.';
      } else {
        this.incomeCategoryError = 'Category name is required.';
      }
      return;
    }

    const existingCategory = this.findCategoryByName(type, name);
    if (existingCategory) {
      this.applyCreatedCategorySelection(type, existingCategory.id);
      this.closeCategoryDialog(false);
      return;
    }

    const target = type === 'EXPENSE' ? this.expenseCategories : this.incomeCategories;
    const sortOrder = target.length + 1;

    this.api.createCategory({
      name,
      type,
      sortOrder,
      active: true
    }).subscribe({
      next: (category) => {
        if (type === 'EXPENSE') {
          this.expenseCategories = this.sortCategories([...this.expenseCategories, category]);
          this.applyCreatedCategorySelection(type, category.id);
          this.closeCategoryDialog(false);
          return;
        }

        this.incomeCategories = this.sortCategories([...this.incomeCategories, category]);
        this.applyCreatedCategorySelection(type, category.id);
        this.closeCategoryDialog(false);
      },
      error: (error) => {
        const message = this.toMessage(error);
        if (type === 'EXPENSE') {
          this.expenseCategoryError = message;
        } else {
          this.incomeCategoryError = message;
        }
      }
    });
  }

  get expenseTotal(): number {
    return this.expenses.reduce((sum, transaction) => sum + Number(transaction.amount ?? 0), 0);
  }

  get incomeTotal(): number {
    return this.incomes.reduce((sum, transaction) => sum + Number(transaction.amount ?? 0), 0);
  }

  get selectedAccountName(): string {
    return this.accounts.find((account) => account.id === this.selectedAccountId)?.name ?? 'Selected Account';
  }

  get accountDropdownItems(): InlineDropdownItem[] {
    return this.accounts.map((account) => ({
      value: account.id,
      label: account.name
    }));
  }

  get accountDropdownActions(): InlineDropdownAction[] {
    return [
      {
        id: 'add',
        title: 'Add account',
        ariaLabel: 'Add account',
        icon: 'plus'
      },
      {
        id: 'delete',
        title: 'Delete account',
        ariaLabel: 'Delete account',
        icon: 'trash',
        variant: 'danger',
        disabled: this.selectedAccountId == null
      }
    ];
  }

  get expenseCategoryDropdownItems(): InlineDropdownItem[] {
    return this.expenseCategories.map((category) => ({
      value: category.id,
      label: category.name
    }));
  }

  get incomeCategoryDropdownItems(): InlineDropdownItem[] {
    return this.incomeCategories.map((category) => ({
      value: category.id,
      label: category.name
    }));
  }

  formatShortDate(value: string): string {
    const [year = '', month = '', day = ''] = value.split('-');
    if (!year || !month || !day) {
      return value;
    }

    return `${year.slice(-2)}/${month}/${day}`;
  }

  deleteTransaction(type: TransactionType, id: number): void {
    if (!this.selectedAccountId) {
      this.error = 'Account is required';
      return;
    }
    if (this.isDeletingType(type)) {
      return;
    }

    this.api.deleteTransaction(this.month, type, id, this.selectedAccountId).subscribe({
      next: () => this.load(),
      error: (error) => (this.error = this.toMessage(error))
    });
  }

  hasCategoryChanged(type: TransactionType, transaction: TransactionDto): boolean {
    const selectedCategoryId = this.getSelectedCategoryId(type, transaction);
    return selectedCategoryId !== transaction.categoryId;
  }

  hasPendingCategoryChanges(type: TransactionType): boolean {
    const source = type === 'EXPENSE' ? this.expenses : this.incomes;
    return source.some((transaction) => this.hasCategoryChanged(type, transaction));
  }

  isSavingTransaction(type: TransactionType, transactionId: number): boolean {
    return this.savingTransactionKeys.has(this.transactionKey(type, transactionId));
  }

  isSavingType(type: TransactionType): boolean {
    return this.savingTypes.has(type);
  }

  isDeletingType(type: TransactionType): boolean {
    return this.deletingTypes.has(type);
  }

  hasTransactions(type: TransactionType): boolean {
    const source = type === 'EXPENSE' ? this.expenses : this.incomes;
    return source.length > 0;
  }

  saveTransactionCategory(type: TransactionType, transaction: TransactionDto): void {
    if (!this.selectedAccountId) {
      this.error = 'Account is required';
      return;
    }
    if (this.isDeletingType(type)) {
      return;
    }

    const selectedCategoryId = this.getSelectedCategoryId(type, transaction);
    if (!selectedCategoryId) {
      this.error = 'Category is required';
      return;
    }

    const key = this.transactionKey(type, transaction.id);
    this.savingTransactionKeys.add(key);
    this.api.updateTransaction(this.month, type, transaction.id, {
      date: transaction.date,
      amount: transaction.amount,
      description: transaction.description,
      categoryId: selectedCategoryId
    }, this.selectedAccountId).subscribe({
      next: () => {
        this.savingTransactionKeys.delete(key);
        this.load();
      },
      error: (error) => {
        this.savingTransactionKeys.delete(key);
        this.error = this.toMessage(error);
      }
    });
  }

  saveAllTransactionCategories(type: TransactionType): void {
    if (!this.selectedAccountId) {
      this.error = 'Account is required';
      return;
    }
    if (this.isDeletingType(type)) {
      return;
    }
    const accountId = this.selectedAccountId;

    const source = type === 'EXPENSE' ? this.expenses : this.incomes;
    const changedTransactions = source.filter((transaction) => this.hasCategoryChanged(type, transaction));
    if (!changedTransactions.length) {
      return;
    }

    this.error = '';
    this.savingTypes.add(type);

    const updates = changedTransactions.map((transaction) => {
      const selectedCategoryId = this.getSelectedCategoryId(type, transaction);
      const key = this.transactionKey(type, transaction.id);
      this.savingTransactionKeys.add(key);
      return this.api.updateTransaction(this.month, type, transaction.id, {
        date: transaction.date,
        amount: transaction.amount,
        description: transaction.description,
        categoryId: selectedCategoryId
      }, accountId).pipe(finalize(() => this.savingTransactionKeys.delete(key)));
    });

    forkJoin(updates)
      .pipe(finalize(() => this.savingTypes.delete(type)))
      .subscribe({
        next: () => this.load(),
        error: (error) => (this.error = this.toMessage(error))
      });
  }

  deleteAllTransactions(type: TransactionType): void {
    if (!this.selectedAccountId) {
      this.error = 'Account is required';
      return;
    }
    if (this.isSavingType(type) || this.isDeletingType(type)) {
      return;
    }

    const source = type === 'EXPENSE' ? this.expenses : this.incomes;
    if (!source.length) {
      return;
    }

    const typeLabel = type === 'EXPENSE' ? 'expense' : 'income';
    const accountName = this.selectedAccountName;
    const countLabel = source.length === 1 ? 'transaction' : 'transactions';
    const confirmed = window.confirm(
      `Delete all ${source.length} ${typeLabel} ${countLabel} for ${this.month} in ${accountName}? This action cannot be undone.`
    );
    if (!confirmed) {
      return;
    }

    this.error = '';
    const accountId = this.selectedAccountId;
    this.deletingTypes.add(type);
    const deletions = source.map((transaction) => this.api.deleteTransaction(this.month, type, transaction.id, accountId));

    forkJoin(deletions)
      .pipe(finalize(() => this.deletingTypes.delete(type)))
      .subscribe({
        next: () => this.load(),
        error: (error) => (this.error = this.toMessage(error))
      });
  }

  addAccount(): void {
    const name = this.newAccountName.trim();
    if (!name) {
      this.accountDialogError = 'Account name is required';
      return;
    }

    this.accountDialogError = '';
    this.api.createAccount({ name }).subscribe({
      next: (account) => {
        this.newAccountName = '';
        this.selectedAccountId = account.id;
        this.showAccountDialog = false;
        this.load();
      },
      error: (error) => (this.accountDialogError = this.toMessage(error))
    });
  }

  onStatementFileChanged(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.selectedStatementFile = file;
    this.selectedStatementFileName = file?.name ?? '';
    this.headerMappingPrompt = null;
    this.headerMappingForm = this.createHeaderMappingForm();
  }

  uploadStatement(fileInput: HTMLInputElement): void {
    if (!this.selectedAccountId) {
      this.error = 'Account is required';
      return;
    }
    if (!this.selectedStatementFile) {
      this.error = 'Select a CSV file to upload';
      return;
    }

    this.uploading = true;
    this.error = '';
    this.importSummary = null;
    const mappingInput = this.buildMappingInputIfNeeded();
    if (this.headerMappingPrompt && !mappingInput) {
      this.uploading = false;
      return;
    }

    this.api.importStatement(this.selectedAccountId, this.selectedStatementFile, mappingInput).subscribe({
      next: (response) => {
        this.uploading = false;

        if (response.status === 'HEADER_MAPPING_REQUIRED') {
          this.headerMappingPrompt = response.headerMappingPrompt;
          this.applyPromptSuggestions();
          return;
        }

        this.importSummary = response.summary;
        this.showUploadDialog = false;
        this.resetUploadDialogState();
        fileInput.value = '';
        this.load();
      },
      error: (error) => {
        this.error = this.toMessage(error);
        this.uploading = false;
      }
    });
  }

  private addTransaction(type: TransactionType, form: NewTransactionForm): void {
    if (!this.selectedAccountId) {
      this.error = 'Account is required';
      return;
    }
    if (!form.categoryId) {
      this.error = 'Category is required';
      return;
    }
    this.api
      .createTransaction(this.month, type, {
        date: form.date,
        amount: form.amount,
        description: form.description,
        categoryId: form.categoryId
      }, this.selectedAccountId)
      .subscribe({
        next: () => {
          this.load();
          if (type === 'EXPENSE') {
            this.expenseForm = this.createDefaultForm(this.expenseForm.date);
            this.syncDialogCategoryState('EXPENSE');
            this.showExpenseDialog = false;
          } else {
            this.incomeForm = this.createDefaultForm(this.incomeForm.date);
            this.syncDialogCategoryState('INCOME');
            this.showIncomeDialog = false;
          }
        },
        error: (error) => (this.error = this.toMessage(error))
      });
  }

  private buildMappingInputIfNeeded(): CsvHeaderMappingInput | undefined {
    if (!this.headerMappingPrompt) {
      return undefined;
    }

    if (
      this.headerMappingForm.dateColumnIndex == null ||
      this.headerMappingForm.amountColumnIndex == null ||
      this.headerMappingForm.descriptionColumnIndex == null
    ) {
      this.error = 'Date, amount, and description column indexes are required';
      return undefined;
    }

    return {
      dateColumnIndex: this.headerMappingForm.dateColumnIndex,
      amountColumnIndex: this.headerMappingForm.amountColumnIndex,
      descriptionColumnIndex: this.headerMappingForm.descriptionColumnIndex,
      categoryColumnIndex: this.headerMappingForm.categoryColumnIndex,
      externalIdColumnIndex: this.headerMappingForm.externalIdColumnIndex,
      saveHeaderMapping: this.headerMappingForm.saveHeaderMapping
    };
  }

  private applyPromptSuggestions(): void {
    if (!this.headerMappingPrompt) {
      return;
    }
    this.headerMappingForm.dateColumnIndex = this.headerMappingPrompt.suggestedDateColumnIndex;
    this.headerMappingForm.amountColumnIndex = this.headerMappingPrompt.suggestedAmountColumnIndex;
    this.headerMappingForm.descriptionColumnIndex = this.headerMappingPrompt.suggestedDescriptionColumnIndex;
    this.headerMappingForm.categoryColumnIndex = this.headerMappingPrompt.suggestedCategoryColumnIndex;
    this.headerMappingForm.externalIdColumnIndex = this.headerMappingPrompt.suggestedExternalIdColumnIndex;
    this.headerMappingForm.saveHeaderMapping = true;
  }

  private createHeaderMappingForm(): CsvHeaderMappingForm {
    return {
      dateColumnIndex: null,
      amountColumnIndex: null,
      descriptionColumnIndex: null,
      categoryColumnIndex: null,
      externalIdColumnIndex: null,
      saveHeaderMapping: true
    };
  }

  private loadTransactionsForSelectedAccount(): void {
    if (!this.selectedAccountId) {
      this.loading = false;
      this.expenses = [];
      this.incomes = [];
      this.expenseCategoryByTransactionId = {};
      this.incomeCategoryByTransactionId = {};
      return;
    }

    forkJoin({
      expenseCategories: this.api.listCategories('EXPENSE'),
      incomeCategories: this.api.listCategories('INCOME'),
      expenses: this.api.listTransactions(this.month, 'EXPENSE', this.selectedAccountId),
      incomes: this.api.listTransactions(this.month, 'INCOME', this.selectedAccountId)
    }).subscribe({
      next: (data) => {
        this.expenseCategories = data.expenseCategories.filter((c) => c.active);
        this.incomeCategories = data.incomeCategories.filter((c) => c.active);
        this.expenses = data.expenses;
        this.incomes = data.incomes;
        this.initializeCategoryDrafts();
        this.loading = false;
      },
      error: (error) => {
        this.error = this.toMessage(error);
        this.loading = false;
      }
    });
  }

  private initializeCategoryDrafts(): void {
    this.expenseCategoryByTransactionId = Object.fromEntries(
      this.expenses.map((transaction) => [transaction.id, transaction.categoryId])
    );
    this.incomeCategoryByTransactionId = Object.fromEntries(
      this.incomes.map((transaction) => [transaction.id, transaction.categoryId])
    );
  }

  private getSelectedCategoryId(type: TransactionType, transaction: TransactionDto): number {
    if (type === 'EXPENSE') {
      return this.expenseCategoryByTransactionId[transaction.id] ?? transaction.categoryId;
    }
    return this.incomeCategoryByTransactionId[transaction.id] ?? transaction.categoryId;
  }

  private transactionKey(type: TransactionType, transactionId: number): string {
    return `${type}:${transactionId}`;
  }

  private resetUploadDialogState(): void {
    this.selectedStatementFile = null;
    this.selectedStatementFileName = '';
    this.headerMappingPrompt = null;
    this.headerMappingForm = this.createHeaderMappingForm();
  }

  private syncFormDates(): void {
    const firstDay = `${this.month}-01`;
    this.expenseForm.date = firstDay;
    this.incomeForm.date = firstDay;
  }


  private syncDialogCategoryState(type: TransactionType): void {
    if (type === 'EXPENSE') {
      this.expenseCategorySelection = this.expenseForm.categoryId;
      this.expenseCategoryDraft = '';
      this.expenseCategoryError = '';
      return;
    }

    this.incomeCategorySelection = this.incomeForm.categoryId;
    this.incomeCategoryDraft = '';
    this.incomeCategoryError = '';
  }

  private createDefaultForm(date = ''): NewTransactionForm {
    return {
      date,
      amount: 0,
      description: '',
      categoryId: null
    };
  }

  private sortCategories(categories: CategoryDto[]): CategoryDto[] {
    return [...categories].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
  }

  private findCategoryByName(type: TransactionType, value: string): CategoryDto | undefined {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }

    const categories = type === 'EXPENSE' ? this.expenseCategories : this.incomeCategories;
    return categories.find((category) => category.name.trim().toLowerCase() === normalized);
  }

  private selectDialogCategory(type: TransactionType, categoryId: number): void {
    const categories = type === 'EXPENSE' ? this.expenseCategories : this.incomeCategories;
    const category = categories.find((item) => item.id === categoryId);

    if (type === 'EXPENSE') {
      this.expenseCategorySelection = categoryId;
      this.expenseForm.categoryId = categoryId;
      this.expenseCategoryDraft = category?.name ?? '';
      this.expenseCategoryError = '';
      return;
    }

    this.incomeCategorySelection = categoryId;
    this.incomeForm.categoryId = categoryId;
    this.incomeCategoryDraft = category?.name ?? '';
    this.incomeCategoryError = '';
  }

  private selectTransactionCategory(type: TransactionType, transactionId: number, categoryId: number): void {
    if (type === 'EXPENSE') {
      this.expenseCategoryByTransactionId[transactionId] = categoryId;
      return;
    }

    this.incomeCategoryByTransactionId[transactionId] = categoryId;
  }

  private applyCreatedCategorySelection(type: TransactionType, categoryId: number): void {
    if (this.categoryDialogSource === 'TRANSACTION' && this.categoryDialogTransactionId != null) {
      this.selectTransactionCategory(type, this.categoryDialogTransactionId, categoryId);
      return;
    }

    this.selectDialogCategory(type, categoryId);
  }

  private getCategoryDialogSelection(
    type: TransactionType,
    source: CategoryDialogSource,
    transactionId?: number
  ): number | null {
    if (source === 'TRANSACTION' && transactionId != null) {
      const transaction = (type === 'EXPENSE' ? this.expenses : this.incomes).find((item) => item.id === transactionId);
      return transaction ? this.getSelectedCategoryId(type, transaction) : null;
    }

    return type === 'EXPENSE' ? this.expenseForm.categoryId : this.incomeForm.categoryId;
  }

  private restoreCategoryDialogSelection(): void {
    const type = this.categoryDialogType;
    if (!type) {
      return;
    }

    const previousSelection = this.categoryDialogPreviousSelection;
    if (this.categoryDialogSource === 'TRANSACTION' && this.categoryDialogTransactionId != null) {
      if (previousSelection != null) {
        this.selectTransactionCategory(type, this.categoryDialogTransactionId, previousSelection);
      }
      return;
    }

    if (previousSelection != null) {
      this.selectDialogCategory(type, previousSelection);
      return;
    }

    if (type === 'EXPENSE') {
      this.expenseCategorySelection = null;
      this.expenseForm.categoryId = null;
      return;
    }

    this.incomeCategorySelection = null;
    this.incomeForm.categoryId = null;
  }

  private restoreDialogFormSelection(type: TransactionType, categoryId: number | null): void {
    if (categoryId != null) {
      this.selectDialogCategory(type, categoryId);
      return;
    }

    if (type === 'EXPENSE') {
      this.expenseCategorySelection = null;
      this.expenseForm.categoryId = null;
      return;
    }

    this.incomeCategorySelection = null;
    this.incomeForm.categoryId = null;
  }

  private toMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    const payload = (error as { error?: { message?: string } }).error;
    return payload?.message ?? 'Request failed';
  }
}
