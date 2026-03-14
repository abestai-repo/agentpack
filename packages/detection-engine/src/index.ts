import fs from "node:fs/promises";
import path from "node:path";

import type {
  AdapterMetadata,
  DetectInput,
  DetectResult,
  DetectionCandidate,
  DetectionEngineResult,
  DetectionEvidence,
  DetectionRule
} from "../../domain/src/index.js";

const IGNORED_DIRECTORIES = new Set([".git", "node_modules", ".venv", "dist", "build", ".next"]);

interface FileSnapshot {
  relativePath: string;
  kind: "file" | "directory";
  content?: string;
}

function maxDepthForMode(mode: DetectInput["mode"]) {
  return mode === "deep" ? 6 : 4;
}

async function walkDirectory(
  rootPath: string,
  currentPath: string,
  snapshots: Map<string, FileSnapshot>,
  ignoredDirectories: Set<string>,
  mode: DetectInput["mode"],
  depth: number
) {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(currentPath, entry.name);
    const relativePath = path.relative(rootPath, absolutePath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        ignoredDirectories.add(relativePath);
        continue;
      }

      snapshots.set(relativePath, { relativePath, kind: "directory" });

      if (depth < maxDepthForMode(mode)) {
        await walkDirectory(rootPath, absolutePath, snapshots, ignoredDirectories, mode, depth + 1);
      }
      continue;
    }

    let content: string | undefined;
    const lowerName = entry.name.toLowerCase();
    const canReadContent =
      lowerName.endsWith(".json") ||
      lowerName.endsWith(".yaml") ||
      lowerName.endsWith(".yml") ||
      lowerName.endsWith(".toml") ||
      lowerName.endsWith(".txt") ||
      lowerName.endsWith(".md") ||
      lowerName === "package.json" ||
      lowerName === "requirements.txt" ||
      lowerName === "pyproject.toml" ||
      (mode === "deep" && (lowerName.endsWith(".js") || lowerName.endsWith(".ts") || lowerName.endsWith(".mjs")));

    if (canReadContent) {
      content = await fs.readFile(absolutePath, "utf8");
    }

    snapshots.set(relativePath, { relativePath, kind: "file", content });
  }
}

async function snapshotDirectory(input: DetectInput) {
  const snapshots = new Map<string, FileSnapshot>();
  const ignoredDirectories = new Set<string>();

  await walkDirectory(
    input.sourcePath,
    input.sourcePath,
    snapshots,
    ignoredDirectories,
    input.mode,
    1
  );

  return { snapshots, ignoredDirectories: [...ignoredDirectories].sort() };
}

export async function findIgnoredDirectories(sourcePath: string) {
  const entries = await fs.readdir(sourcePath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function normalizeConfidence(totalWeight: number) {
  return Math.max(0, Math.min(1, Number(totalWeight.toFixed(2))));
}

function matchCategoryForConfidence(confidence: number): DetectionCandidate["matchCategory"] {
  if (confidence >= 0.85) {
    return "strong";
  }

  if (confidence >= 0.6) {
    return "probable";
  }

  return "weak";
}

function matchesRule(rule: DetectionRule, snapshots: Map<string, FileSnapshot>) {
  if (rule.kind === "file_exists") {
    return snapshots.get(rule.path ?? "")?.kind === "file";
  }

  if (rule.kind === "directory_exists") {
    return snapshots.get(rule.path ?? "")?.kind === "directory";
  }

  if (rule.kind === "file_contains") {
    const snapshot = snapshots.get(rule.path ?? "");
    return Boolean(snapshot?.kind === "file" && snapshot.content?.includes(rule.pattern ?? ""));
  }

  if (rule.kind === "dependency_contains") {
    const manifests = ["package.json", "requirements.txt", "pyproject.toml"]
      .map((candidate) => snapshots.get(candidate))
      .filter((candidate): candidate is FileSnapshot => Boolean(candidate?.kind === "file"));

    return manifests.some((manifest) => manifest.content?.includes(rule.pattern ?? ""));
  }

  if (rule.kind === "convention_match") {
    return [...snapshots.keys()].some((candidate) => candidate.includes(rule.pattern ?? ""));
  }

  return false;
}

function evidenceKindForRule(rule: DetectionRule): DetectionEvidence["kind"] {
  switch (rule.kind) {
    case "file_exists":
      return "file";
    case "directory_exists":
      return "directory";
    case "dependency_contains":
      return "dependency";
    case "file_contains":
      return "content";
    case "convention_match":
      return "convention";
  }
}

export async function evaluateDetectionRules(
  input: DetectInput,
  metadata: AdapterMetadata,
  rules: DetectionRule[]
): Promise<{ result: DetectResult; ignoredDirectories: string[] }> {
  const { snapshots, ignoredDirectories } = await snapshotDirectory(input);
  const evidence = rules
    .filter((rule) => matchesRule(rule, snapshots))
    .map<DetectionEvidence>((rule) => ({
      kind: evidenceKindForRule(rule),
      path: rule.path,
      message: rule.message,
      weight: rule.weight
    }));
  const confidence = normalizeConfidence(evidence.reduce((total, item) => total + item.weight, 0));

  return {
    result: {
      adapterId: metadata.id,
      framework: metadata.framework,
      displayName: metadata.displayName,
      matched: confidence >= metadata.detectionThreshold,
      confidence,
      evidence,
      warnings: []
    },
    ignoredDirectories
  };
}

export function selectDetectionResult(
  candidates: DetectResult[],
  ignoredDirectories: string[]
): DetectionEngineResult {
  const ranked = candidates
    .map<DetectionCandidate>((candidate) => ({
      ...candidate,
      matchCategory: matchCategoryForConfidence(candidate.confidence)
    }))
    .sort((left, right) => right.confidence - left.confidence);

  const top = ranked[0];
  const second = ranked[1];
  const warnings =
    top && second && Math.abs(top.confidence - second.confidence) <= 0.1 && top.confidence > 0
      ? [`Ambiguous match: ${top.displayName} and ${second.displayName} scored closely.`]
      : [];

  const selected: DetectionCandidate =
    top && top.confidence > 0
      ? { ...top, warnings: [...top.warnings, ...warnings] }
      : {
          adapterId: "unknown",
          framework: "unknown",
          displayName: "Unknown",
          matched: false,
          confidence: 0,
          evidence: [],
          warnings: ["No supported framework matched the target folder."],
          matchCategory: "weak"
        };

  return {
    selected,
    candidates: ranked,
    ignoredDirectories
  };
}
