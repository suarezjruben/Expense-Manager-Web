import { Injectable } from '@angular/core';
import { defer, from } from 'rxjs';
import {
  CsvHeaderMappingInput,
  ImportIssueDto,
  ImportSummaryDto,
  StatementImportResponseDto,
  TransactionType
} from './api.models';
import {
  CsvHeaderMappingRequiredError,
  CsvStatementParserService,
  NormalizedStatementRow,
  StatementIssue
} from './csv-statement-parser.service';
import { formatSupabaseError } from './supabase-error';
import { SupabaseService } from './supabase.service';
import { AccountRow, CategoryRow, CsvMappingRow, ImportBatchRow, TransactionRow } from './supabase.models';

interface CandidateTransaction {
  rowNumber: number | null;
  date: string;
  type: TransactionType;
  amount: number;
  description: string;
  externalId: string | null;
  sourceCategory: string | null;
  fingerprint: string;
}

@Injectable({ providedIn: 'root' })
export class CsvImportService {
  private static readonly IMPORTED_EXPENSE_CATEGORY = 'Imported Expense';
  private static readonly IMPORTED_INCOME_CATEGORY = 'Imported Income';

  constructor(
    private readonly parser: CsvStatementParserService,
    private readonly supabase: SupabaseService
  ) {}

  importStatement(accountId: number, file: File, mapping?: CsvHeaderMappingInput) {
    return defer(() => from(this.importStatementAsync(accountId, file, mapping)));
  }

  private async importStatementAsync(
    accountId: number,
    file: File,
    mapping?: CsvHeaderMappingInput
  ): Promise<StatementImportResponseDto> {
    if (!file) {
      throw new Error('File is required');
    }

    const userId = await this.supabase.getRequiredUserId();
    await this.resolveAccount(userId, accountId);

    if (!file.name.toLowerCase().endsWith('.csv')) {
      throw new Error('Only CSV statement imports are supported in this project.');
    }

    const effectiveMapping = mapping ?? await this.loadSavedMapping(userId, accountId);

    try {
      const parseResult = await this.parser.parse(file, effectiveMapping);
      if (mapping?.saveHeaderMapping) {
        await this.upsertSavedMapping(userId, accountId, mapping);
      }

      const summary = await this.completeImport(userId, accountId, file.name, parseResult.rows, [...parseResult.issues]);
      return {
        status: 'COMPLETED',
        summary,
        headerMappingPrompt: null
      };
    } catch (error) {
      if (error instanceof CsvHeaderMappingRequiredError) {
        return {
          status: 'HEADER_MAPPING_REQUIRED',
          summary: null,
          headerMappingPrompt: error.prompt
        };
      }

      throw error;
    }
  }

  private async completeImport(
    userId: string,
    accountId: number,
    fileName: string,
    parsedRows: NormalizedStatementRow[],
    issues: StatementIssue[]
  ): Promise<ImportSummaryDto> {
    const batch = await this.createImportBatch(userId, accountId, fileName);
    const categoryCache = new Map<string, CategoryRow>();
    const fallbackExpenseCategory = await this.getOrCreateCategory(
      userId,
      'EXPENSE',
      CsvImportService.IMPORTED_EXPENSE_CATEGORY,
      categoryCache
    );
    const fallbackIncomeCategory = await this.getOrCreateCategory(
      userId,
      'INCOME',
      CsvImportService.IMPORTED_INCOME_CATEGORY,
      categoryCache
    );

    const candidates = this.normalizeRows(parsedRows, issues);
    const existingExternalIds = await this.loadExistingExternalIds(userId, accountId, candidates);
    const existingFingerprints = await this.loadExistingFingerprints(userId, accountId, candidates);
    const seenExternalIds = new Set(existingExternalIds);
    const seenFingerprints = new Set(existingFingerprints);

    const transactionsToInsert: Array<Omit<TransactionRow, 'id'>> = [];
    let skippedDuplicates = 0;

    for (const candidate of candidates) {
      const duplicateByExternalId = candidate.externalId != null && seenExternalIds.has(candidate.externalId);
      const duplicateByFingerprint = seenFingerprints.has(candidate.fingerprint);
      if (duplicateByExternalId || duplicateByFingerprint) {
        skippedDuplicates += 1;
        continue;
      }

      if (candidate.externalId) {
        seenExternalIds.add(candidate.externalId);
      }
      seenFingerprints.add(candidate.fingerprint);

      const fallbackCategory = candidate.type === 'EXPENSE' ? fallbackExpenseCategory : fallbackIncomeCategory;
      const category = await this.resolveCategoryForCandidate(userId, candidate, fallbackCategory, categoryCache);

      transactionsToInsert.push({
        user_id: userId,
        month_key: candidate.date.slice(0, 7),
        type: candidate.type,
        txn_date: candidate.date,
        amount: candidate.amount,
        description: candidate.description,
        category_id: category.id,
        account_id: accountId,
        source_external_id: candidate.externalId,
        dedupe_fingerprint: candidate.fingerprint,
        import_batch_id: batch.id
      });
    }

    if (transactionsToInsert.length) {
      const { error } = await this.supabase.client.from('transactions').insert(transactionsToInsert);
      this.throwIfError(error);
    }

    if (issues.length) {
      const importIssues = issues.map((issue) => ({
        user_id: userId,
        import_batch_id: batch.id,
        severity: issue.severity,
        row_number: issue.rowNumber,
        message: this.truncate(issue.message, 500)
      }));
      const { error } = await this.supabase.client.from('import_issues').insert(importIssues);
      this.throwIfError(error);
    }

    const parseErrors = issues.filter((issue) => issue.severity === 'ERROR');
    const warnings = issues.filter((issue) => issue.severity === 'WARNING');
    const status = parseErrors.length || warnings.length ? 'COMPLETED_WITH_WARNINGS' : 'COMPLETED';

    const { error: updateError } = await this.supabase.client
      .from('import_batches')
      .update({
        status,
        inserted_count: transactionsToInsert.length,
        skipped_duplicates: skippedDuplicates,
        parse_error_count: parseErrors.length,
        warning_count: warnings.length,
        completed_at: new Date().toISOString()
      })
      .eq('id', batch.id)
      .eq('user_id', userId);
    this.throwIfError(updateError);

    return {
      importBatchId: batch.id,
      inserted: transactionsToInsert.length,
      skippedDuplicates,
      parseErrors: parseErrors.map((issue) => this.toIssueDto(issue)),
      warnings: warnings.map((issue) => this.toIssueDto(issue))
    };
  }

  private normalizeRows(rows: NormalizedStatementRow[], issues: StatementIssue[]): CandidateTransaction[] {
    const candidates: CandidateTransaction[] = [];

    for (const row of rows) {
      if (!row.date) {
        issues.push({ severity: 'ERROR', rowNumber: row.rowNumber, message: 'Row is missing a transaction date' });
        continue;
      }

      if (row.signedAmount == null) {
        issues.push({ severity: 'ERROR', rowNumber: row.rowNumber, message: 'Row is missing an amount' });
        continue;
      }

      const signedAmount = this.roundCurrency(row.signedAmount);
      if (signedAmount === 0) {
        issues.push({ severity: 'WARNING', rowNumber: row.rowNumber, message: 'Skipped zero-amount transaction' });
        continue;
      }

      const type: TransactionType = signedAmount < 0 ? 'EXPENSE' : 'INCOME';
      candidates.push({
        rowNumber: row.rowNumber,
        date: row.date,
        type,
        amount: Math.abs(signedAmount),
        description: this.normalizeDescription(row.description),
        externalId: this.truncate(this.normalizeOptional(row.externalId), 200),
        sourceCategory: this.truncate(this.normalizeOptional(row.sourceCategory), 120),
        fingerprint: this.buildFingerprint(row.date, type, Math.abs(signedAmount), this.normalizeDescription(row.description))
      });
    }

    return candidates;
  }

  private async createImportBatch(userId: string, accountId: number, fileName: string): Promise<ImportBatchRow> {
    const { data, error } = await this.supabase.client
      .from('import_batches')
      .insert({
        user_id: userId,
        account_id: accountId,
        source_name: fileName.trim(),
        status: 'PROCESSING',
        inserted_count: 0,
        skipped_duplicates: 0,
        parse_error_count: 0,
        warning_count: 0,
        created_at: new Date().toISOString()
      })
      .select('id, user_id, account_id, source_name, status, inserted_count, skipped_duplicates, parse_error_count, warning_count')
      .single();
    this.throwIfError(error);

    const batch = data as ImportBatchRow | null;
    if (!batch) {
      throw new Error('Unable to create import batch');
    }

    return batch;
  }

  private async loadSavedMapping(userId: string, accountId: number): Promise<CsvHeaderMappingInput | null> {
    const { data, error } = await this.supabase.client
      .from('csv_mappings')
      .select('id, user_id, account_id, date_column_index, amount_column_index, description_column_index, category_column_index, external_id_column_index')
      .eq('user_id', userId)
      .eq('account_id', accountId)
      .maybeSingle();
    this.throwIfError(error);

    const mappingRow = data as CsvMappingRow | null;
    if (!mappingRow) {
      return null;
    }

    return {
      dateColumnIndex: mappingRow.date_column_index,
      amountColumnIndex: mappingRow.amount_column_index,
      descriptionColumnIndex: mappingRow.description_column_index,
      categoryColumnIndex: mappingRow.category_column_index,
      externalIdColumnIndex: mappingRow.external_id_column_index,
      saveHeaderMapping: true
    };
  }

  private async upsertSavedMapping(userId: string, accountId: number, mapping: CsvHeaderMappingInput): Promise<void> {
    const { error } = await this.supabase.client.from('csv_mappings').upsert(
      {
        user_id: userId,
        account_id: accountId,
        date_column_index: mapping.dateColumnIndex,
        amount_column_index: mapping.amountColumnIndex,
        description_column_index: mapping.descriptionColumnIndex,
        category_column_index: mapping.categoryColumnIndex ?? null,
        external_id_column_index: mapping.externalIdColumnIndex ?? null,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: 'user_id,account_id'
      }
    );
    this.throwIfError(error);
  }

  private async resolveAccount(userId: string, accountId: number): Promise<AccountRow> {
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

  private async loadExistingExternalIds(
    userId: string,
    accountId: number,
    candidates: CandidateTransaction[]
  ): Promise<Set<string>> {
    const externalIds = [...new Set(candidates.map((candidate) => candidate.externalId).filter((value): value is string => Boolean(value)))];
    if (!externalIds.length) {
      return new Set<string>();
    }

    const { data, error } = await this.supabase.client
      .from('transactions')
      .select('source_external_id')
      .eq('user_id', userId)
      .eq('account_id', accountId)
      .in('source_external_id', externalIds);
    this.throwIfError(error);

    return new Set(
      (data ?? [])
        .map((row) => row.source_external_id as string | null)
        .filter((value): value is string => Boolean(value))
    );
  }

  private async loadExistingFingerprints(
    userId: string,
    accountId: number,
    candidates: CandidateTransaction[]
  ): Promise<Set<string>> {
    const fingerprints = [...new Set(candidates.map((candidate) => candidate.fingerprint))];
    if (!fingerprints.length) {
      return new Set<string>();
    }

    const { data, error } = await this.supabase.client
      .from('transactions')
      .select('dedupe_fingerprint')
      .eq('user_id', userId)
      .eq('account_id', accountId)
      .in('dedupe_fingerprint', fingerprints);
    this.throwIfError(error);

    return new Set(
      (data ?? [])
        .map((row) => row.dedupe_fingerprint as string | null)
        .filter((value): value is string => Boolean(value))
    );
  }

  private async resolveCategoryForCandidate(
    userId: string,
    candidate: CandidateTransaction,
    fallbackCategory: CategoryRow,
    categoryCache: Map<string, CategoryRow>
  ): Promise<CategoryRow> {
    const normalized = this.normalizeOptional(candidate.sourceCategory);
    if (!normalized) {
      return fallbackCategory;
    }

    return this.getOrCreateCategory(userId, candidate.type, normalized, categoryCache);
  }

  private async getOrCreateCategory(
    userId: string,
    type: TransactionType,
    name: string,
    categoryCache: Map<string, CategoryRow>
  ): Promise<CategoryRow> {
    const normalizedName = name.trim();
    const cacheKey = `${type}|${normalizedName.toLowerCase()}`;
    const cached = categoryCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const { data, error } = await this.supabase.client
      .from('categories')
      .select('id, user_id, name, type, sort_order, active')
      .eq('user_id', userId)
      .eq('type', type)
      .ilike('name', normalizedName);
    this.throwIfError(error);

    const existing = (data as CategoryRow[] | null)?.find(
      (category) => category.name.trim().toLowerCase() === normalizedName.toLowerCase()
    );
    if (existing) {
      categoryCache.set(cacheKey, existing);
      return existing;
    }

    const { data: maxSortRows, error: maxSortError } = await this.supabase.client
      .from('categories')
      .select('sort_order')
      .eq('user_id', userId)
      .eq('type', type)
      .order('sort_order', { ascending: false })
      .limit(1);
    this.throwIfError(maxSortError);

    const maxSort = Number((maxSortRows?.[0] as { sort_order?: number } | undefined)?.sort_order ?? 0);
    const { data: created, error: createError } = await this.supabase.client
      .from('categories')
      .insert({
        user_id: userId,
        name: normalizedName,
        type,
        sort_order: maxSort + 1,
        active: true
      })
      .select('id, user_id, name, type, sort_order, active')
      .single();
    this.throwIfError(createError);

    const createdCategory = created as CategoryRow | null;
    if (!createdCategory) {
      throw new Error(`Unable to create category: ${normalizedName}`);
    }

    categoryCache.set(cacheKey, createdCategory);
    return createdCategory;
  }

  private toIssueDto(issue: StatementIssue): ImportIssueDto {
    return {
      rowNumber: issue.rowNumber,
      message: issue.message
    };
  }

  private normalizeDescription(value: string | null): string {
    const normalized = this.normalizeOptional(value);
    if (!normalized) {
      return 'Imported transaction';
    }
    return this.truncate(normalized, 300) ?? 'Imported transaction';
  }

  private normalizeOptional(value: string | null): string | null {
    if (!value) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  private truncate(value: string | null, maxLength: number): string | null {
    if (value == null) {
      return null;
    }
    return value.length <= maxLength ? value : value.slice(0, maxLength);
  }

  private buildFingerprint(date: string, type: TransactionType, amount: number, description: string): string {
    const source = `${date}|${type}|${amount.toFixed(2)}|${description.toLowerCase().replace(/\s+/g, ' ').trim()}`;
    let hash = 2166136261;

    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  private roundCurrency(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private throwIfError(error: { code?: string; details?: string | null; hint?: string | null; message?: string } | null): void {
    if (error) {
      throw new Error(formatSupabaseError(error, this.supabase.schema));
    }
  }
}
