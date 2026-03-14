import fs from "node:fs/promises";
import path from "node:path";

import type { InspectResult } from "../../../domain/src/index.js";
import { openClawAdapterMetadata } from "./definitions.js";
import { pathExists, resolveOpenClawStateProbe } from "./state.js";

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
  stateProbeWarnings: string[];
  stateResolved: boolean;
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
    hints.push("Minimal mode should exclude memory, secrets, and session transcripts while preserving core workspace DNA.");
    hints.push("Standard mode should include workspace memory and richer non-secret state while excluding credentials and inline secrets.");
    hints.push("Full mode should reuse OpenClaw's native backup engine for the most faithful managed-state capture.");
  }

  if (args.stateProbeWarnings.length === 0 && args.stateResolved) {
    hints.push("This inspect result is close enough to drive an honest backup plan, not just framework detection.");
  }

  return hints;
}

export async function inspectOpenClaw(sourcePath: string): Promise<InspectResult> {
  const packageJsonPath = path.join(sourcePath, "package.json");
  const packageJson = JSON.parse(
    await fs.readFile(packageJsonPath, "utf8")
  ) as OpenClawPackageJson;
  const { topLevelDirectories, topLevelFiles } = await listTopLevelSurface(sourcePath);
  const scripts = packageJson.scripts ?? {};
  const notableScripts = NOTABLE_SCRIPT_KEYS.filter((scriptName) => scripts[scriptName]);
  const warnings: string[] = [];
  const stateProbe = await resolveOpenClawStateProbe();
  const workspaceSurfaces = await Promise.all(
    stateProbe.workspaceDirs.map((workspaceDir) => inspectWorkspaceSurface(workspaceDir, sourcePath))
  );

  if (!packageJson.bin?.openclaw) {
    warnings.push("OpenClaw CLI entrypoint was not declared in package.json bin.");
  }

  if (!topLevelDirectories.includes("src")) {
    warnings.push("Source tree src/ was not present at the repo root.");
  }

  warnings.push(...stateProbe.warnings);

  const repoConfigPaths = [
    "package.json",
    packageJson.bin?.openclaw,
    packageJson.main,
    topLevelFiles.includes("AGENTS.md") ? "AGENTS.md" : undefined,
    topLevelDirectories.includes("skills") ? "skills/" : undefined,
    topLevelDirectories.includes("extensions") ? "extensions/" : undefined,
    topLevelDirectories.includes("src") ? "src/" : undefined,
    topLevelDirectories.includes("docs") ? "docs/" : undefined
  ];

  const stateConfigPaths = [
    stateProbe.configPath ? relativeTo(sourcePath, stateProbe.configPath) : undefined,
    stateProbe.stateDir ? relativeTo(sourcePath, stateProbe.stateDir) : undefined,
    stateProbe.managedSkillsDir ? relativeTo(sourcePath, stateProbe.managedSkillsDir) : undefined,
    stateProbe.extensionsDir ? relativeTo(sourcePath, stateProbe.extensionsDir) : undefined,
    stateProbe.credentialsDir ? relativeTo(sourcePath, stateProbe.credentialsDir) : undefined,
    ...workspaceSurfaces.map((surface) => surface.workspaceDir)
  ];

  const dnaPromptSources = workspaceSurfaces.flatMap((surface) =>
    surface.dnaFiles.filter((filePath) => !filePath.endsWith("TOOLS.md"))
  );
  const toolRefs = [
    ...(topLevelDirectories.includes("extensions") ? ["extensions/"] : []),
    ...(notableScripts.length > 0 ? ["package.json:scripts"] : []),
    ...(stateProbe.extensionsDir ? [relativeTo(sourcePath, stateProbe.extensionsDir)] : []),
    ...(stateProbe.managedSkillsDir ? [relativeTo(sourcePath, stateProbe.managedSkillsDir)] : []),
    ...workspaceSurfaces.flatMap((surface) => surface.skillsPaths),
    ...workspaceSurfaces.flatMap((surface) =>
      surface.dnaFiles.filter((filePath) => filePath.endsWith("TOOLS.md"))
    )
  ];
  const workflowRefs = [
    ...(topLevelDirectories.includes("src") ? ["src/"] : []),
    ...(topLevelDirectories.includes("apps") ? ["apps/"] : []),
    ...(stateProbe.analysis?.hasChannelsSignal ? [relativeTo(sourcePath, stateProbe.configPath ?? "")] : []),
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
    ...(stateProbe.analysis?.hasMemorySignal && stateProbe.configPath
      ? [relativeTo(sourcePath, stateProbe.configPath)]
      : []),
    ...workspaceSurfaces.flatMap((surface) => surface.memoryPaths)
  ];
  const promptSources = uniqueSorted([
    topLevelDirectories.includes("docs") ? "docs/" : undefined,
    topLevelFiles.includes("AGENTS.md") ? "AGENTS.md" : undefined,
    ...dnaPromptSources
  ]);
  const configPaths = uniqueSorted([...repoConfigPaths, ...stateConfigPaths]);

  return {
    targetKind: "live-agent",
    adapterId: "openclaw",
    framework: "openclaw",
    displayName: "OpenClaw",
    sourcePath,
    sourceVersion: packageJson.version,
    package: {
      name: packageJson.name ?? "openclaw",
      version: packageJson.version ?? "unknown",
      displayName: packageJson.name ?? "openclaw",
      description: packageJson.description,
      tags: []
    },
    prompts: {
      count: promptSources.length || undefined,
      sources: promptSources,
      notes: [
        stateProbe.configFound
          ? "Inspection resolved OpenClaw-managed workspaces and collected core workspace DNA files for backup planning."
          : "Only repository-local prompt surfaces were available because no OpenClaw state directory was resolved."
      ]
    },
    models: {
      references: uniqueSorted([
        stateProbe.analysis?.hasModelsSignal && stateProbe.configPath
          ? relativeTo(sourcePath, stateProbe.configPath)
          : undefined
      ]),
      notes: [
        stateProbe.analysis?.hasModelsSignal
          ? "Model or provider configuration signals were found in the active OpenClaw config."
          : "No model configuration signal was identified in the active OpenClaw config."
      ]
    },
    tools: {
      count: toolRefs.length || undefined,
      references: uniqueSorted(toolRefs),
      notes: [
        stateProbe.analysis?.hasPluginsSignal
          ? "Plugin install metadata appears in the active OpenClaw config and should travel with non-secret modes."
          : "No explicit plugin install metadata signal was identified in the active config."
      ]
    },
    workflows: {
      count: workflowRefs.length || undefined,
      references: uniqueSorted(workflowRefs),
      notes: [
        stateProbe.analysis?.hasChannelsSignal
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
      stateProbeWarnings: stateProbe.warnings,
      stateResolved: stateProbe.configFound
    }),
    warnings: uniqueSorted(warnings)
  };
}
