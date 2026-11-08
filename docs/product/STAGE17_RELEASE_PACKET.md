# Stage 17 — branding, discovery and policy preparation

No public deployment, DNS, AWS, email routing, billing or indexing submission was performed. This packet extends the Stage 16 release gates; it does not make the trusted development analyzer a public multi-user service.

## Official assets

All four supplied attachments were present. `public/brand/official` contains the original path-only SVG (1254×1254), original PNG (1254×1254), exact original OG PNG (1200×630, 776,531 bytes), and the ZIP's ICO, 16/32px PNGs, 180px Apple icon and 192/512px Android icons. `inventory.json` records byte hashes. SVG inspection found no scripts, foreignObject, embedded images, event handlers or external references. The existing approved wordmark remains; the official symbol supplies browser/home-screen icons. Aspect ratios and original colors are preserved. Safari receives SVG/ICO fallbacks and an Apple touch icon; no unsuitable multicolor pinned-tab mask was fabricated. The manifest declares standalone presentation, not offline support or a service worker.

## Canonical pages and initial HTML

| Canonical path | Title | Exact meta description |
| --- | --- | --- |
| `/` | Lolixco \| Discover Edits | Discover curated edits across anime, movies, series and gaming. Watch Shorts and explore your own editing choices in Creator Studio. |
| `/shorts` | Shorts \| Lolixco | Discover short-form edits across your favorite worlds. Watch curated Shorts and open their original YouTube sources. |
| `/creator-studio` | Creator Studio \| Lolixco | Upload an edit or paste a public YouTube link for six experimental editing assessments, evidence and practical feedback. |
| `/explore` | Explore \| Lolixco | Explore curated video edits by category, fandom, creator and tag on Lolixco. |
| `/immersion` | Immersion \| Lolixco | Watch available curated edits in a focused viewing experience with Lolixco Immersion. |
| `/help` | Help & Support \| Lolixco | Get help with Lolixco discovery, Shorts, Creator Studio, upload limits, experimental scores and processing privacy. |
| `/privacy` | Privacy Policy \| Lolixco | Learn how Lolixco handles processing choices, uploads, reports, third-party media and experimental AI feedback. |
| `/rights` | Copyright & Rights \| Lolixco | Understand ownership, embedded third-party content, distribution permissions and rights enquiries on Lolixco. |
| `/terms` | Terms of Use \| Lolixco | Read the public-beta terms for using Lolixco discovery and experimental edit feedback. |
| `/beta` | Public Beta \| Lolixco | Learn what Lolixco BETA means, how experimental assessments work and which release limitations remain. |

Descriptions and meaningful page-specific fallback content come from `src/config/publicPages.js`. The Vite plugin writes a separate static HTML entry for every path; each has a unique description, one primary H1, canonical HTTPS URL, crawlable destination links and complete Open Graph/X large-image metadata. React replaces the initial content when available. This is static content preparation, not server-side rendering of private jobs. The homepage has truthful WebSite structured data, with no invented Organization or incorporation claims. Existing `?view=studio`, `?view=shorts`, `?view=help` and other supported query links remain usable; clean direct entry retains its canonical path on refresh.

The OG URL is `https://lol.golixco.com/brand/official/og-image.png`, with secure URL/type/dimensions/alt and X `summary_large_image`. Local raw HTTP assertions verify metadata without JavaScript and exact asset bytes. This prepares Open Graph consumers such as Meta/WhatsApp, LinkedIn, Discord, Telegram and iMessage, plus X's large-image format. No actual platform fetched the public domain during this mission. Instagram captions and other unsupported surfaces need not show cards. Platform caches and rendering remain outside this build's control. [Open Graph protocol](https://ogp.me/).

Default builds are staging artifacts: robots disallow crawling and HTML is noindex. `LOLIXCO_PUBLIC_RELEASE=1 pnpm exec vite build --outDir dist-public` creates an explicitly indexable candidate; it grants no deployment permission. Generated robots, sitemap and llms files contain only the ten canonical public pages. llms.txt is descriptive Markdown, not an indexing guarantee or access control. Job/query HTML and the local analysis service carry noindex; personal results and uploads are not embedded into static HTML or included in the sitemap.

## Delivery and postlaunch checks

`config/cloudfront-public-routes.js` is an unattached viewer-request candidate: known paths map to their static entry, legacy view queries select the matching entry, job URLs select a generic noindex shell, APIs remain APIs, and unknown documents return 404 rather than a blanket Home response. Before attaching it, review the exact distribution and existing preview gate, origin permissions and behaviors. URI rewrites do not change the originally selected cache behavior or origin. Keep the entry-document behavior minimum TTL zero as well as the `/api/*` and private-HTML behaviors; configure APIs with caching disabled; set private responses to no-store and noindex. Do not use static routing as report authorization. [AWS event and URI semantics](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-event-structure.html). The private multi-user backend, ownership controls and spend limits remain Stage 16 blockers.

`config/public-delivery.json` proposes CSP, nosniff, referrer/permissions policies and HSTS for the approved HTTPS domain. CSP explicitly supports the current YouTube and thumbnail origins; it forbids objects and framing. React currently uses inline styles, so styles allow unsafe-inline, while scripts do not. These proposed headers require HTTPS-edge/browser verification before activation; HTTP loopback QA does not prove production CSP/HSTS behavior. Do not apply HSTS to unrelated domains or enable includeSubDomains/preload without separate review. No F12/right-click restrictions were added.

After approved domain/TLS and public release: fetch all canonical pages and the OG image unauthenticated with ordinary and legitimate social-crawler user agents; verify correct HTML/image MIME types and status, no challenge on public assets, cache headers and HTTPS redirects. Use Meta Sharing Debugger and LinkedIn Post Inspector, then practical X/WhatsApp/Discord/Telegram/iMessage shares. Refresh platform caches where tools permit. Keep authenticated/private API routes separate from public-asset crawl access.

For Google: verify the domain in Search Console using an owner-approved method, submit `/sitemap.xml`, inspect the ten canonical URLs, request indexing where offered, monitor coverage and Google-selected canonicals, then monitor title/sitelink presentation. Bing Webmaster Tools can receive the same verified sitemap. Clear hierarchy and descriptive links help discovery, but neither rankings nor sitelinks can be forced. [Google sitelinks](https://developers.google.com/search/docs/appearance/sitelinks), [canonical guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), [JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics).

The detailed backend/security and AWS findings remain in [Stage 16 readiness](../infra/STAGE16_RELEASE_READINESS.md), including missing public API routing, WAF/logging readiness and owner-bound job isolation. The Stage 17 secret/artifact/privacy checks supplement that review; no fresh AWS account inspection was performed.

## Policies and actual data handling

Privacy, Copyright & Rights, Terms of Use and Public Beta pages are review drafts, not legal approval. They distinguish Golixco branding from unverified incorporation; original Lolixco assets from third-party works; and embeds from redistribution permission. The 30 hosted candidates remain unpublished pending picture/audio rights. Lolixco is not an official Google/YouTube service.

The application stores separate remembered processing choices in localStorage; no intentional app cookies, sessionStorage or IndexedDB use was found in frontend source. Videos use browser object URLs before analysis; the configured server receives uploaded media only on analysis. Current development storage retains idle uploads for an hour, deletes derived copies after processing/cancellation and retains reports until deletion. Google receives consented renditions or public URLs. YouTube embeds/thumbnails and server/delivery requests expose network metadata to their providers, which can have their own storage/logging. No blanket stateless/no-data/no-training/zero-retention promise is made. Public retention, operator identity, request procedures and third-party project terms require approval/legal review.

`support@golixco.com` and `rights@golixco.com` delivery remain unverified; neither is advertised as an active mail link. MX records alone cannot verify a recipient rule. No email was sent and no routing was changed.

## Verification and remaining gates

All 79 focused route/branding/history tests and 51 backend regressions passed; staging and public-candidate builds and the artifact scanner passed. Real Linux Chromium exercised HTTP and rendered routes at 320/768/1440px and DPR2 with reduced motion enabled, including one H1, titles, clean-path persistence and no page errors/overflow. Firefox and WebKit executables were absent; these were not Safari, Windows, Edge, iOS, Android or in-app device tests. Those browser/device checks remain release QA requirements, especially touch installation and tab icons. Local icon fetches do not establish physical-device home-screen rendering.

Screenshots and receipts are in `/home/rohan/lolixco-stage17-evidence`. The public domain has not been exposed for Google or social crawling, so actual public OG retrieval, indexing and sitelinks remain unverified. Other launch blockers remain public AI isolation/admission/cost controls, provider policy and retention approval, verified contact delivery, legal review, hostname/TLS/preview-gate approval and hosted-media rights. No scoring architecture was rewritten.
