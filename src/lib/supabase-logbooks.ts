import type { Logbook } from './logbook-types';
import { supabase } from './supabase';

export async function syncLogbooksToSupabase(logbooks: Logbook[]) {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    return {
      ok: false,
      uploaded: 0,
      error: sessionError.message,
    };
  }

  const userId = session?.user.id;

  if (!userId) {
    return {
      ok: false,
      uploaded: 0,
      error: 'No authenticated Supabase user.',
    };
  }

  if (logbooks.length === 0) {
    return {
      ok: true,
      uploaded: 0,
      error: null,
    };
  }

  const rows = logbooks.map((logbook) => ({
    id: logbook.id,
    user_id: userId,
    name: logbook.name,
    template: logbook.template,
    archived: logbook.archived,
    created_at: logbook.createdAt,
    updated_at: logbook.updatedAt,
    last_imported_at: logbook.lastImportedAt ?? null,
    last_imported_count: logbook.lastImportedCount ?? null,
    last_imported_filename: logbook.lastImportedFilename ?? null,
  }));

  const { error } = await supabase
    .from('logbooks')
    .upsert(rows, {
      onConflict: 'user_id,id',
    });

  if (error) {
    return {
      ok: false,
      uploaded: 0,
      error: error.message,
    };
  }

  return {
    ok: true,
    uploaded: rows.length,
    error: null,
  };
}
