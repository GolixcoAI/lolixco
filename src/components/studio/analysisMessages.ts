/** Provider and worker diagnostics stay behind the API; product copy is allowlisted here. */
export function analysisFailure(code = '', diagnostic = '', status = 0, path = ''): string {
 if (code === 'video_unavailable') return "This YouTube video isn't available for analysis. Try another public video.";
 if (code === 'quota_exceeded' || code === 'rate_limited') return 'AI feedback has reached its limit for now. Try again later, or use signal analysis for an uploaded file.';
 if (['authentication_failed','not_configured','configured_disabled','model_unavailable'].includes(code)) return 'AI feedback is unavailable right now. Try again later, or use signal analysis for an uploaded file.';
 if (code === 'media_too_large' || status === 413) return 'This file is larger than 100 MiB. Choose a smaller file.';
 if (code === 'media_too_long') return 'This edit is longer than two minutes. Trim it and try again.';
 if (code === 'duration_limit') return "We couldn't read a supported video length. Choose a video up to two minutes, or export the file again.";
 if (code === 'analysis_timeout' || code === 'timeout' || status === 408 || status === 504) return 'This is taking longer than expected. Please try again.';
 if (/^jobs\//.test(path) && [403,404,410].includes(status)) return "This report isn't available. Analyze your edit again or open a saved report.";
 if (/^media\//.test(path) && [404,410].includes(status)) return 'This temporary video is no longer available. Choose the file again.';
 if (status === 429) return /storage/i.test(diagnostic) ? 'Temporary storage is full. Delete a previous upload and try again.' : 'Analysis is busy right now. Please try again shortly.';
 if (status >= 500 || code === 'temporarily_unavailable') return "We couldn't analyze this video right now. Please try again.";
 if (['media_decode_failed','media_probe_failed','no_media_stream','decoder_missing','unsupported_metadata','unsupported_container','unsupported_codec','media_analysis_failed'].includes(code) || /corrupt|codec|container|could not be read/i.test(diagnostic) || status === 415) return "We couldn't open this video. Try another file or export it again as MP4.";
 if (code === 'resource_limit' || code === 'audio_resource_limit') return 'This file needs a smaller export for analysis. Try an H.264 MP4 with AAC audio.';
 if (code === 'request_unsupported' || code === 'unsupported') return "We couldn't complete AI feedback for this video. Try again, or use signal analysis for an uploaded file.";
 if (status === 422 || status === 400) return "We couldn't open this video. Check the file or link and try again.";
 if (status === 401 || status === 403) return "Analysis isn't available right now. Please try again later.";
 return "We couldn't reach analysis right now. Check your connection and try again.";
}

export function connectionFailure(): string {
 return typeof navigator !== 'undefined' && navigator.onLine === false
  ? "You're offline. Check your connection and try again."
  : "We couldn't reach analysis right now. Please try again.";
}

export function analysisStage(stage = '', status = ''): string {
 if (status === 'CANCELLED') return 'Analysis cancelled';
 if (status === 'FAILED') return 'Analysis could not finish';
 if (status === 'COMPLETE') return 'Your feedback is ready';
 if (status === 'QUEUED') return 'Your edit is in the queue';
 if (/rhythm|beat|onset/i.test(stage)) return 'Reviewing rhythm';
 if (/story|visual editing/i.test(stage)) return 'Reviewing story and visual choices';
 if (/audio|music/i.test(stage)) return 'Listening to the audio';
 if (/result|report|saving/i.test(stage)) return 'Preparing your results';
 if (/prepar|decod|stream|inspect|extract/i.test(stage)) return 'Preparing your video';
 return 'Analyzing your edit';
}
