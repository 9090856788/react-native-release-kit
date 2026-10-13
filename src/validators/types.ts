export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface DoctorCheckItem {
  id: string;
  category: 'environment' | 'android' | 'ios' | 'config';
  title: string;
  status: CheckStatus;
  message: string;
  remediation?: string;
}

export interface DoctorReport {
  checks: DoctorCheckItem[];
  passed: boolean;
  warnings: number;
  errors: number;
}
