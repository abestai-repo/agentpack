import fs from "node:fs/promises";
import path from "node:path";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execCallback);

import type { InspectResult } from "../../../domain/src/index.js";
import { openClawAdapterMetadata } from "./definitions.js";
import { resolveOpenClawInput } from "./resolve.js";
import { pathExists } from "./state.js";

async function getOpenclawGlobalPath(): Promise<string | undefined> {
  try {
    const { stdout } = await exec("which openclaw");
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function getOpenclawGlobalVersion(): Promise<string | undefined> {
  try {
    const { stdout } = await exec("openclaw --version");
    const match = stdout.match(/OpenClaw\s+([0-9]+\.[0-9]+\.[0-9]+)/i);
    if (match && match[1]) {
      return match[1];
    }
  } catch {
    return undefined;
  }
}

interface OpenClawPackageJson {
  name?: string;
  version?: string;
  description?: string;
  license?: string;
  homepage?: string;
  repository?: string | { url?: string };
  bin?: Record<string, string>;
  main?: string;
  exports?: Record<string, unknown>;
  scripts?: Record<string, string>;
  engines?: {
    node?: string;
  };
  packageManager?: string;
  type?: string;
}

interface WorkspaceSurfaceSummary {
  workspaceDir: string;
  dnaFiles: string[];
  memoryPaths: string[];
  skillsPaths: string[];
  canvasPaths: string[];
}

const NOTABLE_SCRIPT_KEYS = [
  "openclaw",
  "dev",
  "build",
  "test",
  "ui:build",
  "gateway:watch",
  "tui",
  "android:run",
  "ios:run",
  "backup:create",
  "backup:verify"
] as const;

const WORKSPACE_DNA_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "USER.md",
  "IDENTITY.md",
  "TOOLS.md",
  "HEARTBEAT.md",
  "BOOTSTRAP.md"
] as const;

const MEMORY_PATHS = ["MEMORY.md", "memory.md", "memory"] as const;

function isHumanRelevantDirectory(name: string) {
  return !name.startsWith(".");
}

function normalizeRepository(repository: OpenClawPackageJson["repository"]) {
  if (typeof repository === "string") {
    return repository;
  }

  return repository?.url;
}

function uniqueSorted(values: Iterable<string | undefined>) {
  return [...new Set([...values].filter((value): value is string => Boolean(value)))]
    .sort();
}

function relativeTo(basePath: string, targetPath: string) {
  return path.relative(basePath, targetPath).replace(/\\/g, "/") || ".";
}

async function listTopLevelSurface(sourcePath: string) {
  const topLevelEntries = await fs.readdir(sourcePath, { withFileTypes: true });
  const topLevelDirectories = topLevelEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((entry) => isHumanRelevantDirectory(entry))
    .sort();
  const topLevelFiles = topLevelEntries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((entry) => isHumanRelevantDirectory(entry))
    .sort();

  return {
    topLevelDirectories,
    topLevelFiles
  };
}

async function inspectWorkspaceSurface(workspaceDir: string, sourcePath: string): Promise<WorkspaceSurfaceSummary> {
  const dnaFiles: string[] = [];
  const memoryPaths: string[] = [];
  const skillsPaths: string[] = [];
  const canvasPaths: string[] = [];

  for (const fileName of WORKSPACE_DNA_FILES) {
    const targetPath = path.join(workspaceDir, fileName);
    if (await pathExists(targetPath)) {
      dnaFiles.push(relativeTo(sourcePath, targetPath));
    }
  }

  for (const memoryPath of MEMORY_PATHS) {
    const targetPath = path.join(workspaceDir, memoryPath);
    if (await pathExists(targetPath)) {
      memoryPaths.push(relativeTo(sourcePath, targetPath));
    }
  }

  const workspaceSkillsDir = path.join(workspaceDir, "skills");
  if (await pathExists(workspaceSkillsDir)) {
    skillsPaths.push(relativeTo(sourcePath, workspaceSkillsDir));
  }

  const canvasDir = path.join(workspaceDir, "canvas");
  if (await pathExists(canvasDir)) {
    canvasPaths.push(relativeTo(sourcePath, canvasDir));
  }

  return {
    workspaceDir: relativeTo(sourcePath, workspaceDir),
    dnaFiles,
    memoryPaths,
    skillsPaths,
    canvasPaths
  };
}

function buildFeatureHints(args: {
  directories: string[];
  packageJson: OpenClawPackageJson;
  workspaceSurfaces: WorkspaceSurfaceSummary[];
  resolvedInputKind: string;
  stateResolved: boolean;
  hasConfigSignal: boolean;
}) {
  const hints: string[] = [];
  const exportsCount = Object.keys(args.packageJson.exports ?? {}).length;
  const workspaceCount = args.workspaceSurfaces.length;
  const memorySurfaceCount = args.workspaceSurfaces.reduce(
    (total, surface) => total + surface.memoryPaths.length,
    0
  );

  if (args.directories.includes("skills")) {
    hints.push("Repository-local skill packs detected in skills/.");
  }

  if (args.directories.includes("extensions")) {
    hints.push("Repository-local extension surface detected in extensions/.");
  }

  if (args.directories.includes("ui")) {
    hints.push("Dedicated UI surface detected in ui/.");
  }

  if (args.directories.includes("apps")) {
    hints.push("Multi-app runtime surface detected in apps/.");
  }

  if (args.packageJson.bin?.openclaw) {
    hints.push(`Primary CLI entrypoint exposed via ${args.packageJson.bin.openclaw}.`);
  }

  if (workspaceCount > 0) {
    hints.push(`Active OpenClaw state resolved ${workspaceCount} workspace surface(s).`);
  }

  if (memorySurfaceCount > 0) {
    hints.push(`Memory surfaces detected in active workspaces (${memorySurfaceCount} path(s)).`);
  }

  if (exportsCount >= 10) {
    hints.push(`Large plugin or SDK export surface detected (${exportsCount} exports).`);
  }

  if (args.stateResolved) {
    hints.push(`Flexible input normalization resolved this target as ${args.resolvedInputKind}.`);
    hints.push("Minimal mode should exclude memory, secrets, and session transcripts while preserving core workspace DNA.");
    hints.push("Standard mode should include workspace memory and richer non-secret state while excluding credentials and inline secrets.");
    hints.push("Full mode should include credentials, sessions, and full workspace/state payloads.");
  }

  if (args.hasConfigSignal && args.stateResolved) {
    hints.push("This inspect result is close enough to drive an honest backup plan, not just framework detection.");
  }

  return hints;
}

export async function inspectOpenClaw(sourcePath: string): Promise<InspectResult> {
  const resolved = await resolveOpenClawInput(sourcePath);
  const codeRoot = resolved.codeFolder ?? sourcePath;
  const packageJsonPath = path.join(codeRoot, "package.json");
  const packageJson = await pathExists(packageJsonPath)
    ? (JSON.parse(await fs.readFile(packageJsonPath, "utf8")) as OpenClawPackageJson)
    : ({} as OpenClawPackageJson);
  
  let detectedVersion = await getOpenclawGlobalVersion();
  if (!detectedVersion && packageJson.version) {
    detectedVersion = packageJson.version;
  }
  if (!detectedVersion && resolved.lastTouchedVersion) {
    detectedVersion = resolved.lastTouchedVersion;
  }
  
  const frameworkPath = await getOpenclawGlobalPath();

  const { topLevelDirectories, topLevelFiles } = resolved.codeFolder
    ? await listTopLevelSurface(resolved.codeFolder)
    : { topLevelDirectories: [] as string[], topLevelFiles: [] as string[] };
  const scripts = packageJson.scripts ?? {};
  const notableScripts = NOTABLE_SCRIPT_KEYS.filter((scriptName) => scripts[scriptName]);
  const warnings: string[] = [];
  const workspaceSurfaces = await Promise.all(
    resolved.workspaceDirs.map((workspaceDir) => inspectWorkspaceSurface(workspaceDir, sourcePath))
  );

  if (resolved.codeFolder && !packageJson.bin?.openclaw) {
    warnings.push("OpenClaw CLI entrypoint was not declared in package.json bin.");
  }

  if (resolved.codeFolder && !topLevelDirectories.includes("src")) {
    warnings.push("Source tree src/ was not present at the repo root.");
  }

  warnings.push(...resolved.warnings);

  const repoConfigPaths = [
    resolved.codeFolder ? relativeTo(sourcePath, packageJsonPath) : undefined,
    resolved.codeFolder && packageJson.bin?.openclaw
      ? relativeTo(sourcePath, path.join(resolved.codeFolder, packageJson.bin.openclaw))
      : undefined,
    resolved.codeFolder && packageJson.main
      ? relativeTo(sourcePath, path.join(resolved.codeFolder, packageJson.main))
      : undefined,
    resolved.codeFolder && topLevelFiles.includes("AGENTS.md")
      ? relativeTo(sourcePath, path.join(resolved.codeFolder, "AGENTS.md"))
      : undefined,
    resolved.codeFolder && topLevelDirectories.includes("skills")
      ? relativeTo(sourcePath, path.join(resolved.codeFolder, "skills"))
      : undefined,
    resolved.codeFolder && topLevelDirectories.includes("extensions")
      ? relativeTo(sourcePath, path.join(resolved.codeFolder, "extensions"))
      : undefined,
    resolved.codeFolder && topLevelDirectories.includes("src")
      ? relativeTo(sourcePath, path.join(resolved.codeFolder, "src"))
      : undefined,
    resolved.codeFolder && topLevelDirectories.includes("docs")
      ? relativeTo(sourcePath, path.join(resolved.codeFolder, "docs"))
      : undefined
  ];

  const stateConfigPaths = [
    resolved.configPath ? relativeTo(sourcePath, resolved.configPath) : undefined,
    resolved.stateDir ? relativeTo(sourcePath, resolved.stateDir) : undefined,
    resolved.managedSkillsDir ? relativeTo(sourcePath, resolved.managedSkillsDir) : undefined,
    resolved.extensionsDir ? relativeTo(sourcePath, resolved.extensionsDir) : undefined,
    resolved.credentialsDir ? relativeTo(sourcePath, resolved.credentialsDir) : undefined,
    ...workspaceSurfaces.map((surface) => surface.workspaceDir)
  ];

  const dnaPromptSources = workspaceSurfaces.flatMap((surface) =>
    surface.dnaFiles.filter((filePath) => !filePath.endsWith("TOOLS.md"))
  );
  const toolRefs = [
    ...(resolved.codeFolder && topLevelDirectories.includes("extensions")
      ? [relativeTo(sourcePath, path.join(resolved.codeFolder, "extensions"))]
      : []),
    ...(notableScripts.length > 0 && resolved.codeFolder ? ["package.json:scripts"] : []),
    ...(resolved.extensionsDir ? [relativeTo(sourcePath, resolved.extensionsDir)] : []),
    ...(resolved.managedSkillsDir ? [relativeTo(sourcePath, resolved.managedSkillsDir)] : []),
    ...workspaceSurfaces.flatMap((surface) => surface.skillsPaths),
    ...workspaceSurfaces.flatMap((surface) =>
      surface.dnaFiles.filter((filePath) => filePath.endsWith("TOOLS.md"))
    )
  ];
  const workflowRefs = [
    ...(resolved.codeFolder && topLevelDirectories.includes("src")
      ? [relativeTo(sourcePath, path.join(resolved.codeFolder, "src"))]
      : []),
    ...(resolved.codeFolder && topLevelDirectories.includes("apps")
      ? [relativeTo(sourcePath, path.join(resolved.codeFolder, "apps"))]
      : []),
    ...(resolved.analysis?.hasChannelsSignal && resolved.configPath
      ? [relativeTo(sourcePath, resolved.configPath)]
      : []),
    ...workspaceSurfaces.flatMap((surface) =>
      surface.dnaFiles.filter(
        (filePath) =>
          filePath.endsWith("BOOTSTRAP.md") ||
          filePath.endsWith("HEARTBEAT.md") ||
          filePath.endsWith("IDENTITY.md")
      )
    )
  ];
  const memoryRefs = [
    ...(resolved.analysis?.hasMemorySignal && resolved.configPath
      ? [relativeTo(sourcePath, resolved.configPath)]
      : []),
    ...workspaceSurfaces.flatMap((surface) => surface.memoryPaths)
  ];
  const promptSources = uniqueSorted([
    resolved.codeFolder && topLevelDirectories.includes("docs")
      ? relativeTo(sourcePath, path.join(resolved.codeFolder, "docs"))
      : undefined,
    resolved.codeFolder && topLevelFiles.includes("AGENTS.md")
      ? relativeTo(sourcePath, path.join(resolved.codeFolder, "AGENTS.md"))
      : undefined,
    ...dnaPromptSources
  ]);
  const configPaths = uniqueSorted([...repoConfigPaths, ...stateConfigPaths]);
  const frameworkDisplayName = "OpenClaw";
  const packageName = packageJson.name ?? "openclaw";

  return {
    targetKind: "live-agent",
    adapterId: "openclaw",
    framework: "openclaw",
    frameworkPath,
    displayName: frameworkDisplayName,
    sourcePath,
    sourceVersion: detectedVersion,
    package: {
      name: packageName,
      version: packageJson.version ?? "unknown",
      displayName: packageName,
      description: packageJson.description,
      tags: []
    },
    prompts: {
      count: promptSources.length || undefined,
      sources: promptSources,
      notes: [
        resolved.workspaceDirs.length > 0
          ? "Inspection resolved OpenClaw-managed workspaces and collected core workspace DNA files for backup planning."
          : "Only repository-local prompt surfaces were available because no OpenClaw workspace could be resolved."
      ]
    },
    models: {
      references: uniqueSorted([
        resolved.analysis?.hasModelsSignal && resolved.configPath
          ? relativeTo(sourcePath, resolved.configPath)
          : undefined
      ]),
      notes: [
        resolved.analysis?.hasModelsSignal
          ? "Model or provider configuration signals were found in the active OpenClaw config."
          : "No model configuration signal was identified in the active OpenClaw config."
      ]
    },
    tools: {
      count: toolRefs.length || undefined,
      references: uniqueSorted(toolRefs),
      notes: [
        resolved.analysis?.hasPluginsSignal
          ? "Plugin install metadata appears in the active OpenClaw config and should travel with non-secret modes."
          : "No explicit plugin install metadata signal was identified in the active config."
      ]
    },
    workflows: {
      count: workflowRefs.length || undefined,
      references: uniqueSorted(workflowRefs),
      notes: [
        resolved.analysis?.hasChannelsSignal
          ? "Channel/runtime workflow signals were detected in the active OpenClaw config."
          : "Workflow discovery is inferred from bootstrap-style files and runtime layout, not executed state."
      ]
    },
    memory: {
      kind: memoryRefs.length > 0 ? "workspace-file" : "none-detected",
      references: uniqueSorted(memoryRefs),
      notes: [
        memoryRefs.length > 0
          ? "Memory is treated as a first-class backup class. Minimal should exclude it; standard and full should include it."
          : "No memory surfaces were detected in resolved workspaces."
      ]
    },
    adapter: {
      adapterId: openClawAdapterMetadata.id,
      adapterVersion: openClawAdapterMetadata.adapterVersion,
      framework: openClawAdapterMetadata.framework,
      sourceVersion: packageJson.version,
      capabilities: openClawAdapterMetadata.capabilities,
      relevantPaths: configPaths
    },
    runtime: {
      cli: packageJson.bin?.openclaw,
      main: packageJson.main,
      moduleType: packageJson.type,
      nodeEngine: packageJson.engines?.node,
      packageManager: packageJson.packageManager,
      exportsCount: Object.keys(packageJson.exports ?? {}).length,
      scriptCount: Object.keys(scripts).length,
      notableScripts: [...notableScripts]
    },
    configPaths,
    packageDetails: {
      license: packageJson.license,
      homepage: packageJson.homepage,
      repository: normalizeRepository(packageJson.repository)
    },
    workspace: {
      topLevelDirectories,
      docsPresent: topLevelDirectories.includes("docs"),
      testsPresent: topLevelDirectories.includes("test"),
      uiPresent: topLevelDirectories.includes("ui"),
      appsPresent: topLevelDirectories.includes("apps"),
      extensionsPresent: topLevelDirectories.includes("extensions"),
      skillsPresent: topLevelDirectories.includes("skills"),
      packagesPresent: topLevelDirectories.includes("packages")
    },
    featureHints: buildFeatureHints({
      directories: topLevelDirectories,
      packageJson,
      workspaceSurfaces,
      resolvedInputKind: resolved.inputKind,
      stateResolved: Boolean(resolved.stateDir),
      hasConfigSignal: Boolean(resolved.configPath)
    }),
    warnings: uniqueSorted([
      ...warnings,
      ...(resolved.inputKind === "unknown"
        ? ["Input path did not strongly resolve to an OpenClaw code, state, or workspace root."]
        : [])
    ]),
    details: {
      agentCount: resolved.agentIds.length || undefined,
      agentIds: resolved.agentIds,
      detectedRootKind: resolved.detectedRootKind,
      customConfig: resolved.customConfig
    }
  };
}
