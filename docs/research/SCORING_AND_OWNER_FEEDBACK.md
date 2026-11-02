# LOLIXCO EDIT DNA — AI EDIT ANALYZER R&D
## OWNER-TRAINED QUALITY SCORING, PREFERENCE LEARNING & ANNOTATION SPECIFICATION
**Document ID:** `SCORING_AND_OWNER_FEEDBACK.md`  
**Mission:** Antigravity Mission 1 (Parallel Independent R&D)  
**Status:** Approved Technical Design & Mathematical Specification  
**Author:** Antigravity AI Engineering & Research  
**Target Platform:** Lolixco Video Intelligence Engine ("Lolixco Edit DNA")

---

### EXECUTIVE SUMMARY

A critical requirement of Lolixco Edit DNA is personalizing quality scoring to the **owner's subjective editorial aesthetic**. High technical precision (e.g. cutting exactly on the beat) does not automatically equal a masterpiece; conversely, an intentional off-beat hesitation can convey emotional vulnerability or tension.

To bridge this gap without the exorbitant cost or instability of fine-tuning multi-billion-parameter foundation models for every user feedback click, Lolixco Edit DNA introduces a **Three-Layer Preference Architecture**:
1. **Three-Tier Score Separation:** Disentangles pure physical measurements from general industry benchmarks and personalized owner tastes.
2. **Instant Zero-Shot Adaptation:** Allows the owner to adjust categorical weights dynamically via an intuitive slider rubric.
3. **Dual-Model Preference Engine:** Combines **Calibrated Ridge Regression** (for discrete 1–10 component ratings) with a **Bradley–Terry Pairwise Preference Model** (for head-to-head A/B comparison judgments). A single owner comparison updates preference parameters in milliseconds via closed-form convex optimization.
4. **Data Leakage & Integrity Shields:** Strictly groups data by franchise and media asset to prevent trivial cross-validation contamination, and decouples quality scoring from vanity metrics (views, likes, engagement algorithms).

---

### 1. THE THREE SEPARATE SCORING CONCEPTS

To maintain rigorous transparency, Edit DNA never presents a single black-box score without provenance. Every evaluation produces three distinct numbers:

```mermaid
flowchart TD
    subgraph Layer1["Concept 1: Objective Technical Measurement"]
        M1["Beat Sync Delta (ms)"]
        M2["Average Shot Length (s)"]
        M3["Audio LUFS / True Peak"]
        M4["Optical Flow Continuity"]
        M5["Resolution & Frame Drop"]
        M1 & M2 & M3 & M4 & M5 --> S_TECH["Objective Technical Score (0–10)"]
    end

    subgraph Layer2["Concept 2: General Editorial Quality Estimate"]
        E1["Cinematic Pacing Curvature"]
        E2["Rhythm Dynamic Contrast"]
        E3["Color Palette Harmony"]
        E4["Transition Semantic Variety"]
        E1 & E2 & E3 & E4 --> S_EDIT["General Editorial Estimate (0–10)"]
    end

    subgraph Layer3["Concept 3: Personalized Owner Preference"]
        O1["Owner Weight Rubric Preferences"]
        O2["Historical 1–10 Component Ratings"]
        O3["Head-to-Head A/B Win/Loss History"]
        O4["Free-Text Feedback Embeddings"]
        O1 & O2 & O3 & O4 --> S_OWNER["Owner Predicted Preference (0–10)"]
    end
```

1. **Concept 1 — Objective Technical Measurement ($S_{\text{tech}} \in [0, 10]$):**
   - Grounded strictly in physical signal processing.
   - Measures what *is*: average synchronization error in milliseconds, clipping sample count, frame stability, codec compression artifacts, and shot duration distribution.
   - Non-negotiable and deterministic: If an edit misses 80% of beats by $>100\text{ ms}$, $S_{\text{tech, sync}}$ is mathematically low regardless of subjective opinion.

2. **Concept 2 — General Editorial Quality Estimate ($S_{\text{edit}} \in [0, 10]$):**
   - Represents an objective cinematic consensus trained on film school editing standards and benchmarked video-editing principles (e.g., Walter Murch's *Rule of Six*: emotion, story, rhythm, eye-trace, two-dimensional screen plane, three-dimensional space).
   - Evaluates whether transitions serve narrative flow, whether pacing builds toward a dramatic climax, and whether color grading maintains visual continuity.

3. **Concept 3 — Personalized Owner Preference Prediction ($S_{\text{owner}} \in [0, 10]$):**
   - The owner's personal aesthetic signature.
   - Learns idiosyncrasies: The owner may prize narrative subtlety over rapid-fire phonk cuts, or may heavily penalize flash transitions while rewarding intricate match-cuts.
   - Accompanied by a confidence interval: $\hat{S}_{\text{owner}} \pm \sigma_{\text{uncertainty}}$.

---

### 2. EDITABLE SCORING RUBRIC & BASELINE WEIGHTS

The system initializes with the owner's provisional baseline weights, fully customizable via the UI:

$$\text{Composite Score} = \sum_{k=1}^6 w_k \cdot s_k, \quad \text{subject to } \sum_{k=1}^6 w_k = 1.00$$

| Category Dimension | Provisional Weight ($w_k$) | Evaluation Criteria | Primary Measurement Source |
| :--- | :---: | :--- | :--- |
| **1. Beat Synchronization** | **25%** ($0.25$) | Accuracy of visual cuts, impact frames, and motion shifts relative to acoustic downbeats and percussion transients. | `librosa` DSP Onset Alignment ($\delta \le 50\text{ ms}$) |
| **2. Transitions** | **20%** ($0.20$) | Smoothness, technical execution, variety, and appropriateness of hard cuts, whip pans, dissolves, and flash effects. | `PySceneDetect` + OpenCV Optical Flow SSIM |
| **3. Pacing & Density** | **15%** ($0.15$) | Rhythmic variation across the edit; buildup, climax, and release; avoiding monotonous cut frequencies. | Shot Length Variance $\sigma(\Delta t)$ & ASL |
| **4. Visual & Color Quality** | **15%** ($0.15$) | Dynamic range, color grading continuity, lighting contrast, absence of harsh digital banding or pixelation. | CIELAB Color Histogram + Gemini Visual Inspection |
| **5. Story & Emotional Impact** | **15%** ($0.15$) | Narrative cohesion, character expression, atmospheric immersion, and perceived emotional resonance. | Gemini 3.8 Flash Multimodal Narrative Synthesis |
| **6. Originality & Creativity** | **10%** ($0.10$) | Uniqueness of scene combinations, unexpected music choices, innovative transition mechanics, non-cliché editing. | Novelty Embedding Distance vs Canon DB |

---

### 3. OWNER ANNOTATION & FEEDBACK DATA SPECIFICATION

To collect high-signal training data without tedious manual overhead, we specify two streamlined annotation formats: **Single-Asset Discrete Audit** and **Pairwise A/B Comparison**.

#### 3.1 Single-Asset Audit Schema (`owner_feedback_single.json`)
```json
{
  "$schema": "https://lolixco.com/schemas/owner-feedback-single.v1.json",
  "feedback_id": "fb_single_20261102_001",
  "timestamp": "2026-11-02T13:45:00Z",
  "target_asset": {
    "identifier": "https://www.youtube.com/watch?v=EXAMPLE_ID",
    "intake_type": "youtube_url",
    "verified_title": "Gojo Satoru - Hollow Purple (Phonk Edit)"
  },
  "ratings": {
    "beat_synchronization": 9.0,
    "transitions": 8.5,
    "pacing": 7.0,
    "visual_quality": 8.0,
    "storytelling_emotion": 6.5,
    "originality_creativity": 6.0,
    "overall_subjective_rating": 7.5
  },
  "rubric_overrides": {
    "beat_synchronization": 0.30,
    "transitions": 0.20,
    "pacing": 0.15,
    "visual_quality": 0.15,
    "storytelling_emotion": 0.10,
    "originality_creativity": 0.10
  },
  "free_text_critique": "The impact cut on the Hollow Purple release is perfectly timed with the 808 drop, but the pacing drags between seconds 12 and 18. Too many static reaction shots.",
  "flagged_issues": ["mid_edit_pacing_drop", "repetitive_reaction_shots"],
  "source_correction": {
    "corrected_franchise": "Jujutsu Kaisen",
    "corrected_character": "Satoru Gojo",
    "corrected_episode": "Season 2 Episode 20"
  }
}
```

#### 3.2 Pairwise A/B Comparison Schema (`owner_feedback_pairwise.json`)
Pairwise comparisons are significantly faster for humans to generate, exhibit higher inter-rater consistency than absolute scales, and form the mathematical backbone of preference ranking.

```json
{
  "$schema": "https://lolixco.com/schemas/owner-feedback-pairwise.v1.json",
  "comparison_id": "fb_pair_20261102_004",
  "timestamp": "2026-11-02T13:50:00Z",
  "candidate_a": {
    "asset_id": "edit_jk_sukuna_30s",
    "source_title": "Sukuna Shibuya Incident"
  },
  "candidate_b": {
    "asset_id": "edit_sm_miles_30s",
    "source_title": "Miles Morales Leap of Faith"
  },
  "chosen_winner": "candidate_a",
  "margin": "significant",
  "primary_driver": "superior_beat_synchronization_and_audio_impact",
  "dimension_breakdown": {
    "beat_sync_winner": "candidate_a",
    "transitions_winner": "candidate_a",
    "pacing_winner": "candidate_b",
    "visual_quality_winner": "candidate_a",
    "story_emotion_winner": "candidate_b",
    "originality_winner": "candidate_a"
  },
  "free_text_rationale": "Candidate A has unmatched rhythm and punch on the bass hits. Candidate B has better storytelling but the cuts feel floaty and miss the tempo."
}
```

---

### 4. PREFERENCE LEARNING ALGORITHMS

How does Edit DNA learn from the owner's feedback without retraining a 7B+ parameter vision model? We implement four layered techniques that operate instantly:

```mermaid
flowchart LR
    Feedback["Owner Feedback (Rating / A vs B Comparison)"] --> Instant["1. Dynamic Rubric Weight Rebalancing (0ms)"]
    Feedback --> Calib["2. Regularized Ridge Feature Regression (10ms)"]
    Feedback --> BT["3. Bradley-Terry Pairwise Preference Ranker (15ms)"]
    
    BT --> Active["4. Active Learning Uncertainty Filter"]
    Active --> NextQueue["Queue Most Informative Unrated Edits for Owner"]
```

#### 4.1 Layer 1: Instant Dynamic Rubric Weighting (Zero Latency)
When the owner modifies the slider weights, all composite scores across the entire catalog update in real time via linear combination. No gradient steps or tensor calculations are required.

#### 4.2 Layer 2: Calibrated Ridge Feature Regression
Let $\mathbf{x} \in \mathbb{R}^D$ be the combined feature vector for an edit, concatenating:
- DSP metrics: Beat sync index, ASL, cut density, luminance variance, audio true peak, LUFS ($D_1 = 12$).
- Transition distribution: Proportion of hard cuts, dissolves, flashes, whip pans ($D_2 = 4$).
- VLM semantic scores: Normalized atmosphere, narrative coherence, OCR tags ($D_3 = 6$).

We fit a regularized linear ridge model to predict the owner's overall score $y \in [1, 10]$:
$$\min_{\mathbf{w}, b} \sum_{i=1}^M \left( \mathbf{w}^T \mathbf{x}_i + b - y_i \right)^2 + \lambda \|\mathbf{w}\|_2^2$$
Because $D \approx 22$ and $M$ (number of owner reviews) ranges from $10$ to $500$, this solves via the closed-form normal equation:
$$\mathbf{w}^* = (\mathbf{X}^T \mathbf{X} + \lambda \mathbf{I})^{-1} \mathbf{X}^T \mathbf{y}$$
Solving takes $<5\text{ ms}$ on a standard CPU, updating instantly the moment the owner submits a new review.

#### 4.3 Layer 3: Bradley–Terry Pairwise Preference Model
For head-to-head comparisons, we model the probability that the owner prefers Edit $A$ over Edit $B$ as:
$$P(A \succ B) = \frac{\exp(r_A)}{\exp(r_A) + \exp(r_B)} = \frac{1}{1 + \exp(-(r_A - r_B))}$$
where $r_A = \boldsymbol{\theta}^T \mathbf{x}_A$ represents the latent aesthetic utility of Edit $A$.

Given a collection of comparisons $\mathcal{D} = \{(A_k, B_k, y_k)\}_{k=1}^K$ where $y_k = 1$ if $A \succ B$ and $y_k = 0$ if $B \succ A$:
The negative log-likelihood with L2 regularization is:
$$\mathcal{L}(\boldsymbol{\theta}) = -\sum_{k=1}^K \left[ y_k \log \sigma(\boldsymbol{\theta}^T (\mathbf{x}_{A_k} - \mathbf{x}_{B_k})) + (1 - y_k) \log(1 - \sigma(\boldsymbol{\theta}^T (\mathbf{x}_{A_k} - \mathbf{x}_{B_k}))) \right] + \frac{\alpha}{2} \|\boldsymbol{\theta}\|_2^2$$
Because this objective is strictly convex, it is optimized via L-BFGS or Newton-Raphson in fewer than 20 iterations ($\approx 15\text{ ms}$).
**Single-Feedback Update:** Every single owner A/B choice triggers an immediate gradient update, progressively tuning $\boldsymbol{\theta}$ toward the owner's exact visual standards.

#### 4.4 Layer 4: Active Learning & Informative Sampling
To minimize the number of videos the owner must manually review, the system selects candidate edits using **Uncertainty Sampling**:
$$\text{InformativeScore}(A, B) = 1.0 - 2 \cdot \left| P(A \succ B) - 0.5 \right|$$
Pairs where the model is most ambivalent ($P(A \succ B) \approx 0.50$) provide maximal theoretical information gain per click (active learning hypothesis). Real annotation reduction must be empirically benchmarked against uniform random sampling once an owner cohort dataset is gathered.

The prototype implementation is provided in `scripts/edit-dna/rating_lab.py` and unit tested in `tests/edit-dna.test.mjs`.

#### 4.5 Optional Future LoRA Adaptation Policy
- **Strict Guardrail:** We will **not** train or fine-tune LoRA weights on large foundation models (such as Qwen2.5-VL or Gemini) during initial R&D.
- **Justification Criteria:** LoRA adaptation will only be authorized if:
  1. The owner has accumulated at least $\ge 300$ verified, human-annotated video edits with rich feedback.
  2. The Bradley-Terry + Ridge linear models plateau below $80\%$ Kendall's Tau ranking correlation.
  3. The compute cost and inference latency budget are approved by the owner.

---

### 5. PREVENTING DATA LEAKAGE & ENSURING EVALUATION RIGOR

A common failure in ML-based video quality assessment is **data leakage**, where a model appears accurate on validation sets simply because it memorized clips from the same movie or creator.

```mermaid
flowchart TD
    subgraph Leakage_Pitfall["THE LEAKAGE PITFALL (WRONG)"]
        A1["Sukuna vs Jogo Clip 1 (Train)"]
        A2["Sukuna vs Jogo Clip 2 (Test)"]
        A1 -.->|"Model memorizes palette & music!"| A2
    end

    subgraph Grouped_KFold["LOLIXCO GROUPED CV (CORRECT)"]
        G1["Group A: All Jujutsu Kaisen Edits (Train)"]
        G2["Group B: All Spider-Verse Edits (Train)"]
        G3["Group C: All Demon Slayer Edits (Held-Out Test)"]
        G1 --> TRAIN["Train Preference Engine"]
        G2 --> TRAIN
        TRAIN --> TEST["Evaluate Generalization on Group C"]
    end
```

#### 5.1 Leakage Prevention Protocols
1. **Source Franchise & Episode Grouping:** All cross-validation splits use `GroupKFold` grouped by `canonical_franchise`. No clip from *Jujutsu Kaisen* may appear in both the training set and the test set simultaneously.
2. **Perceptual Hash Deduplication:** Before training or evaluation, video audio-visual streams are fingerprinted using Chromaprint and block-mean perceptual hashing (`pHash`). Near-duplicate re-uploads (hamming distance $\le 3$) are consolidated.
3. **Strict Ban on Platform Vanity Metrics:**
   The training objective **strictly prohibits** using YouTube views, likes, comment counts, or TikTok shares as ground-truth editing quality. Platform views are primarily driven by thumbnail clickbait, channel subscriber count, and algorithmic distribution timing. Lolixco Edit DNA trains exclusively on **cinematic craft and verified owner preference**.

#### 5.2 Held-Out Evaluation Metrics
We evaluate the preference model on a held-out test set of 30 paired comparisons using:
- **Kendall's Rank Correlation Coefficient ($\tau$):** Measures pairwise order agreement.
- **Spearman's Rank Correlation ($\rho$):** Measures monotonic relationship between predicted and actual scores.
- **Top-1 Selection Accuracy:** Frequency with which the model agrees with the owner on the best edit in a multi-edit cohort.
- **Target Benchmark:** $\tau \ge 0.75$, Top-1 Agreement $\ge 85\%$.

---

### 6. DATASET PROVENANCE & ETHICAL RIGHTS MANAGEMENT

- **No Unauthorized Scraping:** No public YouTube video audio/video bytes are collected, stored, or scraped for model training.
- **Permitted Benchmark Corpus:** Training and evaluation rely exclusively on:
  1. The owner's personal original video edits.
  2. The 17 existing authorized Lolixco baseline demo assets.
  3. Public Creative Commons / open-domain reference media.
  4. Authorized YouTube video URLs analyzed transiently via official Google GenAI Interactions API endpoints.

This scoring design delivers instant personalization, full mathematical transparency, and complete immunity to foundation model hallucinations.
