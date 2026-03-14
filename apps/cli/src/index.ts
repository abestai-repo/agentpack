#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { Command } from "commander";

import {
  AEGG_SCHEMA_VERSION,
  CAM_SCHEMA_VERSION,
  COMPATIBILITY_CATEGORIES,
  EXIT_CODES,
  type AeggManifest,
  type AeggMetadata,
  type DetectInput,
  type InspectResult
} from "../../../packages/domain/src/index.js";
import { registeredAdapters } from "../../../packages/adapters/src/index.js";
import { detectAgent } from "../../../packages/core/src/index.js";
import {
  inferValidationKind,
  validateAeggCompatibilityDocument,
  validateAeggManifest,
  validateAeggMetadata,
  validateCamDocument,
  type ValidationError
} from "../../../packages/schemas/src/index.js";
import {
  renderErrorList,
  renderHero,
  renderSection,
  renderStatus
} from "./render.js";

export async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export function formatErrors(errors: ValidationError[]) {
  return errors.map((error) => `${error.path}: ${error.message}`);
}

function formatWarnings(warnings: string[]) {
  return warnings.map((warning) => `warning: ${warning}`);
}

function formatPresent(value: boolean) {
  return value ? "YES" : "NO";
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function createDetectInput(targetPath: string, deep = false): DetectInput {
  return {
    sourcePath: targetPath,
    mode: deep ? "deep" : "fast"
  };
}

function formatDetailValue(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return "unknown";
  }

  if (typeof value === "boolean") {
    return value ? "YES" : "NO";
  }

  return String(value);
}

function formatList(values: string[]) {
  return values.length > 0 ? values.join(", ") : "none";
}

function summarizeJsonObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      keys: [] as string[],
      count: 0
    };
  }

  const keys = Object.keys(value as Record<string, unknown>);
  return {
    keys,
    count: keys.length
  };
}

function detectPromptSources(cam: Record<string, unknown>) {
  const sources: string[] = [];
  const notes: string[] = [];
  const instructions = cam.instructions;
  const summary = summarizeJsonObject(instructions);

  if (summary.count > 0) {
    sources.push("cam.json:instructions");
    notes.push(`Instruction fields present: ${summary.keys.join(", ")}`);
  } else {
    notes.push("No explicit prompt or instruction fields were present in cam.json.");
  }

  return {
    count: summary.count || undefined,
    sources,
    notes
  };
}

function detectModelReferences(cam: Record<string, unknown>) {
  const models = cam.models;
  const summary = summarizeJsonObject(models);

  return {
    count: summary.count || undefined,
    references: summary.count > 0 ? ["cam.json:models"] : [],
    notes:
      summary.count > 0
        ? [`Model keys present: ${summary.keys.join(", ")}`]
        : ["No model configuration keys were present in cam.json."]
  };
}

function buildCapabilitySummary(sectionName: string, value: unknown) {
  if (Array.isArray(value)) {
    return {
      count: value.length || undefined,
      references: value.length > 0 ? [`cam.json:${sectionName}`] : [],
      notes:
        value.length > 0
          ? [`${sectionName} contains ${value.length} item(s).`]
          : [`No ${sectionName} entries were present in cam.json.`]
    };
  }

  const summary = summarizeJsonObject(value);

  return {
    count: summary.count || undefined,
    references: summary.count > 0 ? [`cam.json:${sectionName}`] : [],
    notes:
      summary.count > 0
        ? [`${sectionName} keys present: ${summary.keys.join(", ")}`]
        : [`No ${sectionName} data was present in cam.json.`]
  };
}

function buildMemorySummary(value: unknown) {
  const memory = typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

  return {
    kind: typeof memory?.kind === "string" ? memory.kind : undefined,
    references: memory ? ["cam.json:memory"] : [],
    notes: memory ? [] : ["No memory configuration was present in cam.json."]
  };
}

async function inspectAeggTarget(targetPath: string): Promise<InspectResult> {
  const stat = await fs.stat(targetPath);
  const packageRoot = stat.isDirectory() ? targetPath : path.dirname(targetPath);
  const manifestPath =
    stat.isDirectory() && (await pathExists(path.join(targetPath, "manifest.json")))
      ? path.join(targetPath, "manifest.json")
      : targetPath;
  const manifest = (await readJsonFile(manifestPath)) as AeggManifest;
  const metadataPath = path.join(packageRoot, manifest.entrypoints.metadata);
  const camPath = path.join(packageRoot, manifest.entrypoints.cam);
  const compatibilityPath = path.join(packageRoot, manifest.entrypoints.compatibility);
  const metadata = (await readJsonFile(metadataPath)) as AeggMetadata;
  const cam = (await readJsonFile(camPath)) as Record<string, unknown>;
  const compatibilityExists = await pathExists(compatibilityPath);
  const sourceRecord =
    typeof cam.source === "object" && cam.source !== null && !Array.isArray(cam.source)
      ? (cam.source as Record<string, unknown>)
      : {};
  const displayName =
    metadata.display.title || manifest.name;
  const framework =
    metadata.provenance.source_framework ||
    (typeof sourceRecord.framework === "string" ? sourceRecord.framework : "unknown");

  return {
    targetKind: "aegg-package",
    adapterId: metadata.provenance.source_framework || "aegg",
    framework,
    displayName,
    sourcePath: targetPath,
    sourceVersion: manifest.version,
    package: {
      name: manifest.name,
      version: manifest.version,
      displayName: metadata.display.title,
      description: metadata.display.summary,
      tags: metadata.display.tags
    },
    provenance: {
      schemaVersion: manifest.schema_version,
      camSchemaVersion: manifest.cam_schema_version,
      packageId: manifest.package_id,
      createdAt: manifest.created_at,
      createdBy: metadata.provenance.created_by,
      createdByVersion: metadata.provenance.created_by_version,
      sourceFramework: metadata.provenance.source_framework,
      sourceAdapterVersion: metadata.provenance.source_adapter_version
    },
    prompts: detectPromptSources(cam),
    models: detectModelReferences(cam),
    tools: buildCapabilitySummary("tools", cam.tools),
    workflows: buildCapabilitySummary("workflows", cam.workflows),
    memory: buildMemorySummary(cam.memory),
    adapter: {
      adapterId: metadata.provenance.source_framework || "aegg",
      adapterVersion: metadata.provenance.source_adapter_version,
      framework,
      sourceVersion: manifest.version,
      capabilities: ["inspect"],
      relevantPaths: [
        path.relative(packageRoot, manifestPath),
        manifest.entrypoints.cam,
        manifest.entrypoints.metadata,
        manifest.entrypoints.compatibility,
        manifest.entrypoints.checksums
      ]
    },
    runtime: {
      notableScripts: []
    },
    configPaths: [
      path.relative(packageRoot, manifestPath),
      manifest.entrypoints.cam,
      manifest.entrypoints.metadata
    ],
    featureHints: compatibilityExists
      ? ["Package-time compatibility hints are present in compatibility.json."]
      : [],
    warnings: compatibilityExists ? [] : ["compatibility.json was not found for this package."]
  };
}

function renderInspectText(result: InspectResult, detectionConfidence?: number, verbose?: boolean) {
  const sections = [
    renderSection("Inspect Result", [
      { label: "path", value: result.sourcePath },
      { label: "target", value: result.targetKind },
      { label: "framework", value: result.displayName },
      { label: "version", value: result.sourceVersion ?? result.package.version },
      { label: "detected", value: detectionConfidence?.toFixed(2) ?? "n/a" }
    ]),
    renderSection("Package Identity", [
      { label: "name", value: result.package.name },
      { label: "display", value: result.package.displayName ?? "n/a" },
      { label: "version", value: result.package.version },
      { label: "description", value: result.package.description ?? "n/a" },
      { label: "tags", value: formatList(result.package.tags) }
    ]),
    renderSection("Inspection Summary", [
      { label: "prompts", value: formatList(result.prompts.sources) },
      { label: "models", value: formatList(result.models.references) },
      { label: "tools", value: formatList(result.tools.references) },
      { label: "workflows", value: formatList(result.workflows.references) },
      { label: "memory", value: formatList(result.memory.references) },
      { label: "config paths", value: formatList(result.configPaths) }
    ]),
    renderSection("Adapter Metadata", [
      { label: "adapter", value: result.adapter.adapterId },
      { label: "framework", value: result.adapter.framework },
      { label: "adapter version", value: result.adapter.adapterVersion ?? "unknown" },
      { label: "source version", value: result.adapter.sourceVersion ?? "unknown" },
      { label: "capabilities", value: result.adapter.capabilities.join(", ") }
    ])
  ];

  if (result.provenance) {
    sections.push(
      renderSection("Provenance", [
        { label: "schema", value: result.provenance.schemaVersion ?? "n/a" },
        { label: "cam schema", value: result.provenance.camSchemaVersion ?? "n/a" },
        { label: "package id", value: result.provenance.packageId ?? "n/a" },
        { label: "created at", value: result.provenance.createdAt ?? "n/a" },
        { label: "created by", value: result.provenance.createdBy ?? "n/a" },
        { label: "tool version", value: result.provenance.createdByVersion ?? "n/a" }
      ])
    );
  }

  if (verbose) {
    sections.push(
      renderSection("Runtime Surface", [
        { label: "cli", value: result.runtime.cli ?? "n/a" },
        { label: "main", value: result.runtime.main ?? "n/a" },
        { label: "module type", value: result.runtime.moduleType ?? "n/a" },
        { label: "node", value: result.runtime.nodeEngine ?? "n/a" },
        { label: "package manager", value: result.runtime.packageManager ?? "n/a" },
        { label: "exports", value: result.runtime.exportsCount?.toString() ?? "n/a" },
        { label: "scripts", value: result.runtime.scriptCount?.toString() ?? "n/a" },
        { label: "notable scripts", value: formatList(result.runtime.notableScripts) }
      ])
    );

    if (result.workspace) {
      sections.push(
        renderSection("Workspace Signals", [
          { label: "docs", value: formatPresent(result.workspace.docsPresent) },
          { label: "tests", value: formatPresent(result.workspace.testsPresent) },
          { label: "ui", value: formatPresent(result.workspace.uiPresent) },
          { label: "apps", value: formatPresent(result.workspace.appsPresent) },
          { label: "extensions", value: formatPresent(result.workspace.extensionsPresent) },
          { label: "skills", value: formatPresent(result.workspace.skillsPresent) },
          { label: "packages", value: formatPresent(result.workspace.packagesPresent) },
          { label: "top-level dirs", value: formatList(result.workspace.topLevelDirectories) }
        ])
      );
    }

    if (result.packageDetails) {
      sections.push(
        renderSection("Package Details", [
          { label: "license", value: result.packageDetails.license ?? "n/a" },
          { label: "homepage", value: result.packageDetails.homepage ?? "n/a" },
          { label: "repository", value: result.packageDetails.repository ?? "n/a" }
        ])
      );
    }

    const notes = [
      ...result.prompts.notes,
      ...result.models.notes,
      ...result.tools.notes,
      ...result.workflows.notes,
      ...result.memory.notes
    ];

    if (notes.length > 0) {
      sections.push(
        renderSection(
          "Notes",
          notes.map((note, index) => ({
            label: `note ${String(index + 1).padStart(2, "0")}`,
            value: note
          }))
        )
      );
    }
  }

  if (result.featureHints.length > 0) {
    sections.push(
      renderSection(
        "Feature Hints",
        result.featureHints.map((hint, index) => ({
          label: `hint ${String(index + 1).padStart(2, "0")}`,
          value: hint
        }))
      )
    );
  }

  return sections.join("\n\n");
}

function validateByKind(kind: string, payload: unknown) {
  switch (kind) {
    case "cam":
      return validateCamDocument(payload);
    case "manifest":
      return validateAeggManifest(payload);
    case "metadata":
      return validateAeggMetadata(payload);
    case "compatibility":
      return validateAeggCompatibilityDocument(payload);
    default:
      return {
        valid: false,
        errors: [{ path: "$", message: `Unknown validation kind "${kind}".` }]
      };
  }
}

export async function main(argv = process.argv): Promise<number> {
  const program = new Command();
  let resolvedExitCode: number = EXIT_CODES.SUCCESS;

  program
    .name("agentpack")
    .description("AgentPack Phase 1 foundation CLI")
    .showHelpAfterError()
    .configureOutput({
      writeOut: (text) => process.stdout.write(text),
      writeErr: (text) => process.stderr.write(text)
    });

  program
    .command("detect")
    .description("Detect the most likely supported framework in a local folder")
    .argument("<path>", "path to the target folder")
    .option("--json", "print JSON output")
    .option("--debug", "include ignored directories and competing candidates")
    .option("--deep", "use deeper static inspection when adapters support it")
    .action(async (targetPath: string, options: { json?: boolean; debug?: boolean; deep?: boolean }) => {
      const resolvedPath = path.resolve(process.cwd(), targetPath);
      const detection = await detectAgent(createDetectInput(resolvedPath, options.deep), registeredAdapters);

      if (options.json) {
        process.stdout.write(
          `${JSON.stringify(
            {
              command: "detect",
              path: resolvedPath,
              selected: detection.selected,
              candidates: options.debug ? detection.candidates : undefined,
              ignoredDirectories: options.debug ? detection.ignoredDirectories : undefined
            },
            null,
            2
          )}\n`
        );
        resolvedExitCode = detection.selected.matched
          ? EXIT_CODES.SUCCESS
          : EXIT_CODES.DETECTION_FAILURE;
        return;
      }

      process.stdout.write(`${renderHero()}\n\n`);
      process.stdout.write(
        `${renderSection("Detection Result", [
          { label: "path", value: resolvedPath },
          { label: "framework", value: detection.selected.displayName },
          { label: "adapter", value: detection.selected.adapterId },
          { label: "version", value: detection.selected.detectedVersion ?? "unknown" },
          { label: "confidence", value: detection.selected.confidence.toFixed(2) },
          { label: "matched", value: detection.selected.matched ? "YES" : "NO" },
          { label: "class", value: detection.selected.matchCategory.toUpperCase() }
        ])}\n`
      );

      if (detection.selected.evidence.length > 0) {
        process.stdout.write(
          `\n${renderSection(
            "Evidence",
            detection.selected.evidence.map((item) => ({
              label: `${item.kind} (${item.weight.toFixed(2)})`,
              value: item.path ? `${item.path} :: ${item.message}` : item.message
            }))
          )}\n`
        );
      }

      if (detection.selected.warnings.length > 0) {
        process.stdout.write(`\n${renderErrorList(formatWarnings(detection.selected.warnings))}\n`);
      }

      if (detection.selected.details) {
        process.stdout.write(
          `\n${renderSection("OpenClaw State", [
            {
              label: "config found",
              value: formatDetailValue(detection.selected.details.configFound)
            },
            {
              label: "custom config",
              value: formatDetailValue(detection.selected.details.customConfig)
            },
            {
              label: "agent count",
              value: formatDetailValue(detection.selected.details.agentCount)
            },
            {
              label: "state dir",
              value: formatDetailValue(detection.selected.details.stateDir)
            }
          ])}\n`
        );
      }

      if (options.debug) {
        process.stdout.write(
          `\n${renderSection("Debug Telemetry", [
            {
              label: "ignored directories",
              value:
                detection.ignoredDirectories.length > 0
                  ? detection.ignoredDirectories.join(", ")
                  : "none"
            },
            {
              label: "candidates",
              value:
                detection.candidates.length > 0
                  ? detection.candidates
                      .map((candidate) => `${candidate.displayName}:${candidate.confidence.toFixed(2)}`)
                      .join(", ")
                  : "none"
            }
          ])}\n`
        );
      }

      resolvedExitCode = detection.selected.matched
        ? EXIT_CODES.SUCCESS
        : EXIT_CODES.DETECTION_FAILURE;
    });

  program
    .command("inspect")
    .description("Inspect a supported local agent folder or a local .aegg package")
    .argument("<path>", "path to the target folder or .aegg package")
    .option("--json", "print JSON output")
    .option("--verbose", "include expanded runtime and note output")
    .action(async (targetPath: string, options: { json?: boolean; verbose?: boolean }) => {
      const resolvedPath = path.resolve(process.cwd(), targetPath);
      const targetStat = await fs.stat(resolvedPath);
      const looksLikeAeggTarget =
        path.extname(resolvedPath) === ".aegg" ||
        (!targetStat.isDirectory() && path.basename(resolvedPath) === "manifest.json") ||
        (targetStat.isDirectory() && (await pathExists(path.join(resolvedPath, "manifest.json"))));

      if (looksLikeAeggTarget) {
        const result = await inspectAeggTarget(resolvedPath);

        if (options.json) {
          process.stdout.write(
            `${JSON.stringify(
              {
                command: "inspect",
                path: resolvedPath,
                result
              },
              null,
              2
            )}\n`
          );
          resolvedExitCode = EXIT_CODES.SUCCESS;
          return;
        }

        process.stdout.write(`${renderHero()}\n\n`);
        process.stdout.write(`${renderInspectText(result, undefined, options.verbose)}\n`);

        if (result.warnings.length > 0) {
          process.stdout.write(`\n${renderErrorList(formatWarnings(result.warnings))}\n`);
        }

        resolvedExitCode = EXIT_CODES.SUCCESS;
        return;
      }

      const detection = await detectAgent(createDetectInput(resolvedPath), registeredAdapters);

      if (!detection.selected.matched) {
        if (options.json) {
          process.stdout.write(
            `${JSON.stringify(
              {
                command: "inspect",
                path: resolvedPath,
                error: "No supported framework matched the target folder.",
                detection: detection.selected
              },
              null,
              2
            )}\n`
          );
        } else {
          process.stdout.write(`${renderHero()}\n\n`);
          process.stdout.write(
            `${renderSection("Inspect Failure", [
              { label: "path", value: resolvedPath },
              { label: "status", value: "unsupported target" },
              { label: "framework", value: detection.selected.displayName }
            ])}\n`
          );
          if (detection.selected.warnings.length > 0) {
            process.stdout.write(
              `\n${renderErrorList(formatWarnings(detection.selected.warnings))}\n`
            );
          }
        }

        resolvedExitCode = EXIT_CODES.DETECTION_FAILURE;
        return;
      }

      const adapter = registeredAdapters.find(
        (candidate) => candidate.metadata.id === detection.selected.adapterId
      );

      if (!adapter?.inspect) {
        if (options.json) {
          process.stdout.write(
            `${JSON.stringify(
              {
                command: "inspect",
                path: resolvedPath,
                error: `Adapter "${detection.selected.adapterId}" does not implement inspect yet.`,
                detection: detection.selected
              },
              null,
              2
            )}\n`
          );
        } else {
          process.stdout.write(`${renderHero()}\n\n`);
          process.stdout.write(
            `${renderSection("Inspect Failure", [
              { label: "path", value: resolvedPath },
              { label: "framework", value: detection.selected.displayName },
              { label: "status", value: "inspect unsupported" }
            ])}\n`
          );
        }

        resolvedExitCode = EXIT_CODES.GENERAL_ERROR;
        return;
      }

      const result = await adapter.inspect(resolvedPath);

      if (options.json) {
        process.stdout.write(
          `${JSON.stringify(
            {
              command: "inspect",
              path: resolvedPath,
              detection: detection.selected,
              result
            },
            null,
            2
          )}\n`
        );
        resolvedExitCode = EXIT_CODES.SUCCESS;
        return;
      }

      process.stdout.write(`${renderHero()}\n\n`);
      process.stdout.write(
        `${renderInspectText(result, detection.selected.confidence, options.verbose)}\n`
      );

      if (result.warnings.length > 0) {
        process.stdout.write(`\n${renderErrorList(formatWarnings(result.warnings))}\n`);
      }

      resolvedExitCode = EXIT_CODES.SUCCESS;
    });

  program
    .command("schemas")
    .description("Print the active schema versions and compatibility categories")
    .option("--json", "print JSON output")
    .action(async (options: { json?: boolean }) => {
      const payload = {
        product: "agentpack",
        versions: {
          cam: CAM_SCHEMA_VERSION,
          aegg: AEGG_SCHEMA_VERSION
        },
        compatibility: {
          categories: [...COMPATIBILITY_CATEGORIES]
        }
      };

      if (options.json) {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        return;
      }

      process.stdout.write(`${renderHero()}\n\n`);
      process.stdout.write(
        `${renderSection("Schema Matrix", [
          { label: "CAM schema", value: payload.versions.cam },
          { label: ".aegg schema", value: payload.versions.aegg },
          {
            label: "compatibility lanes",
            value: payload.compatibility.categories.join(", ")
          }
        ])}\n`
      );
    });

  program
    .command("validate")
    .description("Validate a CAM or .aegg JSON document")
    .argument("<file>", "path to the JSON file")
    .option("--kind <kind>", "cam | manifest | metadata | compatibility")
    .option("--json", "print JSON output")
    .action(async (file: string, options: { kind?: string; json?: boolean }) => {
      const resolvedPath = path.resolve(process.cwd(), file);
      const payload = await readJsonFile(resolvedPath);
      const kind = options.kind ?? inferValidationKind(resolvedPath, payload);
      const result = validateByKind(kind, payload);

      if (options.json) {
        process.stdout.write(
          `${JSON.stringify(
            {
              command: "validate",
              file: resolvedPath,
              kind,
              valid: result.valid,
              errors: result.errors
            },
            null,
            2
          )}\n`
        );
      } else {
        process.stdout.write(`${renderHero()}\n\n`);
        process.stdout.write(
          `${renderSection("Validation Telemetry", [
            { label: "file", value: resolvedPath },
            { label: "kind", value: kind },
            { label: "status", value: renderStatus(result.valid ? "valid" : "invalid") }
          ])}\n`
        );
        if (!result.valid) {
          process.stdout.write(`\n${renderErrorList(formatErrors(result.errors))}\n`);
        }
      }

      resolvedExitCode = result.valid ? EXIT_CODES.SUCCESS : EXIT_CODES.GENERAL_ERROR;
    });

  program
    .command("adapters")
    .description("Adapter inspection commands")
    .command("list")
    .description("List registered adapters and their feature coverage")
    .option("--json", "print JSON output")
    .action((options: { json?: boolean }) => {
      const rows = registeredAdapters.map((adapter) => ({
        id: adapter.metadata.id,
        framework: adapter.metadata.framework,
        version: adapter.metadata.adapterVersion,
        capabilities: adapter.metadata.capabilities
      }));

      if (options.json) {
        process.stdout.write(`${JSON.stringify({ adapters: rows }, null, 2)}\n`);
        return;
      }

      process.stdout.write(`${renderHero()}\n\n`);
      process.stdout.write(
        `${renderSection(
          "Adapter Registry",
          rows.map((row) => ({
            label: `${row.framework} @ ${row.version}`,
            value: row.capabilities.join(", ")
          }))
        )}\n`
      );
    });

  try {
    await program.parseAsync(argv, { from: "node" });
    return resolvedExitCode;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_CODES.GENERAL_ERROR;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;

if (invokedPath === import.meta.url) {
  const exitCode = await main();
  process.exit(exitCode);
}
