import fs from "fs";
import path from "path";

export const freeSpaceReserve = 1024 ** 3;
const minimumConversionSpace = 512 * 1024 ** 2;

export class InsufficientSpaceError extends Error {
  constructor(message: string) { super(message); this.name = "InsufficientSpaceError"; }
}

function formatGiB(bytes: number) { return `${(bytes / 1024 ** 3).toFixed(1)} GiB`; }
function sameVolume(first: string, second: string) {
  // The portable release targets Windows. Comparing volume roots also handles
  // separate drive letters and UNC shares without assuming all paths use C:.
  return path.parse(path.resolve(first)).root.toLowerCase() === path.parse(path.resolve(second)).root.toLowerCase();
}
export function conversionAllowance(sourceBytes: number) {
  return Math.max(minimumConversionSpace, sourceBytes);
}
export function importSpaceRequirements(sourceBytes: number, sharedVolume: boolean) {
  const conversion = conversionAllowance(sourceBytes);
  return {
    temp: sourceBytes + conversion + (sharedVolume ? conversion : 0) + freeSpaceReserve,
    destination: sharedVolume ? 0 : conversion + freeSpaceReserve,
  };
}
function available(dir: string) {
  const stats = fs.statfsSync(dir, { bigint: true });
  return Number(stats.bavail * stats.bsize);
}
function requireSpace(dir: string, required: number, purpose: string) {
  const free = available(dir);
  if (free < required) throw new InsufficientSpaceError(
    `Not enough free disk space ${purpose}. ${formatGiB(required)} needed on ${path.parse(path.resolve(dir)).root}; ${formatGiB(free)} available. Free space or choose another drive and retry.`);
}
export function checkUploadSpace(tempDir: string, destination: string, sourceBytes: number) {
  if (!Number.isSafeInteger(sourceBytes) || sourceBytes <= 0) throw new Error("The upload size is missing or invalid.");
  const shared = sameVolume(tempDir, destination);
  const needed = importSpaceRequirements(sourceBytes, shared);
  requireSpace(tempDir, needed.temp, "for the upload and conversion");
  if (!shared) requireSpace(destination, needed.destination, "for the movie-pack destination");
}
export function checkConversionSpace(tempDir: string, destination: string, sourceBytes: number) {
  const allowance = conversionAllowance(sourceBytes);
  const shared = sameVolume(tempDir, destination);
  requireSpace(tempDir, allowance * (shared ? 2 : 1) + freeSpaceReserve, "to encode the movie");
  if (!shared) requireSpace(destination, allowance + freeSpaceReserve, "to install the movie");
}
export function checkInstallSpace(destination: string, bytes: number) {
  requireSpace(destination, bytes + freeSpaceReserve, "to install the converted movie");
}
export function checkReserve(dir: string) {
  requireSpace(dir, freeSpaceReserve, "to continue encoding");
}
