interface SupabaseErrorLike {
  code?: string;
  details?: string | null;
  hint?: string | null;
  message?: string;
}

export function formatSupabaseError(error: SupabaseErrorLike | null | undefined, schema: string): string {
  if (!error?.message) {
    return 'Request failed';
  }

  if (error.code === 'PGRST106' || error.message.includes(`Invalid schema: ${schema}`)) {
    return `Supabase API does not expose schema "${schema}". Add "${schema}" to Exposed schemas in your Supabase project API settings, then reload the app.`;
  }

  return error.message;
}

