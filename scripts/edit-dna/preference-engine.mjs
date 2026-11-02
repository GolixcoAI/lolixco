/**
 * LOLIXCO EDIT DNA — OWNER QUALITY SCORING & PREFERENCE ENGINE
 * Part of Antigravity Mission 1 (AI Edit Analyzer R&D)
 *
 * Implements:
 * 1. Configurable rubric weights with dynamic rebalancing.
 * 2. Three-layer score separation (Technical, Editorial, Owner-Personalized).
 * 3. Bradley-Terry pairwise preference learning for instant A/B adaptation.
 * 4. Active learning uncertainty sampling for informative review queues.
 */

export const DEFAULT_PROVISIONAL_WEIGHTS = {
  beat_synchronization: 0.25,
  transitions: 0.2,
  pacing: 0.15,
  visual_quality: 0.15,
  storytelling_emotion: 0.15,
  originality_creativity: 0.1,
};

/**
 * Normalizes weight map so values sum strictly to 1.0.
 * @param {Record<string, number>} weights
 * @returns {Record<string, number>}
 */
export function normalizeWeights(weights) {
  const keys = Object.keys(weights);
  const total = keys.reduce((sum, k) => sum + Math.max(0, weights[k]), 0);
  if (total === 0) return { ...DEFAULT_PROVISIONAL_WEIGHTS };

  const normalized = {};
  for (const k of keys) {
    normalized[k] = Number((Math.max(0, weights[k]) / total).toFixed(4));
  }
  return normalized;
}

/**
 * Core Scoring Engine managing rubric weights and multi-tier score calculation.
 */
export class ScoringEngine {
  constructor(initialWeights = DEFAULT_PROVISIONAL_WEIGHTS) {
    this.weights = normalizeWeights(initialWeights);
  }

  setWeights(newWeights) {
    this.weights = normalizeWeights(newWeights);
  }

  getWeights() {
    return { ...this.weights };
  }

  /**
   * Calculates composite score from component ratings (0 - 10 scale).
   * @param {Record<string, number>} componentScores
   * @returns {number}
   */
  calculateCompositeScore(componentScores) {
    let score = 0;
    for (const [category, weight] of Object.entries(this.weights)) {
      const val = componentScores[category] ?? 5.0;
      score += weight * Math.max(0, Math.min(10, val));
    }
    return Number(score.toFixed(2));
  }

  /**
   * Calculates objective technical score strictly from physical signal metrics.
   * @param {object} telemetry Output of analyzeEditingSignal
   * @returns {number} Score on 0 - 10 scale.
   */
  calculateObjectiveTechnicalScore(telemetry) {
    const syncScore = telemetry.synchronization?.beatSyncIndex ?? 5.0;

    // Pacing penalty for extreme ASL (<0.3s or >5.0s)
    let pacingScore = 8.5;
    const asl = telemetry.pacing?.averageShotLength ?? 1.5;
    if (asl < 0.4 || asl > 4.5) pacingScore = 5.0;
    else if (asl >= 0.7 && asl <= 2.2) pacingScore = 9.5;

    // Audio engineering penalty for clipping or extreme LUFS
    let audioScore = 9.0;
    if (telemetry.audioEngineering?.clippingDetected) audioScore -= 4.0;
    const lufs = telemetry.audioEngineering?.integratedLufs ?? -14.0;
    if (lufs > -8.0 || lufs < -22.0) audioScore -= 2.0;

    // Transition diversity score
    const totalTransitions =
      (telemetry.transitionsBreakdown?.hardCuts || 0) +
      (telemetry.transitionsBreakdown?.flashTransitions || 0) +
      (telemetry.transitionsBreakdown?.whipPanMotionBlur || 0) +
      (telemetry.transitionsBreakdown?.dissolves || 0);
    const diversityRatio =
      totalTransitions > 0
        ? ((telemetry.transitionsBreakdown?.flashTransitions || 0) +
            (telemetry.transitionsBreakdown?.whipPanMotionBlur || 0)) /
          totalTransitions
        : 0;
    const transitionScore = diversityRatio > 0.05 ? 8.8 : 7.5;

    // Weighted technical baseline
    const techScore =
      syncScore * 0.45 +
      pacingScore * 0.25 +
      audioScore * 0.15 +
      transitionScore * 0.15;

    return Number(Math.max(0, Math.min(10, techScore)).toFixed(2));
  }
}

/**
 * Sigmoid logistic function.
 */
function sigmoid(z) {
  if (z > 15) return 1.0;
  if (z < -15) return 0.0;
  return 1.0 / (1.0 + Math.exp(-z));
}

/**
 * Bradley-Terry Pairwise Preference Model.
 * Learns a latent weight vector theta from owner A/B comparisons.
 */
export class BradleyTerryPreferenceModel {
  /**
   * @param {string[]} featureNames List of feature dimension names.
   */
  constructor(featureNames = [
    "beat_sync",
    "transition_smoothness",
    "pacing_coherence",
    "visual_quality",
    "emotional_impact",
    "originality",
  ]) {
    this.featureNames = [...featureNames];
    // Initialize weights to uniform neutral prior (1.0 each)
    this.weights = new Array(this.featureNames.length).fill(1.0);
    this.comparisons = [];
  }

  /**
   * Record an owner comparison.
   * @param {number[]} featuresA Feature vector of Edit A.
   * @param {number[]} featuresB Feature vector of Edit B.
   * @param {'A' | 'B' | 'tie'} chosenWinner
   */
  addComparison(featuresA, featuresB, chosenWinner) {
    if (chosenWinner === "tie") return;
    this.comparisons.push({
      featuresA: [...featuresA],
      featuresB: [...featuresB],
      label: chosenWinner === "A" ? 1.0 : 0.0,
    });
  }

  /**
   * Calculate scalar latent utility: r = theta^T x
   * @param {number[]} features
   * @returns {number}
   */
  predictUtility(features) {
    let utility = 0;
    for (let i = 0; i < this.weights.length; i++) {
      utility += this.weights[i] * (features[i] ?? 0);
    }
    return Number(utility.toFixed(4));
  }

  /**
   * Predict probability that Edit A is preferred over Edit B.
   * P(A > B) = 1 / (1 + exp(-(r_A - r_B)))
   * @param {number[]} featuresA
   * @param {number[]} featuresB
   * @returns {number} Probability in [0, 1].
   */
  predictPreference(featuresA, featuresB) {
    const utilityA = this.predictUtility(featuresA);
    const utilityB = this.predictUtility(featuresB);
    return Number(sigmoid(utilityA - utilityB).toFixed(4));
  }

  /**
   * Fit the model weights using gradient descent on the regularized log-likelihood.
   * @param {number} iterations
   * @param {number} learningRate
   * @param {number} l2Reg L2 regularization coefficient to prevent overfitting.
   */
  fit(iterations = 60, learningRate = 0.08, l2Reg = 0.02) {
    if (this.comparisons.length === 0) return;

    const numFeatures = this.weights.length;

    for (let iter = 0; iter < iterations; iter++) {
      const gradient = new Array(numFeatures).fill(0);

      for (const comp of this.comparisons) {
        // Delta features = x_A - x_B
        const delta = new Array(numFeatures);
        let dotProduct = 0;
        for (let j = 0; j < numFeatures; j++) {
          delta[j] = comp.featuresA[j] - comp.featuresB[j];
          dotProduct += this.weights[j] * delta[j];
        }

        const probA = sigmoid(dotProduct);
        // Error = label - P(A > B)
        const error = comp.label - probA;

        for (let j = 0; j < numFeatures; j++) {
          gradient[j] += error * delta[j];
        }
      }

      // Update weights with L2 penalty
      for (let j = 0; j < numFeatures; j++) {
        gradient[j] -= l2Reg * this.weights[j];
        this.weights[j] += learningRate * (gradient[j] / this.comparisons.length);
      }
    }
  }

  getWeights() {
    const result = {};
    for (let i = 0; i < this.featureNames.length; i++) {
      result[this.featureNames[i]] = Number(this.weights[i].toFixed(4));
    }
    return result;
  }
}

/**
 * Active Learning Uncertainty Selector.
 * Ranks unreviewed video pairs by model ambivalence to maximize owner review efficiency.
 */
export class ActiveLearningSelector {
  /**
   * @param {BradleyTerryPreferenceModel} model
   */
  constructor(model) {
    this.model = model;
  }

  /**
   * Calculate uncertainty score for an edit pair. Max score (1.0) when P(A > B) = 0.5.
   * @param {number[]} featuresA
   * @param {number[]} featuresB
   * @returns {number} Score in [0, 1].
   */
  calculateUncertainty(featuresA, featuresB) {
    const prob = this.model.predictPreference(featuresA, featuresB);
    // Uncertainty is 1.0 when prob is 0.5; drops to 0.0 when prob is 0.0 or 1.0
    return Number((1.0 - 2.0 * Math.abs(prob - 0.5)).toFixed(4));
  }

  /**
   * Sort candidate pairs by uncertainty descending.
   * @param {Array<{ idA: string, idB: string, featuresA: number[], featuresB: number[] }>} candidatePairs
   * @returns {Array<{ idA: string, idB: string, uncertainty: number }>}
   */
  rankMostInformativePairs(candidatePairs) {
    return candidatePairs
      .map((pair) => ({
        idA: pair.idA,
        idB: pair.idB,
        uncertainty: this.calculateUncertainty(pair.featuresA, pair.featuresB),
      }))
      .sort((a, b) => b.uncertainty - a.uncertainty);
  }
}

