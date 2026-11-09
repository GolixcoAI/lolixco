export const PUBLIC_ORIGIN = "https://lol.golixco.com";
export const PUBLIC_PAGES = [
  {
    "path": "/",
    "view": "Home",
    "title": "Lolixco | Discover Edits",
    "heading": "Discover edits",
    "description": "Discover curated edits across anime, movies, series and gaming. Watch Shorts and explore your own editing choices in Creator Studio.",
    "paragraphs": [
      "Great edits. Fresh perspectives. Lolixco brings together curated videos and Shorts from their original publishers.",
      "Explore by category, creator or fandom, or bring your own edit to Creator Studio for experimental feedback."
    ]
  },
  {
    "path": "/shorts",
    "view": "Shorts",
    "title": "Shorts | Lolixco",
    "heading": "Shorts",
    "description": "Discover short-form edits across your favorite worlds. Watch curated Shorts and open their original YouTube sources.",
    "paragraphs": [
      "Find short-form edits across anime, movies, series and gaming. Move between available videos with touch or keyboard controls.",
      "Embedded videos remain subject to their publishers’ availability and playback restrictions."
    ]
  },
  {
    "path": "/creator-studio",
    "view": "Creator Studio",
    "title": "Creator Studio | Lolixco",
    "heading": "Creator Studio",
    "description": "Upload an edit or paste a public YouTube link for six experimental editing assessments, evidence and practical feedback.",
    "paragraphs": [
      "Discover what makes your edit work. Upload a supported video up to 100 MiB and two minutes, or paste a public YouTube link.",
      "Feedback covers audiovisual rhythm, cuts and transitions, pacing, visual craftsmanship, storytelling and coherence, and creative execution. AI assessments are experimental, can be incomplete and are not objective artistic grades. External processing requires permission. Public analysis availability depends on the configured service."
    ]
  },
  {
    "path": "/explore",
    "view": "Explore",
    "title": "Explore | Lolixco",
    "heading": "Explore edits",
    "description": "Explore curated video edits by category, fandom, creator and tag on Lolixco.",
    "paragraphs": [
      "Browse curated edits and discover creators across different worlds. Search by title, creator, tag or fandom.",
      "Lolixco links to and embeds authorized public sources; it does not override access restrictions."
    ]
  },
  {
    "path": "/immersion",
    "view": "Immersion",
    "title": "Immersion | Lolixco",
    "heading": "Immersion",
    "description": "Watch available curated edits in a focused viewing experience with Lolixco Immersion.",
    "paragraphs": [
      "A focused viewing queue for discovering edits with fewer distractions. Choose Enter Immersion to begin.",
      "Playback depends on the original publisher. You can exit the viewer at any time."
    ]
  },
  {
    "path": "/help",
    "view": "Help & Support",
    "title": "Help & Support | Lolixco",
    "heading": "Help & Support",
    "description": "Get help with Lolixco discovery, Shorts, Creator Studio, upload limits, experimental scores and processing privacy.",
    "paragraphs": [
      "Watch edits on Home and Explore, search for a creator or fandom, and move between Shorts with the on-screen controls.",
      "Creator Studio supports files up to 100 MiB and two minutes. Missing audio or meaningful video can leave assessments incomplete. If a source is unavailable, choose another edit. Restore your connection and retry interrupted work.",
      "Need help? Contact support@golixco.com. Avoid attaching private videos unless requested. For general enquiries, contact hello@golixco.com."
    ]
  },
  {
    "path": "/privacy",
    "view": "Privacy Policy",
    "title": "Privacy Policy | Lolixco",
    "heading": "Privacy Policy",
    "description": "Learn how Lolixco handles processing choices, uploads, reports, third-party media and experimental AI feedback.",
    "paragraphs": [
      "Lolixco is a public-beta product under the Golixco brand. Accounts are not required. A secure, HttpOnly session cookie keeps your uploads and reports separate from other visitors; it expires after 24 hours. Clearing it removes access to your private analyses.",
      "An opaque analysis reference is kept in tab session storage so you can reconnect after navigation; it does not grant access without your private session cookie. The frontend stores separate file and public-link processing choices in localStorage under lolixco.analysis-privacy.v1. Change them in Analysis privacy. Changes affect future work and cannot undo processing already performed. Videos are not stored in browser storage.",
      "Selecting a file creates a browser preview. Starting analysis sends it directly to private AWS storage. Upload access expires after one hour; report access expires after 24 hours. Derived worker files are removed after processing or cancellation. Expired stored files are swept every 15 minutes, with a one-day S3 lifecycle backup. Scheduled deletion and provider retention are not instantaneous. Export a report before deleting it if you wish to keep it.",
      "Uploading for analysis does not publish your work to discovery. With permission, Google receives a temporary video/audio rendition or a public YouTube URL for AI feedback. Google’s API terms govern processing, retention and potential product-improvement use, which vary by configuration. Lolixco does not promise zero provider retention or no product-improvement use. Read https://ai.google.dev/gemini-api/terms and https://policies.google.com/privacy.",
      "YouTube embeds and thumbnail requests contact Google and may disclose network/browser information or use third-party storage. AWS processes delivery and security metadata. Application operational logs are kept for seven days and exclude media contents, provider credentials and report text.",
      "For privacy questions or deletion assistance contact support@golixco.com. For general enquiries contact hello@golixco.com. These incoming addresses forward to our operator; a custom-address outbound identity is not asserted."
    ]
  },
  {
    "path": "/rights",
    "view": "Copyright & Rights",
    "title": "Copyright & Rights | Lolixco",
    "heading": "Copyright & Rights Policy",
    "description": "Understand ownership, embedded third-party content, distribution permissions and rights enquiries on Lolixco.",
    "paragraphs": [
      "Original Lolixco branding and product materials are distinct from third-party footage, music, characters, artwork and videos. Underlying works belong to their respective owners. Lolixco does not claim ownership of them.",
      "Public embedded videos remain on their source platform and are subject to its rules, availability and restrictions. An embed or disclaimer does not grant permission to download, redistribute or commercially exploit underlying works. Lolixco is independent of YouTube and Google.",
      "The owner has authorized publication of the 30 Lolixco-hosted edits for this release candidate and states that publication permissions are handled. Attribution remains pending where an editor has not been verified; no creator identity is invented.",
      "For copyright, content ownership or removal enquiries contact rights@golixco.com. Include the affected Lolixco URL, the work concerned, your connection to its owner, your requested action and a contact address. We review and respond to substantiated requests. Do not send unnecessary sensitive documents."
    ]
  },
  {
    "path": "/terms",
    "view": "Terms of Use",
    "title": "Terms of Use | Lolixco",
    "heading": "Terms of Use",
    "description": "Read the public-beta terms for using Lolixco discovery and experimental edit feedback.",
    "paragraphs": [
      "Lolixco is a public-beta product under the Golixco brand. General enquiries: hello@golixco.com. Support: support@golixco.com. Rights enquiries: rights@golixco.com. The Golixco brand reference does not assert legal incorporation.",
      "Use the service lawfully and submit only media you are entitled to process and share with the chosen providers. Do not upload unauthorized sensitive information, malicious files or material that violates others’ rights. Do not bypass access controls, access other visitors’ reports, automate abusive requests or evade usage limits.",
      "AI feedback is experimental and may be inaccurate, incomplete, inconsistent or overly generous. It is not a verified source identification, objective artistic grade or professional advice. Review the evidence and make your own editing decisions.",
      "Source-platform availability and restrictions can change. Beta functionality may change or be interrupted. No uptime, scoring accuracy, indexing or social-preview guarantee is made. Conservative daily processing limits apply.",
      "Analysis uploads are private and do not publish your work or transfer ownership to Lolixco. External processing follows your permission and provider terms. Consult the Privacy and Rights policies. Applicable consumer rights and mandatory law are not displaced by this notice."
    ]
  },
  {
    "path": "/beta",
    "view": "Public Beta",
    "title": "Public Beta | Lolixco",
    "heading": "Lolixco BETA",
    "description": "Learn what Lolixco BETA means, how experimental assessments work and which release limitations remain.",
    "paragraphs": [
      "Lolixco is a creative-media discovery and editing-feedback product under the Golixco brand. BETA describes the release stage; Experimental AI Assessment describes limitations of the scoring methodology.",
      "The AWS release candidate connects 27 public YouTube edits and 30 owner-authorized hosted edits with search, Shorts, Immersion and Creator Studio. Source availability and YouTube embedding restrictions can change.",
      "Creator Studio uses isolated cloud jobs, private temporary uploads and conservative quotas. Missing evidence remains unassessed. AI scores, including high scores, do not establish validated accuracy.",
      "This temporary CloudFront release is available for owner inspection. The final custom hostname and public indexing require a separate release decision. Contact hello@golixco.com with general enquiries or support@golixco.com for help."
    ]
  }
];
export function pageForView(view) { return PUBLIC_PAGES.find(page=>page.view===view); }
