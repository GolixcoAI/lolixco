/** Public clients only contact the analysis service through their own origin. */
type AnalysisEnvironment = { DEV?: boolean; VITE_ANALYSIS_ENABLED?: string };

export function analysisFeatureEnabled(environment: AnalysisEnvironment): boolean {
 return environment.DEV === true || environment.VITE_ANALYSIS_ENABLED === 'true';
}

export const ANALYZER_ENABLED = analysisFeatureEnabled(import.meta.env ?? {});

export function analyzerApiPath(path: string): string {
 // Never allow a URL, query-selected host, encoded traversal or an absolute path.
 if (!/^(?:health|inbox|media|jobs|youtube)(?:\/[A-Za-z0-9_-]+)*$/.test(path)) {
  throw new Error('This analysis request is unavailable.');
 }
 return '/api/v8/' + path;
}

export function developerAnalyzerToolsEnabled(): boolean {
 if (!import.meta.env?.DEV || typeof window === 'undefined') return false;
 return new URLSearchParams(window.location.search).get('studioTools') === '1';
}
