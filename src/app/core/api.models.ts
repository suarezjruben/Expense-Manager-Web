export type CategoryType = 'EXPENSE' | 'INCOME';
export type TransactionType = 'EXPENSE' | 'INCOME';

export interface AccountDto {
  id: number;
  name: string;
  institutionName: string | null;
  last4: string | null;
  active: boolean;
}

export interface CreateAccountRequest {
  name: string;
  institutionName?: string;
  last4?: string;
}

export interface CategoryDto {
  id: number;
  name: string;
  type: CategoryType;
  sortOrder: number;
  active: boolean;
}

export interface CreateCategoryRequest {
  name: string;
  type: CategoryType;
  sortOrder?: number;
  active?: boolean;
}

export interface UpdateCategoryRequest {
  name?: string;
  sortOrder?: number;
  active?: boolean;
}

export interface MonthSettingsDto {
  month: string;
  startingBalance: number;
}

export interface SummaryCategoryDto {
  categoryId: number;
  categoryName: string;
  planned: number;
  actual: number;
  diff: number;
}

export interface SummaryTotalsDto {
  planned: number;
  actual: number;
  diff: number;
}

export interface MonthSummaryDto {
  month: string;
  startingBalance: number;
  netChange: number;
  endingBalance: number;
  savingsLabel: string;
  expenseTotals: SummaryTotalsDto;
  incomeTotals: SummaryTotalsDto;
  expenseCategories: SummaryCategoryDto[];
  incomeCategories: SummaryCategoryDto[];
}

export interface PlanItemDto {
  categoryId: number;
  categoryName: string;
  categoryType: CategoryType;
  sortOrder: number;
  plannedAmount: number;
}

export interface PlanItemRequest {
  categoryId: number;
  plannedAmount: number;
}

export interface TransactionDto {
  id: number;
  month: string;
  type: TransactionType;
  date: string;
  amount: number;
  description: string;
  categoryId: number;
  categoryName: string;
  accountId: number | null;
  accountName: string | null;
}

export interface TransactionRequest {
  date: string;
  amount: number;
  description: string;
  categoryId: number;
}

export interface ImportIssueDto {
  rowNumber: number | null;
  message: string;
}

export interface ImportSummaryDto {
  importBatchId: number;
  inserted: number;
  skippedDuplicates: number;
  parseErrors: ImportIssueDto[];
  warnings: ImportIssueDto[];
}

export type StatementImportStatus = 'COMPLETED' | 'HEADER_MAPPING_REQUIRED';

export interface CsvHeaderMappingPromptDto {
  message: string;
  columnCount: number;
  sampleRow: Array<string | null>;
  suggestedDateColumnIndex: number | null;
  suggestedAmountColumnIndex: number | null;
  suggestedDescriptionColumnIndex: number | null;
  suggestedCategoryColumnIndex: number | null;
  suggestedExternalIdColumnIndex: number | null;
}

export interface StatementImportResponseDto {
  status: StatementImportStatus;
  summary: ImportSummaryDto | null;
  headerMappingPrompt: CsvHeaderMappingPromptDto | null;
}

export interface CsvHeaderMappingInput {
  dateColumnIndex: number;
  amountColumnIndex: number;
  descriptionColumnIndex: number;
  categoryColumnIndex?: number | null;
  externalIdColumnIndex?: number | null;
  saveHeaderMapping?: boolean;
}
