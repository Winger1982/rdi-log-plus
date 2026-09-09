import type { Logbook } from './logbook-types';
import type { RdiLogRecord } from './types';
import { supabase } from './supabase';

export async function loadLogbooksFromSupabase() {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    return {
      ok: false,
      logbooks: [] as Logbook[],
      error: sessionError.message,
    };
  }

  const userId = session?.user.id;

  if (!userId) {
    return {
      ok: false,
      logbooks: [] as Logbook[],
      error: 'No authenticated Supabase user.',
    };
  }

  const { data, error } = await supabase
    .from('logbooks')
    .select(
      `
        id,
        name,
        template,
        archived,
        created_at,
        updated_at,
        last_imported_at,
        last_imported_count,
        last_imported_filename
      `,
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) {
    return {
      ok: false,
      logbooks: [] as Logbook[],
      error: error.message,
    };
  }

  const logbooks: Logbook[] = (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    template: row.template as Logbook['template'],
    archived: row.archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastImportedAt: row.last_imported_at ?? undefined,
    lastImportedCount: row.last_imported_count ?? undefined,
    lastImportedFilename: row.last_imported_filename ?? undefined,
  }));

  return {
    ok: true,
    logbooks,
    error: null,
  };
}

export async function loadQsoRecordsFromSupabase(
  logbookId: string,
) {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    return {
      ok: false,
      records: [] as RdiLogRecord[],
      error: sessionError.message,
    };
  }

  const userId = session?.user.id;

  if (!userId) {
    return {
      ok: false,
      records: [] as RdiLogRecord[],
      error: 'No authenticated Supabase user.',
    };
  }

  const { data, error } = await supabase
    .from('qso_records')
    .select(
      `
        id,
        dx,
        callsign,
        date,
        time,
        frequency,
        mode,
        rst,
        wkd,
        path,
        submitter,
        remarks,
        sqsl,
        rqsl,
        qsl_info
      `,
    )
    .eq('user_id', userId)
    .eq('logbook_id', logbookId)
    .order('date', { ascending: true })
    .order('time', { ascending: true });

  if (error) {
    return {
      ok: false,
      records: [] as RdiLogRecord[],
      error: error.message,
    };
  }

  const records: RdiLogRecord[] = (data ?? []).map((row) => ({
    id: row.id,
    dx: row.dx ?? undefined,
    callsign: row.callsign ?? undefined,
    date: row.date ?? undefined,
    time: row.time ?? undefined,
    frequency: row.frequency ?? undefined,
    mode: row.mode ?? undefined,
    rst: row.rst ?? undefined,
    wkd: row.wkd ?? undefined,
    path: row.path ?? undefined,
    submitter: row.submitter ?? undefined,
    remarks: row.remarks ?? undefined,
    sqsl: row.sqsl ?? undefined,
    rqsl: row.rqsl ?? undefined,
    qslInfo: row.qsl_info ?? undefined,
  }));

  return {
    ok: true,
    records,
    error: null,
  };
}
