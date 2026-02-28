export interface AccountRow {
  id: number;
  user_id: string;
  name: string;
  institution_name: string | null;
  last4: string | null;
  active: boolean;
}

export interface CategoryRow {
  id: number;
  user_id: string;
  name: string;
  type: 'EXPENSE' | 'INCOME';
  sort_order: number;
  active: boolean;
}

export interface MonthSettingsRow {
  id: number;
  user_id: string;
  month_key: string;
  starting_balance: number | string;
}

export interface PlanRow {
  id: number;
  user_id: string;
  month_key: string;
  category_id: number;
  planned_amount: number | string;
}

export interface TransactionRow {
  id: number;
  user_id: string;
  month_key: string;
  type: 'EXPENSE' | 'INCOME';
  txn_date: string;
  amount: number | string;
  description: string;
  category_id: number;
  account_id: number;
  source_external_id: string | null;
  dedupe_fingerprint: string | null;
  import_batch_id: number | null;
}

export interface CsvMappingRow {
  id: number;
  user_id: string;
  account_id: number;
  date_column_index: number;
  amount_column_index: number;
  description_column_index: number;
  category_column_index: number | null;
  external_id_column_index: number | null;
}

export interface ImportBatchRow {
  id: number;
  user_id: string;
  account_id: number;
  source_name: string;
  status: string;
  inserted_count: number;
  skipped_duplicates: number;
  parse_error_count: number;
  warning_count: number;
}
