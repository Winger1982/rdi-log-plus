export type RdiLogRecord = {
  id: string;
  dx?: string;
  callsign?: string;
  date?: string;
  time?: string;
  frequency?: string;
  mode?: string;
  rst?: string;
  wkd?: string;
  path?: string;
  submitter?: string;
  remarks?: string;
  sqsl?: string;
  rqsl?: string;
  qslInfo?: string;
};

export type ValidationIssue = {
  recordId: string;
  field: string;
  message: string;
  severity: 'warning' | 'error';
};