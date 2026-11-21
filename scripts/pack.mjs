import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactsDir = path.join(root, "artifacts");
const distDir = path.join(root, "dist");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const generatedAt = new Date().toISOString();

function gitValue(args, fallback) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim() || fallback;
  } catch {
    return fallback;
  }
}

function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Content manifest contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  if (typeof value === "object") {
    const object = value;
    const keys = Object.keys(object).sort();
    return "{" + keys.map((key) => JSON.stringify(key) + ":" + canonicalize(object[key])).join(",") + "}";
  }
  throw new Error("Content manifest contains an unsupported value");
}

function sha256(value) {
  return "sha256:" + createHash("sha256").update(value).digest("hex");
}

function walkFiles(directory, excludedNames = new Set()) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (excludedNames.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(absolute, excludedNames));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function createZip(outputPath, entries) {
  const localParts = [];
  const centralParts = [];
  const timestamp = dosDateTime(new Date());
  let offset = 0;

  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, "/");
    const nameBytes = Buffer.from(name, "utf8");
    const source = readFileSync(entry.absolutePath);
    const compressed = deflateRawSync(source);
    const checksum = crc32(source);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(timestamp.dosTime, 10);
    local.writeUInt16LE(timestamp.dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(source.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);

    localParts.push(local, nameBytes, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(timestamp.dosTime, 12);
    central.writeUInt16LE(timestamp.dosDate, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(source.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);

    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const centralOffset = offset;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  writeFileSync(outputPath, Buffer.concat([...localParts, centralDirectory, end]));
}

function relativeEntry(absolutePath, baseDirectory) {
  return {
    name: path.relative(baseDirectory, absolutePath).split(path.sep).join("/"),
    absolutePath
  };
}

const contentDirectory = path.join(root, "src", "content");
const contentFiles = walkFiles(contentDirectory).filter((file) => file.endsWith(".json"));
if (contentFiles.length === 0) throw new Error("No JSON content files found under src/content");

const contentMap = {};
const manifestFiles = [];
for (const absolutePath of contentFiles) {
  const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
  const parsed = JSON.parse(readFileSync(absolutePath, "utf8"));
  contentMap[relativePath] = parsed;
  manifestFiles.push({
    path: relativePath,
    fileHash: sha256(canonicalize(parsed))
  });
}
manifestFiles.sort((a, b) => a.path.localeCompare(b.path));
const contentHash = sha256(canonicalize(contentMap));
const contentManifest = {
  schemaVersion: 1,
  files: manifestFiles,
  contentHash
};

const storageSource = readFileSync(path.join(root, "src", "engine", "storage.ts"), "utf8");
const compatibilityMatch = storageSource.match(/ENGINE_COMPATIBILITY_VERSION\s*=\s*(\d+)/);
if (!compatibilityMatch) throw new Error("Could not read ENGINE_COMPATIBILITY_VERSION from storage.ts");
const engineCompatibilityVersion = Number(compatibilityMatch[1]);

const testedCommitSha = process.env.GITHUB_SHA || gitValue(["rev-parse", "HEAD"], "unavailable");
const shortSha = testedCommitSha === "unavailable" ? "local" : testedCommitSha.slice(0, 8);
const eventPath = process.env.GITHUB_EVENT_PATH;
let sourceCommitSha = testedCommitSha;
if (eventPath && existsSync(eventPath)) {
  try {
    const event = JSON.parse(readFileSync(eventPath, "utf8"));
    sourceCommitSha = event.pull_request?.head?.sha || testedCommitSha;
  } catch {
    sourceCommitSha = testedCommitSha;
  }
}
let workingTreeDirty = false;
try {
  execFileSync("git", ["diff", "--quiet", "HEAD", "--"], { cwd: root, stdio: "ignore" });
} catch {
  workingTreeDirty = true;
}

mkdirSync(artifactsDir, { recursive: true });
writeFileSync(path.join(artifactsDir, "content.manifest.json"), JSON.stringify(contentManifest, null, 2) + "\n");

const buildInfo = {
  app: packageJson.name,
  version: packageJson.version,
  testedCommitSha,
  sourceCommitSha,
  shortSha,
  workingTreeDirty,
  contentHash,
  engineCompatibilityVersion,
  generatedAt,
  nodeVersion: process.version
};
writeFileSync(path.join(artifactsDir, "BUILD_INFO.json"), JSON.stringify(buildInfo, null, 2) + "\n");

if (!existsSync(path.join(distDir, "index.html"))) {
  throw new Error("dist/index.html is missing; run npm run build before npm run pack");
}

const excluded = new Set([".git", "node_modules", "dist", "artifacts", "coverage", ".vite"]);
// Package only Git-tracked files. CI-generated package-lock, Playwright traces,
 // test-results, and other temporary files must never leak into the source archive.
const trackedPaths = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const sourceFiles = trackedPaths
  .filter((relativePath) => !relativePath.split("/").some((segment) => excluded.has(segment)))
  .map((relativePath) => ({
    name: relativePath,
    absolutePath: path.join(root, relativePath)
  }))
  .filter((entry) => existsSync(entry.absolutePath) && statSync(entry.absolutePath).isFile())
  .sort((a, b) => a.name.localeCompare(b.name));
const webFiles = walkFiles(distDir)
  .map((file) => relativeEntry(file, distDir))
  .sort((a, b) => a.name.localeCompare(b.name));

if (sourceFiles.length === 0 || webFiles.length === 0) {
  throw new Error("Source or web build is empty; refusing to create incomplete packages");
}

const sourceZipName = "fgame-source-" + shortSha + ".zip";
const webZipName = "fgame-web-" + shortSha + ".zip";
createZip(path.join(artifactsDir, sourceZipName), sourceFiles);
createZip(path.join(artifactsDir, webZipName), webFiles);

function readJsonReport(fileName) {
  const reportPath = path.join(artifactsDir, fileName);
  if (!existsSync(reportPath)) return null;
  return JSON.parse(readFileSync(reportPath, "utf8"));
}

const vitestReport = readJsonReport("vitest-results.json");
const playwrightReport = readJsonReport("playwright-results.json");
const unitTests = vitestReport ? {
  total: vitestReport.numTotalTests ?? null,
  passed: vitestReport.numPassedTests ?? null,
  failed: vitestReport.numFailedTests ?? null,
  skipped: vitestReport.numPendingTests ?? null
} : null;
const browserStats = playwrightReport?.stats;
const browserTests = browserStats ? {
  total: (browserStats.expected ?? 0) + (browserStats.unexpected ?? 0) + (browserStats.skipped ?? 0) + (browserStats.flaky ?? 0),
  passed: browserStats.expected ?? 0,
  failed: browserStats.unexpected ?? 0,
  skipped: browserStats.skipped ?? 0,
  flaky: browserStats.flaky ?? 0
} : null;

const failures = [];
if (!unitTests) failures.push("Missing Vitest JSON report");
else if (unitTests.failed !== 0 || unitTests.passed === null) failures.push("Unit test report contains failures or missing counters");
if (!browserTests) failures.push("Missing Playwright JSON report");
else if (browserTests.failed !== 0 || browserTests.flaky !== 0 || browserTests.passed === 0) {
  failures.push("Playwright report contains failures, flaky tests, or no passed browser tests");
}

const acceptanceReport = {
  reportType: "save-protection",
  testedCommit: testedCommitSha,
  sourceCommit: sourceCommitSha,
  contentHash,
  engineCompatibilityVersion,
  commands: [
    "npm run typecheck",
    "npm run test -- --reporter=json --outputFile=artifacts/vitest-results.json",
    "npm run build",
    "npx playwright install --with-deps chromium",
    "npm run test:e2e",
    "npm run pack"
  ],
  generatedAt,
  configurations: [
    {
      storyId: "sudden-billionaire",
      saveFormatVersion: 1,
      engineCompatibilityVersion,
      browser: "Chromium",
      browserProfile: "persistent",
      offlineResume: true
    }
  ],
  tests: {
    unit: unitTests,
    browser: browserTests
  },
  checks: {
    contentManifestGenerated: true,
    buildInfoGenerated: true,
    sourceArchiveCreated: true,
    webArchiveCreated: true,
    sourceFileCount: sourceFiles.length,
    webFileCount: webFiles.length
  },
  status: failures.length === 0 ? "PASS" : "FAIL",
  failures
};
writeFileSync(path.join(artifactsDir, "acceptance-report.json"), JSON.stringify(acceptanceReport, null, 2) + "\n");

console.log("Packages created:");
console.log(path.join(artifactsDir, sourceZipName));
console.log(path.join(artifactsDir, webZipName));
console.log(path.join(artifactsDir, "BUILD_INFO.json"));
console.log(path.join(artifactsDir, "acceptance-report.json"));
