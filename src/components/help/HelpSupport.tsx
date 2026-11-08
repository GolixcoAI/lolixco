import { useEffect } from "react";
import { ArrowUpRight, CircleHelp, Play, ScanLine, ShieldCheck } from "lucide-react";
import { SUPPORT_CONTACT } from "../../config/support";

const dimensions = [
  ["Beat Synchronization / Audiovisual Rhythm", "How sound and visible changes work together."],
  ["Cuts & Transitions", "How shots connect and keep the viewer oriented."],
  ["Pacing", "Whether timing, holds and changes in energy serve the edit."],
  ["Visual Craftsmanship", "Framing, consistency, effects and visible distractions."],
  ["Storytelling & Coherence", "How the sequence develops a subject, idea or feeling."],
  ["Creative Execution & Impact", "How the edit's creative choices support its intended expression."],
];

export default function HelpSupport() {
  const base = import.meta.env?.BASE_URL ?? "/";
  useEffect(() => {
    const scrollToTopic = () => {
      let topic = "";
      try { topic = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
      if (topic) document.getElementById?.(topic)?.scrollIntoView?.({block: "start"});
    };
    scrollToTopic();
    window.addEventListener("hashchange", scrollToTopic);
    return () => window.removeEventListener("hashchange", scrollToTopic);
  }, []);

  return <section className="help-page" aria-labelledby="help-heading">
    <div className="help-intro">
      <span className="page-eyebrow"><CircleHelp size={16} aria-hidden="true" /> Help & Support</span>
      <h1 id="help-heading">A little guidance. More creating.</h1>
      <p>Find your next favorite edit, understand your feedback, and keep your work in your control.</p>
    </div>
    <nav className="help-topics" aria-label="Help topics">
      <a href="#discover">Watching & discovery</a><a href="#analyze">Creator Studio</a>
      <a href="#ratings">AI assessments</a><a href="#privacy">Privacy</a>
      <a href="#troubleshooting">Troubleshooting</a><a href="#contact">Contact</a>
    </nav>

    <section id="discover" className="help-section" aria-labelledby="discover-heading">
      <h2 id="discover-heading"><Play size={20} aria-hidden="true" /> Watching & discovery</h2>
      <p>Lolixco brings together curated edits across anime, movies, series, gaming and more. Select an edit on Home or Explore to watch it. Search by title, creator, fandom or tag; select a category to narrow the results.</p>
      <details><summary>How do Shorts and Immersion work?</summary>
        <p>Shorts is a vertical viewing experience. Move between available edits with the on-screen controls, arrow keys or a swipe. Immersion opens a focused viewing queue. Playback still depends on the publisher making the video available.</p>
      </details>
      <details><summary>Why does a video open on YouTube instead?</summary>
        <p>Some publishers disable embedded playback, or a video may be restricted in your region. Choose Watch on YouTube to open the original page. Lolixco cannot override a publisher's restrictions.</p>
      </details>
      <details><summary>Are there keyboard shortcuts?</summary>
        <p>Press / to focus search. Supported video-player controls include K or Space to play or pause, M to mute, F for fullscreen and the arrow keys to seek. Player controls and shortcuts vary for YouTube embeds. Your device's reduced-motion preference is respected.</p>
      </details>
    </section>

    <section id="analyze" className="help-section" aria-labelledby="analyze-heading">
      <h2 id="analyze-heading"><ScanLine size={20} aria-hidden="true" /> Creator Studio</h2>
      <ol className="help-steps">
        <li>Choose Upload Video or Paste YouTube Link.</li>
        <li>Check the preview.</li>
        <li>Select Analyze Edit and choose your processing preference when asked. You can cancel while analysis is running.</li>
        <li>Review the six assessments, open Evidence details and export your report.</li>
      </ol>
      <a className="help-action" href={`${base}?view=studio`}>Open Creator Studio <ArrowUpRight size={16} aria-hidden="true" /></a>
      <details><summary>Which files can I upload?</summary>
        <p>The limit is <strong>100 MiB (104,857,600 bytes)</strong> and <strong>two minutes</strong>. Common MP4, MOV, WebM and MKV videos are supported when their codecs can be decoded. Supported examples include H.264, HEVC and VP9, including portrait and 1080p/60fps videos. A codec may work for analysis even when your browser cannot preview it.</p>
        <p>Audio-only files can also be inspected, but cannot receive visual assessments or a complete six-dimension verdict. If a valid file cannot be decoded, try exporting it again as H.264 MP4 with AAC audio.</p>
      </details>
      <details><summary>Which YouTube links work?</summary>
        <p>Use a public youtube.com/watch, youtu.be or youtube.com/shorts link. Analysis uses Google's permitted video-understanding service and reviews up to the first two minutes. Private, unlisted, removed, age-restricted or otherwise inaccessible videos may be unavailable.</p>
        <p>Playback and analysis are separate. A video that cannot play inside Lolixco may still be available for analysis, but neither is guaranteed.</p>
      </details>
    </section>

    <section id="ratings" className="help-section" aria-labelledby="ratings-heading">
      <h2 id="ratings-heading">Understanding your assessment</h2>
      <p><strong>Experimental AI Assessment</strong> means the feedback is a model's interpretation, not an objective artistic grade. Two decimal places are a display convention. Repeated analyses can differ, and high scores do not establish accuracy.</p>
      <dl className="help-dimensions">{dimensions.map(([name, description]) => <div key={name}><dt>{name}</dt><dd>{description}</dd></div>)}</dl>
      <details><summary>Why are some scores missing?</summary>
        <p>A score needs enough usable evidence. Missing audio, black frames, very short clips, inaccessible content or insufficient observations can leave a dimension unassessed. Missing scores are not zeroes. An overall verdict appears only when all six semantic assessments are supported.</p>
      </details>
      <details><summary>What do evidence and source candidates mean?</summary>
        <p>Evidence details explain the method, strengths, weaknesses, suggested improvements and available reference times. AI timestamps are approximate. Independent signal measurements can support technical findings, but are not a substitute for artistic judgment. Suggested source titles and music names are unverified hypotheses until corroborated.</p>
      </details>
      <details><summary>Can I use feedback without external processing?</summary>
        <p>Where available, signal analysis supplies technical measurements without sending your media to an external AI provider. Storytelling and other creative judgments need additional evidence. Incomplete assessments are left unscored rather than filled with invented numbers.</p>
      </details>
    </section>

    <section id="privacy" className="help-section" aria-labelledby="privacy-heading">
      <h2 id="privacy-heading"><ShieldCheck size={20} aria-hidden="true" /> Your uploads & privacy</h2>
      <p>Analyzing an upload does not publish it to the discovery catalog. External AI review requires your permission to send a temporary video/audio analysis copy to Google. You can choose analysis without that external review where available.</p>
      <p>Your remembered processing choice applies to future analyses in this browser. You can change it below. Changing your choice cannot undo processing that has already happened.</p>
      <a className="help-action" href={`${base}?view=studio&privacy=processing`}>Change analysis privacy choice <ArrowUpRight size={16} aria-hidden="true" /></a>
      <details><summary>How long are uploads and reports kept?</summary>
        <p>Temporary uploads expire after one hour when they are no longer being analyzed. You can delete a temporary upload from its project controls. Prepared analysis copies are removed after processing or cancellation. Saved reports remain until deleted; export a copy if you want to keep one.</p>
        <p>External processing follows the terms for the configured Google service. Creating a temporary copy does not promise zero retention by a third party. Read <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener noreferrer">Google's Gemini API terms</a> and <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google's privacy policy</a>.</p>
      </details>
      <details><summary>What happens when I analyze a public YouTube link?</summary>
        <p>The public URL is sent to Google for audiovisual review. Publisher metadata and the embedded player also use Google's services. A public link is not permission to bypass access or playback restrictions.</p>
      </details>
    </section>

    <section id="troubleshooting" className="help-section" aria-labelledby="troubleshooting-heading">
      <h2 id="troubleshooting-heading">Get back to your edit</h2>
      <details><summary>A video won't play or has disappeared</summary><p>Try the player again, or choose Watch on YouTube. If it was removed or made private, explore another edit. Reloading cannot restore a publisher's unavailable video.</p></details>
      <details><summary>My upload won't open</summary><p>Check that the file is no larger than 100 MiB and no longer than two minutes. Try another file, or export H.264 MP4 with AAC audio. A browser preview limitation alone does not prevent supported analysis.</p></details>
      <details><summary>Analysis stopped or I lost the connection</summary><p>If you're offline, restore your connection and retry. If other pages work, analysis may be temporarily busy or unavailable; wait a moment before retrying. Refreshing a saved analysis link can restore an available report. Cancelled analyses can be started again.</p></details>
      <details><summary>My video is silent, black or audio-only</summary><p>Studio reports what it can observe and leaves unsupported artistic scores blank. Add an audible track or meaningful video frames if you want feedback that depends on them. Intentional silence or a slow edit is not automatically a bad creative choice.</p></details>
      <details><summary>A report or temporary upload has expired</summary><p>Choose the original file again to start a new analysis. Deleted reports cannot be restored here. Export your report before deleting it if you want to keep it.</p></details>
    </section>

    <section id="contact" className="help-section help-contact" aria-labelledby="contact-heading">
      <h2 id="contact-heading">Need more help?</h2>
      {SUPPORT_CONTACT.active
        ? <><p>For questions about Lolixco, contact our support team. Avoid attaching private videos unless requested.</p><a className="help-action" href={`mailto:${SUPPORT_CONTACT.email}`}>{SUPPORT_CONTACT.email} <ArrowUpRight size={16} aria-hidden="true" /></a></>
        : <p>Email support is being prepared. For now, use the troubleshooting guidance above. A contact address will appear here when it is ready to receive messages.</p>}
    </section>
  </section>;
}
