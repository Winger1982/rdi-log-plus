import type { RdiLogRecord } from './types';

function makeId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function parseSimpleCSV(content: string): RdiLogRecord[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const header = lines[0].split(',').map((h) => h.trim().toUpperCase());

  return lines.slice(1).map((line) => {
    const cols = line.split(',').map((c) => c.trim());

    const get = (name: string) => {
      const index = header.indexOf(name);
      return index >= 0 ? cols[index] ?? '' : '';
    };

    return {
      id: makeId(),
      dx: get('DX'),
      callsign: get('DX') || get('CALLSIGN'),
      date: get('DATE'),
      time: get('UTC') || get('TIME'),
      frequency: get('FREQUENCY'),
      mode: get('MODE'),
      rst: get('RST'),
      wkd: get('WKD'),
      path: get('PATH'),
      submitter: get('SUBMITTER'),
      remarks: get('REMARKS'),
      sqsl: get('SQSL'),
      rqsl: get('RQSL'),
      qslInfo: get('QSL_INFO'),
    };
  });
}