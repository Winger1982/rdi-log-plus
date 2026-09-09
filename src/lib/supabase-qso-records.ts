import type { RdiLogRecord } from './types';
import { supabase } from './supabase';

export async function syncQsoRecordsToSupabase(
  logbookId: string,
  records: RdiLogRecord[],
) {
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

  if (!logbookId || records.length === 0) {
    return {
      ok: true,
      uploaded: 0,
      error: null,
    };
  }

  const updatedAt = new Date().toISOString();

  const rows = records.map((record) => ({
    id: record.id,
    user_id: userId,
    logbook_id: logbookId,

    dx: record.dx ?? null,
    callsign: record.callsign ?? null,
    date: record.date ?? null,
    time: record.time ?? null,
    frequency: record.frequency ?? null,
    mode: record.mode ?? null,
    rst: record.rst ?? null,
    wkd: record.wkd ?? null,
    path: record.path ?? null,
    submitter: record.submitter ?? null,
    remarks: record.remarks ?? null,
    sqsl: record.sqsl ?? null,
    rqsl: record.rqsl ?? null,
    qsl_info: record.qslInfo ?? null,

    updated_at: updatedAt,
  }));

  const { error } = await supabase
    .from('qso_records')
    .upsert(rows, {
      onConflict: 'user_id,logbook_id,id',
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

export async function deleteQsoRecordFromSupabase(
  logbookId: string,
  recordId: string,
) {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    return {
      ok: false,
      error: sessionError.message,
    };
  }

  const userId = session?.user.id;

  if (!userId) {
    return {
      ok: false,
      error: 'No authenticated Supabase user.',
    };
  }

  const { error } = await supabase
    .from('qso_records')
    .delete()
    .eq('user_id', userId)
    .eq('logbook_id', logbookId)
    .eq('id', recordId);

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  return {
    ok: true,
    error: null,
  };
}
