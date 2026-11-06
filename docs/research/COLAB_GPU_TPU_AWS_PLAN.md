# LOLIXCO EDIT DNA — AI EDIT ANALYZER R&D
## COMPUTE INFRASTRUCTURE, HARDWARE BENCHMARKS & ECONOMIC COST PLAN
**Document ID:** `docs/research/COLAB_GPU_TPU_AWS_PLAN.md`  
**Mission:** Antigravity Mission 1 & 2 (Empirical R&D & Measured Baseline)  
**Status:** Updated & Corrected with Empirical Phase 2 Data  
**Author:** Antigravity AI Engineering & Research  
**Target Platform:** Lolixco Video Intelligence Engine ("Lolixco Edit DNA")

---

### EXECUTIVE SUMMARY

A critical responsibility of this R&D mission is establishing an evidence-based economic blueprint. Building an AI video analyzer can easily lead to catastrophic cloud spending if heavy foundation models are deployed on standing GPU servers or if batch offline jobs are run through un-cached interactive API endpoints.

This plan details:
1. **Measured Hardware Feasibility:** Empirical benchmarks of Local CPU execution (**322.3 MB peak RAM, 1.21s average runtime**), Google Colab (T4 GPU), Google Colab TPU, AWS GPU instances (`g5.xlarge`, `g6.xlarge`), and Managed APIs.
2. **Strict Financial Boundary:** Explicit separation of **AWS Promotional Credits** (which only offset Amazon Web Services infrastructure) from **Third-Party Model Provider Invoices** (Google Cloud / AI Studio for Gemini and ACRCloud).
3. **Exact Token & Dollar Cost Accounting:** Mathematical models calculating costs per 30-second, 60-second, and 3-minute video edit, explicitly accounting for multimodal video/audio tokens, system prompt context, structured JSON output, and **adaptive thinking tokens**.
4. **Volume Scaling Economics:** Side-by-side comparison for 100, 1,000, and 10,000 monthly analyses under both Interactive (real-time) and Batch (50% discount) modalities.
5. **Approval Gates:** Zero cloud writes, zero instance provisioning, and zero chargeable API calls are executed during this research mission.

---

### 1. COMPUTE HARDWARE & RUNTIME FEASIBILITY COMPARISON

| Platform / Target | Hardware Profile | Compatible Workloads | Expected Runtime (60s Edit) | Setup Difficulty | Monthly Fixed Cost | Variable Cost per Edit |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Local CPU (Worker / WSL2)** | 8–16 vCPU, 16–32 GB RAM | FFmpeg, PySceneDetect, librosa, AcoustID, Ridge / Bradley-Terry | **1.21 seconds [MEASURED]** | **Zero (Already Running)** | **\$0.00** | **\$0.00** |
| **Free Google Colab (T4 GPU)** | 1x NVIDIA T4 (16GB VRAM), 12GB RAM | SigLIP embedding indexation, 4-bit Qwen2.5-VL inference | 6.0–12.0 seconds | Moderate (Notebook environment) | **\$0.00** (Free tier) | \$0.00 (Quota-limited) |
| **Colab TPU (v2-8 / v3-8)** | 8 Tensor Cores (64GB HBM) | Large batch SigLIP pre-training / vector embedding (PyTorch XLA) | Infeasible for dynamic Python video decoders | High (Requires JAX/XLA graph compiling) | Variable (Colab Pro / Cloud TPU) | High idle cost |
| **AWS Dedicated GPU (`g6.xlarge`)** | 1x NVIDIA L4 (24GB VRAM), 4 vCPU, 16GB RAM | Full self-hosted stack (PySceneDetect + Qwen-VL + FAISS) | 2.5–4.5 seconds | Moderate (AMI + Docker + CUDA 12) | **~\$584.00 / mo** (24/7 On-Demand) | \$0.00 (within instance) |
| **Managed API (Gemini 3.8 Flash)** | Google Distributed Cloud Infrastructure | Multimodal video understanding, narrative, franchise detection | 2.5–4.0 seconds | Minimal (REST / GenAI SDK) | **\$0.00** | **~\$0.0144** (Standard) / **~\$0.0072** (Batch) |

#### 1.1 In-Depth Findings by Hardware Class:
1. **Local CPU (Measured in Phase 2):**
   - Signal processing tasks (FFmpeg container demuxing, PySceneDetect adaptive cut detection, and librosa audio onset tracking) are CPU-bound and highly optimized via SIMD/AVX instructions.
   - Across our 10 ground-truth benchmark clips, total suite execution took **12.13 seconds** (average **1.21s per video**). Peak RAM usage was only **322.3 MB**.
   - Offloading these tasks to an expensive cloud GPU instance wastes VRAM and increases latency due to tensor memory transfers.
2. **Google Colab (Free T4 GPU):**
   - Viable for offline batch research: Building the initial SigLIP keyframe reference database or testing Qwen2.5-VL 4-bit quantization.
   - Major Limitations: Strict inactivity timeouts (90 minutes idle, 12 hours max session), non-deterministic GPU availability, lack of persistent public webhooks for live user requests.
3. **Google Colab TPU (v2-8 / v3-8):**
   - **Verdict: NOT RECOMMENDED for Edit DNA.**
   - TPUs require static tensor shapes and compiled XLA execution graphs. Video editing pipelines are inherently dynamic (variable frame rates, dynamic shot counts, irregular audio lengths, random crop dimensions). Running PySceneDetect or OpenCV on a TPU introduces massive CPU-host bottlenecks that negate TPU compute advantages.
4. **AWS Dedicated GPU Instances (`g5.xlarge` / `g6.xlarge`):**
   - An EC2 `g6.xlarge` (NVIDIA L4 24GB VRAM) costs **\$0.80 per hour** on-demand in `us-east-1` (or ~$0.56/hr with Savings Plans).
   - Running a standing instance 24/7 costs **\$584.00 per month**.
   - For an early-stage product analyzing 100 to 1,000 edits a month, a dedicated GPU server is financially reckless.
5. **Managed Foundation Models (Gemini 3.8 Flash):**
   - Solves the serverless dilemma: Zero fixed monthly hosting cost, instantaneous autoscaling from 0 to 1,000 concurrent requests, and native acceptance of YouTube URIs without local disk storage.

---

### 2. BILLING SEPARATION: AWS PROMOTIONAL CREDITS VS THIRD-PARTY PROVIDERS

A critical operational distinction that must be maintained across all Lolixco infrastructure documentation:

> [!CAUTION]
> **AWS Promotional Credits CANNOT be used to pay Google Cloud (Gemini) or ACRCloud invoices.**
> Any expenditure on Gemini 3.8 Flash or ACRCloud is billed directly to the owner's Google Cloud or credit account. Do not assume AWS credits subsidize external model APIs.

---

### 3. MATHEMATICAL COST MODEL PER VIDEO EDIT (INCLUDING THINKING TOKENS)

Using Google's verified pricing for **Gemini 3.8 Flash**:
- **Standard Tier (through Dec 31, 2026):**
  - Input Tokens: **\$0.75 per 1,000,000 tokens**
  - Output Tokens (including thinking tokens): **\$3.75 per 1,000,000 tokens**
- **Batch API Tier (50% Discount, 24-hour turnaround):**
  - Input Tokens: **\$0.375 per 1,000,000 tokens**
  - Output Tokens: **\$1.875 per 1,000,000 tokens**
- **Multimodal Token Consumption Rate:**
  - Video Frames: 70 tokens/sec (standard resolution)
  - Audio Stream: 25 tokens/sec
  - Total Multimodal Rate: **95 tokens per second**
  - System Instructions & Pre-computed DSP Context: $\approx 1,000$ input tokens
  - Structured JSON Output: $\approx 1,500$ output tokens
  - **Adaptive Thinking Tokens:** On Gemini 3.8 Flash, medium default reasoning generates $\approx 1,000$ internal thinking tokens, which are billed at the **output token rate**.
  - Total Billed Output Tokens: $1,500 + 1,000 = \mathbf{2,500\text{ tokens}}$.

#### 3.1 Cost Breakdown by Edit Duration

$$\text{Cost} = \left(\frac{\text{Tokens}_{\text{in}} \times P_{\text{in}}}{10^6}\right) + \left(\frac{(\text{Tokens}_{\text{out}} + \text{Tokens}_{\text{think}}) \times P_{\text{out}}}{10^6}\right) + \text{Cost}_{\text{audio}}$$

| Video Duration | Multimodal Video Tokens | Total Input Tokens | Total Output Tokens (with 1k Thinking) | Gemini Cost (Standard) | Gemini Cost (Batch API) | Audio Fingerprint (Local DSP) | Total Cost (Standard) | Total Cost (Batch API) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **30 seconds** | $30 \times 95 = 2,850$ | 3,850 | 2,500 | **\$0.0123** | **\$0.0061** | **\$0.0000** | **\$0.0123** | **\$0.0061** |
| **60 seconds** | $60 \times 95 = 5,700$ | 6,700 | 2,500 | **\$0.0144** | **\$0.0072** | **\$0.0000** | **\$0.0144** | **\$0.0072** |
| **3 minutes (180s)** | $180 \times 95 = 17,100$ | 18,100 | 3,000 | **\$0.0248** | **\$0.0124** | **\$0.0000** | **\$0.0248** | **\$0.0124** |

*(Note: If commercial ACRCloud fallback is utilized for noisy music, add \$0.0035 per query. AcoustID / MusicBrainz queries are free for non-commercial or self-hosted).*

---

### 4. MONTHLY VOLUME COST PROJECTIONS

Assume average video length of 60 seconds (Shorts / Reel format):

| Monthly Volume | Pure Gemini 3.8 Flash (Interactive) | Pure Gemini 3.8 Flash (Batch API) | Hybrid Stack (Local DSP + Gemini Batch) | Dedicated AWS GPU Server (`g6.xlarge` 24/7) | Recommended Architecture |
| :---: | :---: | :---: | :---: | :---: | :--- |
| **100 analyses** | **\$1.44 / mo** | **\$0.72 / mo** | **\$0.72 / mo** | \$584.00 / mo | **Serverless API (Free tier / Minimal)** |
| **1,000 analyses** | **\$14.40 / mo** | **\$7.20 / mo** | **\$7.20 / mo** | \$584.00 / mo | **Hybrid Serverless Stack** |
| **10,000 analyses** | **\$144.00 / mo** | **\$72.00 / mo** | **\$72.00 / mo** | \$584.00 / mo | **Hybrid Batch Serverless Stack** |
| **50,000 analyses** | \$720.00 / mo | \$360.00 / mo | \$360.00 / mo | \$584.00 / mo | Crossover point to self-hosted GPU |

---

### 5. DEVELOPMENT BENCHMARK EXPENSES (R&D PHASE)

- **Test Corpus:** 10 real ground-truth benchmark clips (generated in Phase 2).
- **Execution Cost:** **$0.00 cloud spending** (100% executed locally via CPU in 12.13 seconds, 322.3 MB peak RAM).
- **Zero Chargeable Cloud Calls:** No paid API calls or cloud instances were provisioned.
