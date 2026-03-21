import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type {
  AgentAdapter,
  DetectInput,
  DetectionEngineResult,
  PackInput,
  PackResult,
  VerifyResult,
  AeggManifest,
  CamDocument,
  AeggMetadata,
  AeggPackageCompatibilityDocument,
  RestoreInput,
  RestoreResult
} from "../../domain/src/index.js";
import {
  findIgnoredDirectories,
  selectDetectionResult
} from "../../detection-engine/src/index.js";
import { defaultAeggOutputPath, defaultBundleOutputPath, writeAeggPackage, writeAeggBundlePackage } from "../../image-engine/src/index.js";
import {
  validateAeggCompatibilityDocument,
  validateAeggManifest,
  validateAeggMetadata,
  validateAeggChecksums,
  validateCamDocument
} from "../../schemas/src/index.js";

export async function detectAgent(
  input: DetectInput,
  adapters: AgentAdapter[]
): Promise<DetectionEngineResult> {
  const candidateResults = await Promise.all(adapters.map((adapter) => adapter.detect(input)));
  const ignoredDirectories = await findIgnoredDirectories(input.sourcePath);
  return selectDetectionResult(candidateResults, ignoredDirectories);
}

function normalizePackageName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "agentpack-package";
}

function unique(values: string[]) {
  return [...new Set(values)];
}

export async function packAgent(
  input: PackInput,
  adapters: AgentAdapter[]
): Promise<PackResult> {
  const sourcePath = path.resolve(input.sourcePath);
  const detection = await detectAgent({ sourcePath, mode: "fast" }, adapters);

  if (!detection.selected.matched) {
    throw new Error("No supported framework matched the target folder.");
  }

  const detectedAgentCount = typeof detection.selected.details?.agentCount === "number"
    ? detection.selected.details.agentCount
    : undefined;

  if (detectedAgentCount === 0) {
    throw new Error(
      "No agents detected in the target folder. At least 1 agent must be present to pack."
    );
  }

  const adapter = adapters.find((candidate) => candidate.metadata.id === detection.selected.adapterId);
  if (!adapter?.extract) {
    throw new Error(`Adapter "${detection.selected.adapterId}" does not implement extract yet.`);
  }

  const extracted = await adapter.extract({
    sourcePath,
    mode: input.mode ?? "standard",
    agentId: input.agentId
  });
  const metadata = {
    ...extracted.metadata,
    display: {
      ...extracted.metadata.display,
      summary: input.message?.trim() || extracted.metadata.display.summary,
      tags: [...new Set([
        ...extracted.metadata.display.tags,
        ...(input.tags ?? [])
      ])].sort()
    }
  };

  const camValidation = validateCamDocument(extracted.cam);
  if (!camValidation.valid) {
    throw new Error(`Extracted CAM was invalid: ${camValidation.errors[0]?.message ?? "unknown error"}`);
  }

  const metadataValidation = validateAeggMetadata(metadata);
  if (!metadataValidation.valid) {
    throw new Error(`Extracted metadata was invalid: ${metadataValidation.errors[0]?.message ?? "unknown error"}`);
  }

  const compatibilityValidation = validateAeggCompatibilityDocument(extracted.compatibility);
  if (!compatibilityValidation.valid) {
    throw new Error(
      `Extracted compatibility document was invalid: ${compatibilityValidation.errors[0]?.message ?? "unknown error"}`
    );
  }

  const packageName = normalizePackageName(extracted.packageName);
  const outputPath = input.outputPath
    ? path.resolve(input.outputPath)
    : defaultAeggOutputPath(sourcePath, packageName);
  const writeResult = await writeAeggPackage({
    outputPath,
    name: packageName,
    version: extracted.version,
    cam: extracted.cam,
    metadata,
    compatibility: extracted.compatibility,
    assets: extracted.assets
  });

  const manifestValidation = validateAeggManifest(writeResult.manifest);
  if (!manifestValidation.valid) {
    throw new Error(
      `Generated manifest was invalid: ${manifestValidation.errors[0]?.message ?? "unknown error"}`
    );
  }

  return {
    outputPath: writeResult.outputPath,
    manifest: writeResult.manifest,
    metadata,
    compatibility: extracted.compatibility,
    checksums: writeResult.checksums,
    warnings: unique([...detection.selected.warnings, ...extracted.warnings])
  };
}

export interface SnapshotIndex {
  source_folder: string;
  created_at: string;
  agent_count: number;
  agents: Array<{
    agent_id: string;
    path: string;
    package: string;
  }>;
  relationships: Array<{
    from: string;
    to: string;
    type: string;
  }>;
}

export interface MultiPackResult {
  packages: PackResult[];
  snapshotIndex?: SnapshotIndex;
  snapshotIndexPath?: string;
}

export async function packMultiAgent(
  input: PackInput,
  adapters: AgentAdapter[]
): Promise<MultiPackResult> {
  const sourcePath = path.resolve(input.sourcePath);
  const detection = await detectAgent({ sourcePath, mode: "fast" }, adapters);

  if (!detection.selected.matched) {
    throw new Error("No supported framework matched the target folder.");
  }

  const detectedAgentCount = typeof detection.selected.details?.agentCount === "number"
    ? detection.selected.details.agentCount
    : 1;

  if (detectedAgentCount === 0) {
    throw new Error(
      "No agents detected in the target folder. At least 1 agent must be present to pack."
    );
  }

  // If bundle mode is requested, route to packAgentBundle
  if (input.bundle) {
    const bundleResult = await packAgentBundle(input, adapters);
    return { packages: [bundleResult] };
  }

  // If --agent filter is specified, delegate to single packAgent
  if (input.agentId) {
    const result = await packAgent(input, adapters);
    return { packages: [result] };
  }

  // For now, adapter extract always captures from the full source.
  // We call packAgent once which produces one .aegg for the entire source.
  // When per-agent adapter extraction is available, this will loop per agent.
  const result = await packAgent(input, adapters);
  const packages = [result];

  // Generate snapshot index sidecar when agent count > 1
  if (detectedAgentCount > 1) {
    const agentDetails = (detection.selected.details?.agentIds ?? []) as string[];
    const workspaceDirs = (detection.selected.details?.workspaceDirs ?? []) as string[];
    const snapshotIndex: SnapshotIndex = {
      source_folder: sourcePath,
      created_at: new Date().toISOString(),
      agent_count: detectedAgentCount,
      agents: agentDetails.length > 0
        ? agentDetails.map((agentId, index) => ({
            agent_id: agentId,
            path: workspaceDirs[index] ?? `./${agentId}`,
            package: path.basename(result.outputPath)
          }))
        : Array.from({ length: detectedAgentCount }, (_, index) => ({
            agent_id: `agent-${index + 1}`,
            path: workspaceDirs[index] ?? `./agent-${index + 1}`,
            package: path.basename(result.outputPath)
          })),
      relationships: []
    };

    const outputDir = path.dirname(result.outputPath);
    const folderName = path.basename(sourcePath);
    const snapshotIndexPath = path.join(outputDir, `${folderName}.snapshot.json`);
    await fs.writeFile(snapshotIndexPath, JSON.stringify(snapshotIndex, null, 2) + "\n", "utf8");

    return {
      packages,
      snapshotIndex,
      snapshotIndexPath
    };
  }

  return { packages };
}

export async function packAgentBundle(
  input: PackInput,
  adapters: AgentAdapter[]
): Promise<PackResult> {
  const sourcePath = path.resolve(input.sourcePath);
  const detection = await detectAgent({ sourcePath, mode: "fast" }, adapters);

  if (!detection.selected.matched) {
    throw new Error("No supported framework matched the target folder.");
  }

  const detectedAgentCount = typeof detection.selected.details?.agentCount === "number"
    ? detection.selected.details.agentCount
    : 1;

  if (detectedAgentCount === 0) {
    throw new Error(
      "No agents detected in the target folder. At least 1 agent must be present to pack."
    );
  }

  const adapter = adapters.find((candidate) => candidate.metadata.id === detection.selected.adapterId);
  if (!adapter?.extract) {
    throw new Error(`Adapter "${detection.selected.adapterId}" does not implement extract yet.`);
  }

  const extracted = await adapter.extract({
    sourcePath,
    mode: input.mode ?? "standard",
    agentId: input.agentId
  });
  const metadata = {
    ...extracted.metadata,
    display: {
      ...extracted.metadata.display,
      summary: input.message?.trim() || extracted.metadata.display.summary,
      tags: [...new Set([
        ...extracted.metadata.display.tags,
        ...(input.tags ?? [])
      ])].sort()
    }
  };

  const camValidation = validateCamDocument(extracted.cam);
  if (!camValidation.valid) {
    throw new Error(`Extracted CAM was invalid: ${camValidation.errors[0]?.message ?? "unknown error"}`);
  }

  const metadataValidation = validateAeggMetadata(metadata);
  if (!metadataValidation.valid) {
    throw new Error(`Extracted metadata was invalid: ${metadataValidation.errors[0]?.message ?? "unknown error"}`);
  }

  const compatibilityValidation = validateAeggCompatibilityDocument(extracted.compatibility);
  if (!compatibilityValidation.valid) {
    throw new Error(
      `Extracted compatibility document was invalid: ${compatibilityValidation.errors[0]?.message ?? "unknown error"}`
    );
  }

  const packageName = normalizePackageName(extracted.packageName);
  const agentId = extracted.cam.agent.slug ?? normalizePackageName(extracted.cam.agent.name);
  const outputPath = input.outputPath
    ? path.resolve(input.outputPath)
    : defaultBundleOutputPath(sourcePath, packageName);

  const writeResult = await writeAeggBundlePackage({
    outputPath,
    name: packageName,
    version: extracted.version,
    agents: [{
      agentId,
      cam: extracted.cam,
      metadata,
      compatibility: extracted.compatibility,
      assets: extracted.assets
    }]
  });

  const manifestValidation = validateAeggManifest(writeResult.manifest);
  if (!manifestValidation.valid) {
    throw new Error(
      `Generated bundle manifest was invalid: ${manifestValidation.errors[0]?.message ?? "unknown error"}`
    );
  }

  return {
    outputPath: writeResult.outputPath,
    manifest: writeResult.manifest,
    metadata,
    compatibility: extracted.compatibility,
    checksums: writeResult.checksums,
    warnings: unique([...detection.selected.warnings, ...extracted.warnings])
  };
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function verifyAeggPackage(packagePath: string): Promise<VerifyResult> {
  const resolvedPath = path.resolve(packagePath);

  // Determine the package root (handle both directory and manifest.json paths)
  const stat = await fs.stat(resolvedPath);
  const packageRoot = stat.isDirectory() ? resolvedPath : path.dirname(resolvedPath);

  // Locate manifest.json
  let manifestPath = resolvedPath;
  if (stat.isDirectory()) {
    const candidate = path.join(resolvedPath, "manifest.json");
    if (await pathExists(candidate)) {
      manifestPath = candidate;
    }
  }

  // Read and validate manifest
  const manifestText = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText) as unknown as Record<string, unknown>;
  const manifestValidation = validateAeggManifest(manifest);

  if (!manifestValidation.valid) {
    return {
      valid: false,
      packagePath: packageRoot,
      totalFiles: 0,
      verifiedFiles: 0,
      failedFiles: [],
      missingFiles: [],
      extraFiles: [],
      warnings: [`Invalid manifest.json: ${manifestValidation.errors[0]?.message ?? "unknown error"}`]
    };
  }

  const manifestDoc = manifestValidation.data!;

  // Read and validate checksums
  const checksumsPath = path.join(packageRoot, manifestDoc.entrypoints.checksums);
  const checksumsText = await fs.readFile(checksumsPath, "utf8");
  const checksums = JSON.parse(checksumsText) as unknown as Record<string, unknown>;
  const checksumsValidation = validateAeggChecksums(checksums);

  if (!checksumsValidation.valid) {
    return {
      valid: false,
      packagePath: packageRoot,
      manifest: manifestDoc,
      totalFiles: 0,
      verifiedFiles: 0,
      failedFiles: [],
      missingFiles: [],
      extraFiles: [],
      warnings: [`Invalid checksums.json: ${checksumsValidation.errors[0]?.message ?? "unknown error"}`]
    };
  }

  const checksumsDoc = checksumsValidation.data!;
  const expectedFiles = new Map(checksumsDoc.files.map(f => [f.path, f.digest]));
  const actualFiles = new Set<string>();

  const failedFiles: string[] = [];
  const missingFiles: string[] = [];

  // Verify each expected file
  for (const [filePath, expectedDigest] of expectedFiles.entries()) {
    const fullPath = path.join(packageRoot, filePath);

    if (!(await pathExists(fullPath))) {
      missingFiles.push(filePath);
      continue;
    }

    actualFiles.add(filePath);

    const fileContent = await fs.readFile(fullPath, "utf8");
    const actualDigest = sha256(fileContent);

    if (actualDigest !== expectedDigest) {
      failedFiles.push(filePath);
    }
  }

  // Find extra files (files on disk but not in checksums)
  async function collectActualFiles(currentPath: string) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      const relativePath = path.relative(packageRoot, entryPath).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        await collectActualFiles(entryPath);
      } else {
        actualFiles.add(relativePath);
      }
    }
  }

  await collectActualFiles(packageRoot);

  const extraFiles: string[] = [];
  for (const filePath of actualFiles) {
    if (filePath === manifestDoc.entrypoints.checksums) {
      continue; // checksums.json itself is expected to not be in the list
    }
    if (!expectedFiles.has(filePath)) {
      extraFiles.push(filePath);
    }
  }

  const totalFiles = expectedFiles.size;
  const verifiedFiles = totalFiles - failedFiles.length - missingFiles.length;
  const valid = failedFiles.length === 0 && missingFiles.length === 0;

  return {
    valid,
    packagePath: packageRoot,
    manifest: manifestDoc,
    totalFiles,
    verifiedFiles,
    failedFiles,
    missingFiles,
    extraFiles,
    warnings: []
  };
}

export interface HatchInput {
  sourcePackage: string;
  targetPath: string;
  targetFramework?: string;
  options?: {
    dryRun?: boolean;
    backup?: boolean;
    force?: boolean;
    agentId?: string;
    confirmStepByStep?: boolean;
    logUndo?: boolean;
  };
}
export interface MultiRestoreResult {
  restored: RestoreResult[];
  warnings: string[];
}

export async function hatchAgent(
  input: HatchInput,
  adapters: AgentAdapter[]
): Promise<MultiRestoreResult> {
  const resolvedPath = path.resolve(input.sourcePackage);
  const stat = await fs.stat(resolvedPath);
  const packageRoot = stat.isDirectory() ? resolvedPath : path.dirname(resolvedPath);

  let manifestPath = resolvedPath;
  if (stat.isDirectory()) {
    const candidate = path.join(resolvedPath, "manifest.json");
    if (await pathExists(candidate)) {
      manifestPath = candidate;
    }
  }

  const manifestText = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText) as AeggManifest;
  
  const manifestValidation = validateAeggManifest(manifest);
  if (!manifestValidation.valid) {
    throw new Error(`Invalid manifest in package: ${manifestValidation.errors[0]?.message ?? "unknown error"}`);
  }

  const manifestDoc = manifestValidation.data!;
  const isBundle = manifestDoc.package_type === "bundle";
  const restored: RestoreResult[] = [];
  const warnings: string[] = [];

  const agentsToProcess = isBundle && manifestDoc.agents
    ? manifestDoc.agents
    : [{ agent_id: "default", path: "." }];

  for (const agentEntry of agentsToProcess) {
    if (input.options?.agentId && input.options.agentId !== agentEntry.agent_id) {
      continue;
    }

    const agentRoot = isBundle 
      ? path.join(packageRoot, agentEntry.path)
      : packageRoot;

    const camPath = isBundle ? path.join(agentRoot, "cam.json") : path.join(packageRoot, manifestDoc.entrypoints.cam);
    const metadataPath = isBundle ? path.join(agentRoot, "metadata.json") : path.join(packageRoot, manifestDoc.entrypoints.metadata);
    const compatibilityPath = isBundle ? path.join(agentRoot, "compatibility.json") : path.join(packageRoot, manifestDoc.entrypoints.compatibility);
    const assetsDirectory = path.join(agentRoot, "assets");

    const cam = JSON.parse(await fs.readFile(camPath, "utf8")) as CamDocument;
    const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8")) as AeggMetadata;
    const compatibility = JSON.parse(await fs.readFile(compatibilityPath, "utf8")) as AeggPackageCompatibilityDocument;

    const targetFramework = input.targetFramework ?? metadata.provenance.source_framework ?? "openclaw";

    const adapter = adapters.find((a) => a.metadata.id === targetFramework);
    if (!adapter) {
      warnings.push(`No adapter found for framework: ${targetFramework}`);
      continue;
    }
    if (!adapter.restore) {
      warnings.push(`Adapter "${adapter.metadata.id}" does not implement restore yet.`);
      continue;
    }

    const agentTargetPath = isBundle 
      ? path.join(input.targetPath, agentEntry.agent_id)
      : input.targetPath;

    const restoreInput: RestoreInput = {
      sourcePackage: input.sourcePackage,
      targetPath: agentTargetPath,
      cam,
      metadata,
      compatibility,
      assetsDirectory,
      options: input.options
    };

    try {
      const result = await adapter.restore(restoreInput);
      restored.push(result);
    } catch (err: unknown) {
      warnings.push(`Failed to restore agent ${agentEntry.agent_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (restored.length === 0 && warnings.length === 0) {
    warnings.push("No agents restored.");
  }

  return { restored, warnings };
}

