/** Only processing permission is remembered; media, reports and credentials are not stored here. */
export type ProcessingChoice = 'ask' | 'allow' | 'decline';
export type AnalysisPrivacy = {version: 1; files: ProcessingChoice; youtube: ProcessingChoice};
export const ANALYSIS_PRIVACY_KEY = 'lolixco.analysis-privacy.v1';
export const DEFAULT_ANALYSIS_PRIVACY: AnalysisPrivacy = {version: 1, files: 'ask', youtube: 'ask'};
const choices: ProcessingChoice[] = ['ask', 'allow', 'decline'];

export function readAnalysisPrivacy(storage?: Pick<Storage, 'getItem'>): AnalysisPrivacy {
 try {
  const value = JSON.parse((storage ?? localStorage).getItem(ANALYSIS_PRIVACY_KEY) || 'null');
  if (value?.version === 1 && choices.includes(value.files) && choices.includes(value.youtube)) return value;
 } catch { /* Private browsing or malformed storage: ask before sharing. */ }
 return {...DEFAULT_ANALYSIS_PRIVACY};
}

export function saveAnalysisPrivacy(value: AnalysisPrivacy, storage?: Pick<Storage, 'setItem'>): void {
 try { (storage ?? localStorage).setItem(ANALYSIS_PRIVACY_KEY, JSON.stringify(value)); }
 catch { /* The choice remains effective in memory when browser storage is unavailable. */ }
}
