import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type {
  AeggChecksums,
  AeggManifest,
  AeggMetadata,
  AeggPackageCompatibilityDocument,
  CamDocument,
  ExtractedAsset
} from "../../domain/src/index.js";

export interface AeggWriteInput {
  outputPath: string;
  name: string;
  version: string;
  cam: CamDocument;
  metadata: AeggMetadata;
  compatibility: AeggPackageCompatibilityDocument;
  assets?: ExtractedAsset[];
  createdAt?: string;
}

export interface AeggWriteResult {
  outputPath: string;
  manifest: AeggManifest;
  checksums: AeggChecksums;
}

const ENTRYPOINTS = {
  cam: "cam.json",
  metadata: "metadata.json",
  compatibility: "compatibility.json",
  checksums: "checksums.json"
} as const;

function normalizePath(value: string) {
  return value.replace(/\\/g, "/");
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJson(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortJson(nested)])
  );
}

function stableStringify(value: unknown) {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function buildPackageId(name: string, version: string, cam: CamDocument, metadata: AeggMetadata) {
  const digest = sha256(stableStringify({ name, version, cam, metadata }));
  return `pkg_${digest.slice(0, 16)}`;
}

export function defaultAeggOutputPath(sourcePath: string, packageName: string) {
  return path.join(path.dirname(sourcePath), `${packageName}.aegg`);
}

export async function writeAeggPackage(input: AeggWriteInput): Promise<AeggWriteResult> {
  const outputPath = path.resolve(input.outputPath);
  const createdAt = input.createdAt ?? new Date().toISOString();
  const packageId = buildPackageId(input.name, input.version, input.cam, input.metadata);

  const manifest: AeggManifest = {
    schema_version: "aegg-1.0",
    cam_schema_version: "cam-1.0",
    package_type: "agent",
    package_id: packageId,
    name: input.name,
    version: input.version,
    created_at: createdAt,
    entrypoints: { ...ENTRYPOINTS }
  };

  const documents = new Map<string, string>([
    [ENTRYPOINTS.cam, stableStringify(input.cam)],
    [ENTRYPOINTS.metadata, stableStringify(input.metadata)],
    [ENTRYPOINTS.compatibility, stableStringify(input.compatibility)]
  ]);

  const manifestText = stableStringify(manifest);

  await fs.rm(outputPath, { recursive: true, force: true });
  await fs.mkdir(path.join(outputPath, "assets"), { recursive: true });
  await fs.writeFile(path.join(outputPath, "manifest.json"), manifestText, "utf8");

  for (const [filePath, contents] of documents.entries()) {
    await fs.writeFile(path.join(outputPath, filePath), contents, "utf8");
  }

  if (input.assets) {
    for (const asset of input.assets) {
      const targetPath = path.join(outputPath, asset.archivePath);

      if (asset.kind === "virtual") {
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, asset.content ?? "", "utf8");
        continue;
      }

      if (!asset.sourcePath) {
        continue;
      }

      await fs.cp(asset.sourcePath, targetPath, {
        recursive: true,
        force: true,
        errorOnExist: false
      });
    }
  }

  const checksums: AeggChecksums = {
    algorithm: "sha256",
    files: []
  };

  async function collectChecksums(currentPath: string) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await collectChecksums(entryPath);
        continue;
      }

      const relativePath = normalizePath(path.relative(outputPath, entryPath));
      if (relativePath === ENTRYPOINTS.checksums) {
        continue;
      }

      checksums.files.push({
        path: relativePath,
        digest: sha256(await fs.readFile(entryPath, "utf8"))
      });
    }
  }

  await collectChecksums(outputPath);
  checksums.files.sort((left, right) => left.path.localeCompare(right.path));
  await fs.writeFile(
    path.join(outputPath, ENTRYPOINTS.checksums),
    stableStringify(checksums),
    "utf8"
  );

  return {
    outputPath,
    manifest,
    checksums
  };
}

export interface BundleAgentEntry {
  agentId: string;
  cam: CamDocument;
  metadata: AeggMetadata;
  compatibility: AeggPackageCompatibilityDocument;
  assets?: ExtractedAsset[];
}

export interface AeggBundleWriteInput {
  outputPath: string;
  name: string;
  version: string;
  agents: BundleAgentEntry[];
  createdAt?: string;
}

export interface AeggBundleWriteResult {
  outputPath: string;
  manifest: AeggManifest;
  checksums: AeggChecksums;
}

export function defaultBundleOutputPath(sourcePath: string, packageName: string) {
  return path.join(path.dirname(sourcePath), `${packageName}.bundle.aegg`);
}

export async function writeAeggBundlePackage(input: AeggBundleWriteInput): Promise<AeggBundleWriteResult> {
  const outputPath = path.resolve(input.outputPath);
  const createdAt = input.createdAt ?? new Date().toISOString();

  // Build a composite package ID from all agent IDs
  const compositeDigest = sha256(stableStringify({
    name: input.name,
    version: input.version,
    agents: input.agents.map((agent) => agent.agentId)
  }));
  const packageId = `bnd_${compositeDigest.slice(0, 16)}`;

  const manifest: AeggManifest = {
    schema_version: "aegg-1.0",
    cam_schema_version: "cam-1.0",
    package_type: "bundle",
    package_id: packageId,
    name: input.name,
    version: input.version,
    created_at: createdAt,
    agents: input.agents.map((agent) => ({
      agent_id: agent.agentId,
      path: `agents/${agent.agentId}`
    })),
    entrypoints: {
      cam: `agents/${input.agents[0]?.agentId ?? "default"}/cam.json`,
      metadata: `agents/${input.agents[0]?.agentId ?? "default"}/metadata.json`,
      compatibility: `agents/${input.agents[0]?.agentId ?? "default"}/compatibility.json`,
      checksums: "checksums.json"
    }
  };

  await fs.rm(outputPath, { recursive: true, force: true });
  await fs.mkdir(path.join(outputPath, "shared_resources"), { recursive: true });

  // Write per-agent subdirectories
  for (const agent of input.agents) {
    const agentDir = path.join(outputPath, "agents", agent.agentId);
    await fs.mkdir(path.join(agentDir, "assets"), { recursive: true });

    await fs.writeFile(
      path.join(agentDir, ENTRYPOINTS.cam),
      stableStringify(agent.cam),
      "utf8"
    );
    await fs.writeFile(
      path.join(agentDir, ENTRYPOINTS.metadata),
      stableStringify(agent.metadata),
      "utf8"
    );
    await fs.writeFile(
      path.join(agentDir, ENTRYPOINTS.compatibility),
      stableStringify(agent.compatibility),
      "utf8"
    );

    if (agent.assets) {
      for (const asset of agent.assets) {
        const targetPath = path.join(agentDir, asset.archivePath);

        if (asset.kind === "virtual") {
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.writeFile(targetPath, asset.content ?? "", "utf8");
          continue;
        }

        if (!asset.sourcePath) {
          continue;
        }

        await fs.cp(asset.sourcePath, targetPath, {
          recursive: true,
          force: true,
          errorOnExist: false
        });
      }
    }
  }

  // Write bundle-level files
  const relationships = {
    agents: input.agents.map((agent) => agent.agentId),
    edges: [] as Array<{ from: string; to: string; type: string }>
  };
  await fs.writeFile(
    path.join(outputPath, "relationships.json"),
    stableStringify(relationships),
    "utf8"
  );

  const manifestText = stableStringify(manifest);
  await fs.writeFile(path.join(outputPath, "manifest.json"), manifestText, "utf8");

  // Collect checksums across entire bundle
  const checksums: AeggChecksums = {
    algorithm: "sha256",
    files: []
  };

  async function collectChecksums(currentPath: string) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await collectChecksums(entryPath);
        continue;
      }
      const relativePath = normalizePath(path.relative(outputPath, entryPath));
      if (relativePath === ENTRYPOINTS.checksums) {
        continue;
      }
      checksums.files.push({
        path: relativePath,
        digest: sha256(await fs.readFile(entryPath, "utf8"))
      });
    }
  }

  await collectChecksums(outputPath);
  checksums.files.sort((left, right) => left.path.localeCompare(right.path));
  await fs.writeFile(
    path.join(outputPath, ENTRYPOINTS.checksums),
    stableStringify(checksums),
    "utf8"
  );

  return {
    outputPath,
    manifest,
    checksums
  };
}
