import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execCallback);

import {
  createMinimalPackageCompatibilityDocument,
  createMinimalAeggMetadata,
  createMinimalCam,
  type AgentExtractResult,
  type CamDocument,
  type ExtractedAsset,
  type PackMode,
  type ExtractInput
} from "../../../domain/src/index.js";
import { openClawAdapterMetadata } from "./definitions.js";
import { resolveOpenClawInput } from "./resolve.js";
import { pathExists, readJsonFile } from "./state.js";

interface OpenClawPackageJson {
  name?: string;
  version?: string;
  description?: string;
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

const MEMORY_FILE_NAMES = ["MEMORY.md", "memory.md"] as const;
const SECRET_KEY_PATTERN = /(api.?key|token|secret|password|credential|cookie|clientsecret|webhooksecret)/i;

async function readOptionalText(filePath: string) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function normalizeName(value: string | undefined) {
  return value?.trim() || "OpenClaw Agent";
}

function toSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "openclaw-agent";
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function envPlaceholder(value: string) {
  return /^\$\{[^}]+\}$/.test(value.trim());
}

function sanitizeConfig(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeConfig(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => {
      if (typeof nested === "string" && SECRET_KEY_PATTERN.test(key) && !envPlaceholder(nested)) {
        return [key, "__OPENCLAW_REDACTED__"];
      }

      return [key, sanitizeConfig(nested)];
    })
  );
}

function stableJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function createToolSet(args: {
  hasExtensionsDir: boolean;
  hasWorkspaceSkills: boolean;
  hasManagedSkillsDir: boolean;
  hasPluginsSignal: boolean;
}) {
  const tools: CamDocument["tools"] = [];

  if (args.hasExtensionsDir) {
    tools.push({
      id: "openclaw-extensions",
      kind: "custom",
      enabled: true,
      display_name: "OpenClaw Extensions",
      capabilities: ["runtime-extension"],
      config_ref: "state:extensions"
    });
  }

  if (args.hasWorkspaceSkills || args.hasManagedSkillsDir) {
    tools.push({
      id: "openclaw-skills",
      kind: "knowledge",
      enabled: true,
      display_name: "OpenClaw Skills",
      capabilities: ["skill-pack"],
      config_ref: args.hasManagedSkillsDir ? "state:skills" : "workspace:skills"
    });
  }

  if (args.hasPluginsSignal) {
    tools.push({
      id: "openclaw-plugins",
      kind: "custom",
      enabled: true,
      display_name: "OpenClaw Plugins",
      capabilities: ["plugin-runtime"],
      config_ref: "state:config.plugins"
    });
  }

  return tools;
}

function createWorkflows(hasChannelsSignal: boolean, hasBootstrapSignal: boolean) {
  const workflows: CamDocument["workflows"] = [];

  if (hasChannelsSignal) {
    workflows.push({
      id: "channel-runtime",
      name: "Channel Runtime",
      kind: "pipeline",
      steps: [
        { id: "ingest", type: "channel_ingest" },
        { id: "reason", type: "reason" },
        { id: "respond", type: "channel_emit" }
      ]
    });
  }

  if (hasBootstrapSignal) {
    workflows.push({
      id: "bootstrap-sequence",
      name: "Bootstrap Sequence",
      kind: "pipeline",
      steps: [
        { id: "load-dna", type: "load_context" },
        { id: "initialize", type: "initialize_runtime" }
      ]
    });
  }

  return workflows;
}

async function addFileAsset(
  assets: ExtractedAsset[],
  sourcePath: string,
  archivePath: string
) {
  if (await pathExists(sourcePath)) {
    assets.push({
      archivePath,
      kind: "file",
      sourcePath
    });
  }
}

async function addDirectoryAsset(
  assets: ExtractedAsset[],
  sourcePath: string,
  archivePath: string
) {
  if (await pathExists(sourcePath)) {
    assets.push({
      archivePath,
      kind: "directory",
      sourcePath
    });
  }
}

function addVirtualAsset(assets: ExtractedAsset[], archivePath: string, content: string) {
  assets.push({
    archivePath,
    kind: "virtual",
    content
  });
}

async function buildAssets(args: {
  mode: PackMode;
  configPath?: string;
  rawConfig?: unknown;
  sanitizedConfig?: unknown;
  managedSkillsDir?: string;
  extensionsDir?: string;
  credentialsDir?: string;
  workspaceDirs: string[];
  sessionsRoots: string[];
}) {
  const assets: ExtractedAsset[] = [];

  if (args.mode === "full") {
    try {
       const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentpack-full-'));
       const { stdout } = await exec(`openclaw backup create --verify --json --output "${tmpDir}"`);
       const backupResult = JSON.parse(stdout);
       
       if (backupResult.verified && backupResult.archivePath) {
          await addFileAsset(assets, backupResult.archivePath, `assets/native-backup/${path.basename(backupResult.archivePath)}`);
       } else {
          throw new Error("OpenClaw backup verification failed.");
       }
    } catch (err: any) {
       console.warn(`Warning: Native openclaw backup failed, falling back to manual capture. (${err.message})`);
       if (args.rawConfig) {
         addVirtualAsset(assets, "assets/config/openclaw.full.json", stableJson(args.rawConfig));
       }
       if (args.configPath) {
         await addFileAsset(assets, args.configPath, "assets/raw/openclaw.json");
       }
       if (args.credentialsDir) {
         await addDirectoryAsset(assets, args.credentialsDir, "assets/state/credentials");
       }
       for (const [index, workspaceDir] of args.workspaceDirs.entries()) {
         await addDirectoryAsset(assets, workspaceDir, `assets/workspaces/workspace-${index + 1}`);
       }
       for (const [index, sessionsRoot] of args.sessionsRoots.entries()) {
         await addDirectoryAsset(assets, sessionsRoot, `assets/state/sessions-${index + 1}`);
       }
    }
  } else if (args.sanitizedConfig) {
    addVirtualAsset(assets, "assets/config/openclaw.sanitized.json", stableJson(args.sanitizedConfig));
  }

  if (args.managedSkillsDir) {
    await addDirectoryAsset(assets, args.managedSkillsDir, "assets/state/skills");
  }

  if (args.extensionsDir) {
    await addDirectoryAsset(assets, args.extensionsDir, "assets/state/extensions");
  }

  for (const [index, workspaceDir] of args.workspaceDirs.entries()) {
    const workspaceArchiveRoot = `assets/workspaces/workspace-${index + 1}`;
    for (const fileName of WORKSPACE_DNA_FILES) {
      await addFileAsset(assets, path.join(workspaceDir, fileName), `${workspaceArchiveRoot}/${fileName}`);
    }

    await addDirectoryAsset(assets, path.join(workspaceDir, "skills"), `${workspaceArchiveRoot}/skills`);

    if (args.mode !== "minimal") {
      for (const fileName of MEMORY_FILE_NAMES) {
        await addFileAsset(assets, path.join(workspaceDir, fileName), `${workspaceArchiveRoot}/${fileName}`);
      }
      await addDirectoryAsset(assets, path.join(workspaceDir, "memory"), `${workspaceArchiveRoot}/memory`);
      await addDirectoryAsset(assets, path.join(workspaceDir, "canvas"), `${workspaceArchiveRoot}/canvas`);
    }
  }

  return assets;
}

export async function extractOpenClaw(
  input: ExtractInput
): Promise<AgentExtractResult> {
  const mode = input.mode ?? "standard";
  const sourcePath = input.sourcePath;
  const resolved = await resolveOpenClawInput(sourcePath);
  
  let targetWorkspaceDirs = resolved.workspaceDirs;
  let targetSessionsRoots = resolved.sessionsRoots;
  
  if (input.agentId && input.agentId !== "main" && input.agentId !== "default") {
     const agentConfigPath = resolved.configPath;
     if (agentConfigPath) {
        // Find the specific agent's workspace if segregated
        try {
           const configText = await fs.readFile(agentConfigPath, "utf8");
           const configData = JSON.parse(configText);
           const agentsList = configData?.agents?.list || [];
           const agentMatch = agentsList.find((a: any) => a.id === input.agentId);
           
           if (agentMatch && agentMatch.workspaceDir) {
              const absPath = path.isAbsolute(agentMatch.workspaceDir) ? agentMatch.workspaceDir : path.resolve(path.dirname(agentConfigPath), agentMatch.workspaceDir);
              targetWorkspaceDirs = [absPath];
           }
        } catch {}
     }
     
     // Filter sessions root
     if (resolved.stateDir) {
        targetSessionsRoots = [path.join(resolved.stateDir, "agents", input.agentId, "sessions")];
     }
  }

  const packageJson = resolved.codeFolder
    ? ((await readJsonFile<OpenClawPackageJson>(path.join(resolved.codeFolder, "package.json"))) ?? {})
    : {};
  const repoAgentsText = resolved.codeFolder
    ? await readOptionalText(path.join(resolved.codeFolder, "AGENTS.md"))
    : undefined;
  const rawConfig = resolved.configPath ? await readJsonFile<unknown>(resolved.configPath) : undefined;
  const sanitizedConfig = rawConfig ? sanitizeConfig(rawConfig) : undefined;
  const workspaceAgentTexts = await Promise.all(
    targetWorkspaceDirs.map(async (workspaceDir) => {
      const dnaFiles = await Promise.all(
        WORKSPACE_DNA_FILES.map(async (fileName) => ({
          fileName,
          exists: await pathExists(path.join(workspaceDir, fileName)),
          text: await readOptionalText(path.join(workspaceDir, fileName))
        }))
      );

      const memorySignals = await Promise.all([
        ...MEMORY_FILE_NAMES.map((fileName) => pathExists(path.join(workspaceDir, fileName))),
        pathExists(path.join(workspaceDir, "memory"))
      ]);

      return {
        workspaceDir,
        dnaFiles,
        hasMemory: memorySignals.some(Boolean),
        hasSkillsDir: await pathExists(path.join(workspaceDir, "skills")),
        hasCanvasDir: await pathExists(path.join(workspaceDir, "canvas"))
      };
    })
  );

  const promptSections = unique([
    repoAgentsText?.trim(),
    ...workspaceAgentTexts.flatMap((item) =>
      item.dnaFiles
        .filter((file) => file.fileName === "AGENTS.md" && file.text?.trim())
        .map((file) => file.text?.trim())
    )
  ].filter((value): value is string => Boolean(value)));

  const hasBootstrapSignal = workspaceAgentTexts.some((item) =>
    item.dnaFiles.some((file) => file.fileName === "BOOTSTRAP.md" && Boolean(file.exists))
  );
  const hasMemorySurface = workspaceAgentTexts.some((item) => item.hasMemory);
  const hasWorkspaceSkills = workspaceAgentTexts.some((item) => item.hasSkillsDir);
  const displayName = normalizeName(packageJson.name);
  const description = packageJson.description?.trim();
  const tags = unique([
    "openclaw",
    mode,
    ...(resolved.extensionsDir ? ["extensions"] : []),
    ...(resolved.managedSkillsDir || hasWorkspaceSkills ? ["skills"] : []),
    ...(mode !== "minimal" && hasMemorySurface ? ["memory"] : [])
  ]).sort();
  const assets = await buildAssets({
    mode,
    configPath: resolved.configPath,
    rawConfig,
    sanitizedConfig,
    managedSkillsDir: resolved.managedSkillsDir,
    extensionsDir: resolved.extensionsDir,
    credentialsDir: resolved.credentialsDir,
    workspaceDirs: targetWorkspaceDirs,
    sessionsRoots: targetSessionsRoots
  });

  const excluded = [
    ...(mode === "minimal" ? ["MEMORY.md", "memory.md", "memory/"] : []),
    ...(mode !== "full" ? ["credentials/", "inline secret values", "session transcripts"] : [])
  ];

  const cam = createMinimalCam({
    agent: {
      name: displayName,
      slug: toSlug(displayName),
      description,
      tags
    },
    instructions: promptSections.length > 0
      ? {
          system_prompt: promptSections.join("\n\n---\n\n")
        }
      : {},
    tools: createToolSet({
      hasExtensionsDir: Boolean(resolved.extensionsDir),
      hasWorkspaceSkills,
      hasManagedSkillsDir: Boolean(resolved.managedSkillsDir),
      hasPluginsSignal: Boolean(resolved.analysis?.hasPluginsSignal)
    }),
    memory: mode === "minimal"
      ? {
          enabled: false,
          kind: "none"
        }
      : {
          enabled: hasMemorySurface || Boolean(resolved.analysis?.hasMemorySignal),
          kind: hasMemorySurface || resolved.analysis?.hasMemorySignal ? "custom" : "none",
          storage: {
            location: resolved.stateDir ? "openclaw-state" : "workspace",
            provider: "openclaw"
          }
        },
    workflows: createWorkflows(Boolean(resolved.analysis?.hasChannelsSignal), hasBootstrapSignal),
    environment: {
      variables: [],
      platform: {
        os: [],
        arch: []
      }
    },
    extensions: {
      openclaw: {
        mode,
        custom_config: resolved.customConfig ?? false,
        input_path: resolved.inputPath,
        detected_input_kind: resolved.inputKind,
        detected_root_kind: resolved.detectedRootKind,
        code_folder: resolved.codeFolder,
        state_dir: resolved.stateDir,
        config_path: resolved.configPath,
        workspace_dirs: resolved.workspaceDirs,
        plugin_dirs: resolved.extensionsDir ? [resolved.extensionsDir] : [],
        skill_dirs: unique([
          ...(resolved.managedSkillsDir ? [resolved.managedSkillsDir] : []),
          ...resolved.workspaceDirs.map((workspaceDir) => path.join(workspaceDir, "skills"))
        ]),
        assets: assets.map((asset) => asset.archivePath),
        excluded
      }
    },
    source: {
      framework: "openclaw",
      framework_version: packageJson.version ?? "unknown",
      adapter_version: openClawAdapterMetadata.adapterVersion,
      input_path: resolved.inputPath,
      detected_input_kind: resolved.inputKind,
      code_folder: resolved.codeFolder,
      state_dir: resolved.stateDir,
      config_path: resolved.configPath,
      workspace_dirs: resolved.workspaceDirs,
      plugin_dirs: resolved.extensionsDir ? [resolved.extensionsDir] : [],
      skill_dirs: unique([
        ...(resolved.managedSkillsDir ? [resolved.managedSkillsDir] : []),
        ...resolved.workspaceDirs.map((workspaceDir) => path.join(workspaceDir, "skills"))
      ])
    },
    metadata: {
      created_at: new Date().toISOString(),
      created_by: "agentpack",
      created_by_version: "0.1.0",
      mode
    }
  });

  return {
    cam,
    metadata: createMinimalAeggMetadata({
      display: {
        title: displayName,
        summary: description || `OpenClaw ${mode} package extracted by AgentPack.`,
        tags
      },
      provenance: {
        created_by: "agentpack",
        created_by_version: "0.1.0",
        source_framework: "openclaw",
        source_adapter_version: openClawAdapterMetadata.adapterVersion
      }
    }),
    compatibility: createMinimalPackageCompatibilityDocument({
      generated_at: new Date().toISOString(),
      source_framework: "openclaw",
      targets: [
        {
          framework: "openclaw",
          status: "supported",
          score: 1
        }
      ]
    }),
    packageName: `${toSlug(displayName)}-${mode}`,
    version: packageJson.version ?? "0.1.0",
    displayName,
    warnings: unique([
      ...resolved.warnings
    ]),
    assets
  };
}
