import { formatSupabaseError } from './supabase-error';

describe('formatSupabaseError', () => {
  it('returns an actionable message for invalid schema errors', () => {
    expect(
      formatSupabaseError(
        {
          code: 'PGRST106',
          message: 'Invalid schema: expense_manager'
        },
        'expense_manager'
      )
    ).toBe(
      'Supabase API does not expose schema "expense_manager". Add "expense_manager" to Exposed schemas in your Supabase project API settings, then reload the app.'
    );
  });

  it('returns the original message for other errors', () => {
    expect(
      formatSupabaseError(
        {
          code: '23505',
          message: 'duplicate key value violates unique constraint'
        },
        'expense_manager'
      )
    ).toBe('duplicate key value violates unique constraint');
  });
});
