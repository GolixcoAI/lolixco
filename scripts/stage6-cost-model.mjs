import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
// Gross PAYG sensitivity; no credits/free allowances deducted. USD, binary GB.
export const assumptions = Object.freeze({
  videos: 30,
  masterGB: 1,
  deliveryGB: 0.1,
  posterGB: 0.00025,
  workingCopiesGB: 6,
  retainedVersionsGB: 3,
  storagePerGB: 0.025,
  putPer1000: 0.005,
  getPer1000: 0.0004,
  indiaDTO: 0.109,
  httpsPer10000: 0.012,
  missFraction: 0.1,
  requestsPerPlay: 12,
  validationGB: 1,
  validationRequests: 200,
});
export function estimate(plays, a = assumptions) {
  if (!Number.isSafeInteger(plays) || plays < 0 || plays > 1_000_000)
    throw Error("Scenario outside quoted first DTO price tier");
  const storedGB =
    a.videos * (a.masterGB + a.deliveryGB + a.posterGB) +
    a.workingCopiesGB +
    a.retainedVersionsGB;
  const requests = plays * a.requestsPerPlay + a.validationRequests;
  const deliveredGB = plays * a.deliveryGB + a.validationGB;
  if (deliveredGB > 10240) throw Error("Reprice volume tiers above 10 TB");
  const storage = storedGB * a.storagePerGB,
    cdnTransfer = deliveredGB * a.indiaDTO,
    cdnRequests = (requests / 10000) * a.httpsPer10000,
    originReads = ((requests * a.missFraction) / 1000) * a.getPer1000,
    storageRequests = (1000 / 1000) * a.putPer1000;
  return {
    plays,
    storedGB,
    deliveredGB,
    requests,
    storage,
    cdnTransfer,
    cdnRequests,
    originReads,
    storageRequests,
    total: storage + cdnTransfer + cdnRequests + originReads + storageRequests,
  };
}
export const scenarios = () => [100, 1000, 10000].map((n) => estimate(n));
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  console.log(JSON.stringify({ assumptions, scenarios: scenarios() }, null, 2));
