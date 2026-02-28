import { Injectable } from '@angular/core';
import Papa from 'papaparse';
import { CsvHeaderMappingInput, CsvHeaderMappingPromptDto } from './api.models';

type ImportIssueSeverity = 'ERROR' | 'WARNING';

interface CsvColumnMapping {
  dateColumnIndex: number;
  amountColumnIndex: number;
  descriptionColumnIndex: number;
  categoryColumnIndex: number | null;
  externalIdColumnIndex: number | null;
}

export interface StatementIssue {
  severity: ImportIssueSeverity;
  rowNumber: number | null;
  message: string;
}

export interface NormalizedStatementRow {
  rowNumber: number | null;
  date: string | null;
  signedAmount: number | null;
  description: string | null;
  externalId: string | null;
  sourceCategory: string | null;
}

export interface StatementParseResult {
  rows: NormalizedStatementRow[];
  issues: StatementIssue[];
}

const DATE_HEADERS = new Set(['date', 'txn date', 'transaction date', 'posted date', 'post date']);
const AMOUNT_HEADERS = new Set(['amount', 'transaction amount', 'amt']);
const DEBIT_HEADERS = new Set(['debit', 'withdrawal', 'outflow', 'money out']);
const CREDIT_HEADERS = new Set(['credit', 'deposit', 'inflow', 'money in']);
const MEMO_HEADERS = new Set(['memo']);
const DESCRIPTION_HEADERS = new Set(['description', 'payee', 'name', 'details']);
const CATEGORY_HEADERS = new Set(['category', 'category name', 'classification']);
const EXTERNAL_ID_HEADERS = new Set(['fitid', 'id', 'transaction id', 'reference', 'reference id']);
const ALL_KNOWN_HEADERS = new Set([
  ...DATE_HEADERS,
  ...AMOUNT_HEADERS,
  ...DEBIT_HEADERS,
  ...CREDIT_HEADERS,
  ...MEMO_HEADERS,
  ...DESCRIPTION_HEADERS,
  ...CATEGORY_HEADERS,
  ...EXTERNAL_ID_HEADERS
]);

export class CsvHeaderMappingRequiredError extends Error {
  constructor(readonly prompt: CsvHeaderMappingPromptDto) {
    super(prompt.message);
  }
}

@Injectable({ providedIn: 'root' })
export class CsvStatementParserService {
  async parse(file: File, mapping?: CsvHeaderMappingInput | null): Promise<StatementParseResult> {
    const text = await file.text();
    return this.parseText(text, mapping ?? null);
  }

  parseText(text: string, mapping: CsvHeaderMappingInput | null): StatementParseResult {
    const rows: NormalizedStatementRow[] = [];
    const issues: StatementIssue[] = [];

    const result = Papa.parse<string[]>(text, {
      skipEmptyLines: 'greedy'
    });

    for (const error of result.errors) {
      const rowNumber = typeof error.row === 'number' && error.row > 0 ? error.row : null;
      issues.push({
        severity: 'WARNING',
        rowNumber,
        message: error.message
      });
    }

    const records = result.data
      .filter((record): record is string[] => Array.isArray(record))
      .map((record) => record.map((value) => value ?? ''));

    if (!records.length) {
      issues.push({ severity: 'ERROR', rowNumber: null, message: 'CSV is empty' });
      return { rows: [], issues };
    }

    const firstRecord = records[0];
    if (this.looksLikeHeader(firstRecord)) {
      this.parseWithHeader(records, rows, issues);
      return { rows, issues };
    }

    if (!mapping) {
      throw new CsvHeaderMappingRequiredError(this.buildHeaderMappingPrompt(firstRecord));
    }

    this.parseWithoutHeader(records, this.toColumnMapping(mapping), rows, issues);
    return { rows, issues };
  }

  private parseWithHeader(records: string[][], rows: NormalizedStatementRow[], issues: StatementIssue[]): void {
    const indexedHeaders = this.indexHeaderColumns(records[0]);
    const dateIndex = this.findColumnIndex(indexedHeaders, DATE_HEADERS);
    const amountIndex = this.findColumnIndex(indexedHeaders, AMOUNT_HEADERS);
    const debitIndex = this.findColumnIndex(indexedHeaders, DEBIT_HEADERS);
    const creditIndex = this.findColumnIndex(indexedHeaders, CREDIT_HEADERS);
    const memoIndex = this.findColumnIndex(indexedHeaders, MEMO_HEADERS);
    const descriptionIndex = this.findColumnIndex(indexedHeaders, DESCRIPTION_HEADERS);
    const categoryIndex = this.findColumnIndex(indexedHeaders, CATEGORY_HEADERS);
    const externalIdIndex = this.findColumnIndex(indexedHeaders, EXTERNAL_ID_HEADERS);

    if (dateIndex == null) {
      issues.push({ severity: 'ERROR', rowNumber: null, message: 'CSV is missing a date column' });
      return;
    }

    if (amountIndex == null && debitIndex == null && creditIndex == null) {
      issues.push({
        severity: 'ERROR',
        rowNumber: null,
        message: 'CSV is missing amount or debit/credit columns'
      });
      return;
    }

    for (let index = 1; index < records.length; index += 1) {
      this.parseRecord(
        records[index],
        index + 1,
        {
          amountIndex,
          categoryIndex,
          creditIndex,
          dateIndex,
          debitIndex,
          descriptionIndex,
          externalIdIndex,
          memoIndex
        },
        rows,
        issues
      );
    }
  }

  private parseWithoutHeader(
    records: string[][],
    mapping: CsvColumnMapping,
    rows: NormalizedStatementRow[],
    issues: StatementIssue[]
  ): void {
    for (let index = 0; index < records.length; index += 1) {
      this.parseRecord(
        records[index],
        index + 1,
        {
          amountIndex: mapping.amountColumnIndex,
          categoryIndex: mapping.categoryColumnIndex,
          creditIndex: null,
          dateIndex: mapping.dateColumnIndex,
          debitIndex: null,
          descriptionIndex: mapping.descriptionColumnIndex,
          externalIdIndex: mapping.externalIdColumnIndex,
          memoIndex: null
        },
        rows,
        issues
      );
    }
  }

  private parseRecord(
    record: string[],
    rowNumber: number,
    indexes: {
      amountIndex: number | null;
      categoryIndex: number | null;
      creditIndex: number | null;
      dateIndex: number | null;
      debitIndex: number | null;
      descriptionIndex: number | null;
      externalIdIndex: number | null;
      memoIndex: number | null;
    },
    rows: NormalizedStatementRow[],
    issues: StatementIssue[]
  ): void {
    const date = this.parseDate(this.get(record, indexes.dateIndex));
    if (!date) {
      issues.push({ severity: 'ERROR', rowNumber, message: 'Invalid or empty date' });
      return;
    }

    const signedAmount = this.resolveAmount(
      this.get(record, indexes.amountIndex),
      this.get(record, indexes.debitIndex),
      this.get(record, indexes.creditIndex)
    );
    if (signedAmount == null) {
      issues.push({ severity: 'ERROR', rowNumber, message: 'Invalid or empty amount' });
      return;
    }

    let description = this.normalize(this.get(record, indexes.memoIndex)) ?? this.normalize(this.get(record, indexes.descriptionIndex));
    if (!description) {
      description = 'Imported transaction';
      issues.push({
        severity: 'WARNING',
        rowNumber,
        message: 'Missing description. Defaulted to Imported transaction'
      });
    }

    rows.push({
      rowNumber,
      date,
      signedAmount,
      description,
      externalId: this.normalize(this.get(record, indexes.externalIdIndex)),
      sourceCategory: this.normalize(this.get(record, indexes.categoryIndex))
    });
  }

  private looksLikeHeader(firstRecord: string[]): boolean {
    if (!firstRecord.length) {
      return false;
    }

    const firstCell = this.normalize(firstRecord[0]);
    const secondCell = firstRecord.length > 1 ? this.normalize(firstRecord[1]) : null;
    if (this.parseDate(firstCell) && this.parseAmount(secondCell) != null) {
      return false;
    }

    const knownHeaderCount = firstRecord
      .map((value) => this.normalizeHeader(value))
      .filter((value) => ALL_KNOWN_HEADERS.has(value)).length;

    return knownHeaderCount >= 2;
  }

  private buildHeaderMappingPrompt(firstRecord: string[]): CsvHeaderMappingPromptDto {
    const inferred = this.inferColumnMapping(firstRecord);
    return {
      message: 'CSV file has no recognizable header row. Provide column indexes to continue import.',
      columnCount: firstRecord.length,
      sampleRow: firstRecord.map((value) => this.normalize(value)),
      suggestedDateColumnIndex: inferred?.dateColumnIndex ?? null,
      suggestedAmountColumnIndex: inferred?.amountColumnIndex ?? null,
      suggestedDescriptionColumnIndex: inferred?.descriptionColumnIndex ?? null,
      suggestedCategoryColumnIndex: inferred?.categoryColumnIndex ?? null,
      suggestedExternalIdColumnIndex: inferred?.externalIdColumnIndex ?? null
    };
  }

  private inferColumnMapping(record: string[]): CsvColumnMapping | null {
    let dateColumnIndex: number | null = null;
    let amountColumnIndex: number | null = null;
    let descriptionColumnIndex: number | null = null;
    let longest = -1;

    for (let index = 0; index < record.length; index += 1) {
      if (dateColumnIndex == null && this.parseDate(record[index])) {
        dateColumnIndex = index;
      }
    }

    for (let index = 0; index < record.length; index += 1) {
      if (index === dateColumnIndex) {
        continue;
      }
      if (amountColumnIndex == null && this.parseAmount(record[index]) != null) {
        amountColumnIndex = index;
      }
    }

    for (let index = 0; index < record.length; index += 1) {
      if (index === dateColumnIndex || index === amountColumnIndex) {
        continue;
      }

      const value = this.normalize(record[index]);
      if (!value || !/[a-z]/i.test(value)) {
        continue;
      }

      if (value.length > longest) {
        longest = value.length;
        descriptionColumnIndex = index;
      }
    }

    if (dateColumnIndex == null || amountColumnIndex == null || descriptionColumnIndex == null) {
      return null;
    }

    return {
      dateColumnIndex,
      amountColumnIndex,
      descriptionColumnIndex,
      categoryColumnIndex: null,
      externalIdColumnIndex: null
    };
  }

  private toColumnMapping(mapping: CsvHeaderMappingInput): CsvColumnMapping {
    return {
      dateColumnIndex: mapping.dateColumnIndex,
      amountColumnIndex: mapping.amountColumnIndex,
      descriptionColumnIndex: mapping.descriptionColumnIndex,
      categoryColumnIndex: mapping.categoryColumnIndex ?? null,
      externalIdColumnIndex: mapping.externalIdColumnIndex ?? null
    };
  }

  private indexHeaderColumns(header: string[]): Map<string, number> {
    const indexed = new Map<string, number>();
    header.forEach((value, index) => {
      const normalized = this.normalizeHeader(value);
      if (normalized && !indexed.has(normalized)) {
        indexed.set(normalized, index);
      }
    });
    return indexed;
  }

  private findColumnIndex(indexedHeaders: Map<string, number>, candidates: Set<string>): number | null {
    for (const candidate of candidates) {
      const match = indexedHeaders.get(this.normalizeHeader(candidate));
      if (match != null) {
        return match;
      }
    }
    return null;
  }

  private resolveAmount(amountRaw: string | null, debitRaw: string | null, creditRaw: string | null): number | null {
    const amount = this.parseAmount(amountRaw);
    if (amount != null) {
      return amount;
    }

    const debit = this.parseAmount(debitRaw);
    const credit = this.parseAmount(creditRaw);
    if (debit == null && credit == null) {
      return null;
    }

    const normalizedDebit = debit == null ? 0 : Math.abs(debit);
    const normalizedCredit = credit == null ? 0 : Math.abs(credit);
    return Number((normalizedCredit - normalizedDebit).toFixed(2));
  }

  private parseDate(raw: string | null): string | null {
    const value = this.normalize(raw);
    if (!value) {
      return null;
    }

    const directIso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (directIso) {
      return this.buildIsoDate(Number(directIso[1]), Number(directIso[2]), Number(directIso[3]));
    }

    const slashYmd = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(value);
    if (slashYmd) {
      return this.buildIsoDate(Number(slashYmd[1]), Number(slashYmd[2]), Number(slashYmd[3]));
    }

    const slashDmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
    if (slashDmy) {
      const monthFirst = this.buildIsoDate(Number(slashDmy[3]), Number(slashDmy[1]), Number(slashDmy[2]));
      if (monthFirst) {
        return monthFirst;
      }
      return this.buildIsoDate(Number(slashDmy[3]), Number(slashDmy[2]), Number(slashDmy[1]));
    }

    return null;
  }

  private buildIsoDate(year: number, month: number, day: number): string | null {
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (
      candidate.getUTCFullYear() !== year ||
      candidate.getUTCMonth() + 1 !== month ||
      candidate.getUTCDate() !== day
    ) {
      return null;
    }

    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  private parseAmount(raw: string | null): number | null {
    const value = this.normalize(raw);
    if (!value) {
      return null;
    }

    let candidate = value;
    let negative = false;

    if (candidate.startsWith('(') && candidate.endsWith(')')) {
      negative = true;
      candidate = candidate.slice(1, -1);
    }

    if (candidate.endsWith('-')) {
      negative = true;
      candidate = candidate.slice(0, -1);
    }

    const cleaned = candidate.replace(/[$,\s]/g, '');
    if (!cleaned) {
      return null;
    }

    const parsed = Number(cleaned);
    if (Number.isNaN(parsed)) {
      return null;
    }

    const signed = negative ? -parsed : parsed;
    return Number(signed.toFixed(2));
  }

  private get(record: string[], columnIndex: number | null): string | null {
    if (columnIndex == null || columnIndex < 0 || columnIndex >= record.length) {
      return null;
    }
    return record[columnIndex];
  }

  private normalizeHeader(value: string | null): string {
    if (!value) {
      return '';
    }
    return value.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private normalize(value: string | null): string | null {
    if (!value) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
}
