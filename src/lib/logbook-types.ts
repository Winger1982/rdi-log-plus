import type { RdiLogRecord } from './types';

export type LogbookTemplate =
  | 'Yearly General Log'
  | 'Contest Log'
  | 'DX Archive'
  | 'Custom Log';

export type Logbook = {
  id: string;
  name: string;
  template: LogbookTemplate;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  lastImportedAt?: string;
  lastImportedCount?: number;
  lastImportedFilename?: string;
};

export type LogbookWithRecords = Logbook & {
  records: RdiLogRecord[];
};