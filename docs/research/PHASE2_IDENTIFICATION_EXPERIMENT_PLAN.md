# LOLIXCO EDIT DNA — PHASE 2 IDENTIFICATION EXPERIMENT PLAN
## SOURCE & MUSIC IDENTIFICATION TEST DESIGN: JJK, SPIDER-MAN, DOCTOR DOOM & TRANSFORMED AUDIO
**Document ID:** `docs/research/PHASE2_IDENTIFICATION_EXPERIMENT_PLAN.md`  
**Mission:** Antigravity Mission 2 (Practical Identification Benchmark Design)  
**Status:** Approved Experimental Design Protocol (Zero-Cost / Permissioned)  
**Author:** Antigravity AI Engineering & Research  
**Target Platform:** Lolixco Video Intelligence Engine ("Lolixco Edit DNA")

---

### EXECUTIVE SUMMARY

Following Phase 2's empirical signal processing measurements, the next phase focuses on **identifying visual source material and musical tracks**. This document specifies a reproducible, permissioned benchmark protocol designed to test:
1. **Franchise & Character Identification:** Testing discriminative accuracy across *Jujutsu Kaisen* (Gojo, Sukuna), *Spider-Man* (Spider-Verse, MCU), and *Doctor Doom* (MCU/Marvel), alongside unknown and deliberately adversarial distractor clips.
2. **Music Identification Under Transformations:** Testing acoustic fingerprinting (AcoustID) and feature matching across clean, pitch-shifted, slowed-and-reverbed, and phonk remakes.
3. **Safety & Zero-Cost Compliance:** All test assets utilize authorized local media, royalty-free audio stems, or public YouTube URLs analyzed strictly through documented API endpoints with zero unauthorized downloads and zero unapproved cloud spend.

---

### 1. VISUAL SOURCE IDENTIFICATION BENCHMARK DESIGN

#### 1.1 The 12-Clip Visual Test Matrix

| Cohort | Target Source / Character | Key Visual Markers | Adversarial Factor / Distortion | Expected Model Behavior |
| :--- | :--- | :--- | :--- | :--- |
| **JJK-01** | *Jujutsu Kaisen* — Satoru Gojo | Blindfold, blue Infinity aura, white hair | Clean original anime colors | Top-1: *Jujutsu Kaisen*, Character: Gojo (High Confidence) |
| **JJK-02** | *Jujutsu Kaisen* — Ryomen Sukuna | Facial markings, black kimono, fire arrows | Heavy color inversion / magenta recolor | Top-1: *Jujutsu Kaisen*, Character: Sukuna (Resilient to recolor) |
| **JJK-03** | *Jujutsu Kaisen* — Minor / Background | Megumi's shikigami / background curse | Extreme silhouette / rapid whip-pan | Franchise: *JJK*, Character: Abstain or list candidate |
| **SPM-01** | *Spider-Man: Into the Spider-Verse* — Miles | Halftone dots, red/black spray suit, Brooklyn | Clean animation style | Top-1: *Spider-Verse*, Character: Miles Morales |
| **SPM-02** | *Spider-Man: No Way Home* — Peter Parker | Live-action MCU suit, iron spider legs | Heavy dark grade / motion blur | Top-1: *Spider-Man (MCU)*, Character: Peter Parker |
| **SPM-03** | *Spider-Man* — Distractor | Generic red/blue superhero in comic style | Custom Blender 3D render (Not Marvel) | **Abstain / Flag as Custom / Non-Canon** |
| **DOM-01** | *Doctor Doom* — Marvel Canon | Green tunic, metallic iron mask, Latverian runes | Classic comic / game cinematic | Top-1: *Marvel / Fantastic Four*, Character: Doctor Doom |
| **DOM-02** | *Doctor Doom* — MCU Teaser / Speculative | Green energy cloaks, armored gauntlets | Dark lighting / fast combat cuts | Character: Doctor Doom (Candidate status if ambiguous) |
| **UNK-01** | Unknown Indie Animation | Original anime-style student project | High quality, resembles MAPPA art style | **Abstain: "unknown_source" (Must not guess JJK)** |
| **UNK-02** | 3D Game Engine Demo (Unreal Engine 5) | Realistic fantasy knight in dark armor | Dark cinematic lighting (resembles Batman) | **Abstain: "unknown_source" (Must not guess DC/Batman)** |
| **MIS-01** | Deliberately Misleading Clip | Anime character with Spider-Man logo edited on | Spliced fan mashup | Identify base anime + flag mashup anomaly |
| **MIS-02** | Obscure 1980s Mecha Anime | Retro hand-drawn cels, grain, retro lasers | Vintage aesthetic | Top-1: Identify retro style or abstain from modern titles |

#### 1.2 Evaluation Metrics for Visual Identification
- **Franchise Top-1 Accuracy:** Percentage of canon clips where correct franchise is the top prediction.
- **Character Top-1 Accuracy:** Percentage of character-centric clips where primary character is correctly named.
- **Unknown Rejection Rate (URR):** Percentage of unknown/distractor clips correctly classified as `"unknown_source"` (Target: $\ge 85\%$).
- **Hallucination Rate:** Frequency with which an unknown or indie clip is asserted as a mainstream franchise with $>80\%$ reported confidence (Target: $\le 5\%$).

---

### 2. MUSIC IDENTIFICATION BENCHMARK DESIGN

#### 2.1 The 8-Variation Audio Matrix
Using permissioned audio tracks (e.g., royalty-free electronic/phonk stems and licensed test stems), we generate 8 systematic variations:

| Variation ID | Transformation Applied | Description | Expected AcoustID Behavior | Expected Lolixco Recovery |
| :--- | :--- | :--- | :--- | :--- |
| **MUS-01** | Clean Original (Full 30s) | Unaltered 44.1kHz stereo track | Match (AcoustID hash matches DB) | Exact Title, Artist, ISRC |
| **MUS-02** | Clean Short Snippet (5.0s) | 5-second cut snippet | **Expected Failure (Insufficient entropy)** | Flag: Snippet too short for Chromaprint |
| **MUS-03** | Pitch Shift (-2 Semitones) | Lowered pitch by 200 cents (same tempo) | **Expected Failure (Chroma bin shift)** | Normalize pitch $\to$ Retry fingerprint |
| **MUS-04** | Pitch Shift (+2 Semitones) | Nightcore style pitch increase | **Expected Failure (Chroma bin shift)** | Normalize pitch $\to$ Retry fingerprint |
| **MUS-05** | Slowed + Reverb (0.85x speed) | Time-stretched by 15%, reverb impulse added | **Expected Failure (Temporal interval stretch)**| Normalize tempo $\to$ Retry fingerprint |
| **MUS-06** | Sped-Up (1.15x speed) | Sped up by 15% (same pitch) | **Expected Failure (Temporal compression)** | Normalize tempo $\to$ Retry fingerprint |
| **MUS-07** | Phonk Bass Boost & Clip | High-pass filtered dialogue + 808 sub-bass | Moderate failure risk | Report tempo (BPM) + genre tags |
| **MUS-08** | Unindexed Indie Track | Completely unreleased original composition | **Abstain: Unmatched Track** | Report BPM, key, loudness; no fake title |

#### 2.2 Audio Evaluation Metrics
- **Clean Match Accuracy:** Success rate on MUS-01 (Target: $\ge 90\%$).
- **Short-Snippet Failure Documentation:** Measure exact minimum audio length required for Chromaprint confidence (test at 3s, 5s, 10s, 15s, 20s).
- **Pitch-Inversion Recovery Rate:** Success rate after applying inverse pitch shifting prior to fingerprint lookup (Target: $\ge 50\%$).
- **Abstention Accuracy on Unindexed Music:** Percentage of unreleased tracks correctly tagged as `"unmatched_track"` without hallucinatory song attributions (Target: $100\%$).

---

### 3. THE SMALLEST NEXT EXPERIMENT (RECOMMENDED NEXT STEP)

To execute this plan with zero risk and zero cloud spend:
1. **Asset Selection:**
   - 1 authorized permissioned video edit featuring *Jujutsu Kaisen* (Satoru Gojo) with a known background track.
   - 1 negative control clip (non-JJK anime or 3D render).
2. **Visual Step:** Run keyframe extraction via `scripts/edit-dna/offline_analyzer.py` and test local SigLIP / visual feature matching against canon reference frames.
3. **Audio Step:** Test Chromaprint extraction on:
   - Original audio (full).
   - 5-second snippet.
   - Pitch-shifted (-2 semitones) variation.
4. **Outcome:** Measures real-world recognition limits on a concrete, permissioned sample pair before expanding to bulk datasets.

