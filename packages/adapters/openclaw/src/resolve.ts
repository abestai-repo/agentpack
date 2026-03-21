import fs from "node:fs/promises";
import path from "node:path";

import {
  analyzeConfigText,
  type OpenClawConfigAnalysis,
  pathExists,
  resolveOpenClawStateProbe
} from "./state.js";

export type OpenClawInputKind = "code" | "state" | "workspace" | "nested" | "unknown";
export type OpenClawRootKind = "code" | "state" | "workspace";

export interface OpenClawResolvedInput {
  inputPath: string;
  inputKind: OpenClawInputKind;
  detectedRootKind?: OpenClawRootKind;
  codeFolder?: string;
  stateDir?: string;
  configPath?: string;
  workspaceDirs: string[];
  workspaceSources: string[];
  analysis?: OpenClawConfigAnalysis;
  lastTouchedVersion?: string;
  customConfig?: boolean;
  agentIds: string[];
  managedSkillsDir?: string;
  extensionsDir?: string;
  credentialsDir?: string;
  sessionsRoots: string[];
  warnings: string[];
}

const WORKSPACE_DNA_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "USER.md",
  "IDENTITY.md",
  "TOOLS.md",
  "HEARTBEAT.md",
  "BOOTSTRAP.md"
] as const;

async function findAncestors(startPath: string) {
  const resolved = path.resolve(startPath);
  const stat = await fs.stat(resolved);
  const startDir = stat.isDirectory() ? resolved : path.dirname(resolved);
  const ancestors: string[] = [];
  let current = startDir;

  while (true) {
    ancestors.push(current);
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return ancestors;
}

async function looksLikeCodeRoot(candidate: string) {
  if (!(await pathExists(path.join(candidate, "package.json")))) {
    return false;
  }

  try {
    const packageJson = JSON.parse(
      await fs.readFile(path.join(candidate, "package.json"), "utf8")
    ) as { name?: string };
    return (
      packageJson.name === "openclaw" ||
      ((await pathExists(path.join(candidate, "openclaw.mjs"))) &&
        (await pathExists(path.join(candidate, "src", "version.ts"))))
    );
  } catch {
    return false;
  }
}

async function looksLikeStateRoot(candidate: string) {
  if (await pathExists(path.join(candidate, "openclaw.json"))) {
    return true;
  }

  const directorySignals = ["credentials", "extensions", "skills", "agents"] as const;
  const hits = await Promise.all(
    directorySignals.map((signal) => pathExists(path.join(candidate, signal)))
  );
  const hitCount = hits.filter(Boolean).length;
  const hasCredentials = hits[0];
  const hasAgents = hits[3];
  return hitCount >= 3 || ((hasCredentials || hasAgents) && hitCount >= 2);
}

async function looksLikeWorkspaceRoot(candidate: string) {
  if (await looksLikeCodeRoot(candidate)) {
    return false;
  }

  const fileSignals = await Promise.all([
    ...WORKSPACE_DNA_FILES.map((fileName) => pathExists(path.join(candidate, fileName))),
    pathExists(path.join(candidate, "MEMORY.md")),
    pathExists(path.join(candidate, "memory.md")),
    pathExists(path.join(candidate, "memory"))
  ]);

  return fileSignals.some(Boolean);
}

async function findNearestRoot(startPath: string, kind: OpenClawRootKind) {
  const ancestors = await findAncestors(startPath);

  for (const candidate of ancestors) {
    const matches =
      kind === "code"
        ? await looksLikeCodeRoot(candidate)
        : kind === "state"
          ? await looksLikeStateRoot(candidate)
          : await looksLikeWorkspaceRoot(candidate);
    if (matches) {
      return candidate;
    }
  }

  return undefined;
}

async function resolveWorkspaceDirsFromState(stateDir: string) {
  const warnings: string[] = [];
  const configPath = path.join(stateDir, "openclaw.json");
  const workspaceDirs = new Map<string, string>();
  const defaultWorkspaceDir = path.join(stateDir, "workspace");
  let analysis: OpenClawConfigAnalysis | undefined;

  if (await pathExists(defaultWorkspaceDir)) {
    workspaceDirs.set(defaultWorkspaceDir, "default-state-workspace");
  }

  if (await pathExists(configPath)) {
    const configText = await fs.readFile(configPath, "utf8");
    analysis = analyzeConfigText(configText);

    for (const candidate of analysis.workspaceCandidates) {
      const resolvedPath = path.isAbsolute(candidate.path)
        ? candidate.path
        : path.resolve(stateDir, candidate.path);

      if (await pathExists(resolvedPath)) {
        workspaceDirs.set(resolvedPath, candidate.source);
      } else {
        warnings.push(`Configured OpenClaw workspace path was not found: ${resolvedPath}`);
      }
    }
  }

  return {
    configPath: (await pathExists(configPath)) ? configPath : undefined,
    workspaceDirs: [...workspaceDirs.keys()].sort(),
    workspaceSources: [...workspaceDirs.values()],
    analysis
  };
}

function classifyInputKind(args: {
  inputPath: string;
  codeFolder?: string;
  stateDir?: string;
  workspaceDir?: string;
}): { inputKind: OpenClawInputKind; detectedRootKind?: OpenClawRootKind } {
  const normalizedInput = path.resolve(args.inputPath);

  if (args.codeFolder && normalizedInput === path.resolve(args.codeFolder)) {
    return { inputKind: "code", detectedRootKind: "code" };
  }

  if (args.stateDir && normalizedInput === path.resolve(args.stateDir)) {
    return { inputKind: "state", detectedRootKind: "state" };
  }

  if (args.workspaceDir && normalizedInput === path.resolve(args.workspaceDir)) {
    return { inputKind: "workspace", detectedRootKind: "workspace" };
  }

  const nestedRoot =
    args.workspaceDir && normalizedInput.startsWith(path.resolve(args.workspaceDir) + path.sep)
      ? "workspace"
      : args.stateDir && normalizedInput.startsWith(path.resolve(args.stateDir) + path.sep)
        ? "state"
        : args.codeFolder && normalizedInput.startsWith(path.resolve(args.codeFolder) + path.sep)
          ? "code"
          : undefined;

  return nestedRoot
    ? { inputKind: "nested", detectedRootKind: nestedRoot }
    : { inputKind: "unknown" };
}

export async function resolveOpenClawInput(inputPath: string): Promise<OpenClawResolvedInput> {
  const warnings: string[] = [];
  const resolvedInputPath = path.resolve(inputPath);
  const codeFolder = await findNearestRoot(resolvedInputPath, "code");
  let stateDir = await findNearestRoot(resolvedInputPath, "state");
  let workspaceDir = await findNearestRoot(resolvedInputPath, "workspace");
  let configPath: string | undefined;
  let workspaceDirs: string[] = [];
  let workspaceSources: string[] = [];
  let analysis: OpenClawConfigAnalysis | undefined;
  let lastTouchedVersion: string | undefined;
  let customConfig: boolean | undefined;
  let agentIds: string[] = [];

  if (stateDir) {
    const resolvedFromState = await resolveWorkspaceDirsFromState(stateDir);
    configPath = resolvedFromState.configPath;
    workspaceDirs = resolvedFromState.workspaceDirs;
    workspaceSources = resolvedFromState.workspaceSources;
    analysis = resolvedFromState.analysis;
    lastTouchedVersion = resolvedFromState.analysis?.lastTouchedVersion;
    customConfig = resolvedFromState.analysis?.customConfig;
    agentIds = resolvedFromState.analysis?.explicitAgentIds
      ? [...resolvedFromState.analysis.explicitAgentIds]
      : [];
  } else {
    const stateProbe = await resolveOpenClawStateProbe();
    warnings.push(...stateProbe.warnings);
    stateDir = stateProbe.stateDir;
    configPath = stateProbe.configPath;
    workspaceDirs = [...stateProbe.workspaceDirs];
    workspaceSources = [...stateProbe.workspaceSources];
    analysis = stateProbe.analysis;
    lastTouchedVersion = stateProbe.lastTouchedVersion;
    customConfig = stateProbe.customConfig;
    agentIds = [...stateProbe.agentIds];
  }

  if (workspaceDir && !workspaceDirs.includes(workspaceDir)) {
    workspaceDirs = [workspaceDir, ...workspaceDirs].sort();
    workspaceSources = ["input-workspace", ...workspaceSources];
  } else if (!workspaceDir && workspaceDirs.length > 0) {
    workspaceDir = workspaceDirs[0];
  }

  if (!stateDir && workspaceDir) {
    const candidateStateDir = path.dirname(workspaceDir);
    if (await looksLikeStateRoot(candidateStateDir)) {
      stateDir = candidateStateDir;
      if (!configPath && (await pathExists(path.join(candidateStateDir, "openclaw.json")))) {
        configPath = path.join(candidateStateDir, "openclaw.json");
      }
    }
  }

  const inputClassification = classifyInputKind({
    inputPath: resolvedInputPath,
    codeFolder,
    stateDir,
    workspaceDir
  });

  const managedSkillsDir =
    stateDir && (await pathExists(path.join(stateDir, "skills")))
      ? path.join(stateDir, "skills")
      : undefined;
  const extensionsDir =
    stateDir && (await pathExists(path.join(stateDir, "extensions")))
      ? path.join(stateDir, "extensions")
      : undefined;
  const credentialsDir =
    stateDir && (await pathExists(path.join(stateDir, "credentials")))
      ? path.join(stateDir, "credentials")
      : undefined;
  const sessionsRoots =
    stateDir && (await pathExists(path.join(stateDir, "agents")))
      ? (
          await fs.readdir(path.join(stateDir, "agents"), { withFileTypes: true })
        )
          .filter((entry) => entry.isDirectory())
          .map((entry) => {
            agentIds.push(entry.name);
            return path.join(stateDir as string, "agents", entry.name, "sessions");
          })
      : [];

  return {
    inputPath: resolvedInputPath,
    inputKind: inputClassification.inputKind,
    detectedRootKind: inputClassification.detectedRootKind,
    codeFolder,
    stateDir,
    configPath,
    workspaceDirs,
    workspaceSources,
    analysis,
    lastTouchedVersion,
    customConfig,
    agentIds: [...new Set(agentIds)].sort(),
    managedSkillsDir,
    extensionsDir,
    credentialsDir,
    sessionsRoots,
    warnings: [...new Set(warnings)].sort()
  };
}
