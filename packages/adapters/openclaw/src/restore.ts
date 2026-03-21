import fs from "node:fs/promises";
import path from "node:path";
import { type RestoreInput, type RestoreResult } from "../../../domain/src/index.js";
import { pathExists } from "./state.js";
import { HatchOperations } from "../../../core/src/fs-hooks.js";

async function collectFiles(dirPath: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await collectFiles(fullPath)));
      } else {
        files.push(fullPath);
      }
    }
  } catch {
    // ignore
  }
  return files;
}

export async function restoreOpenClaw(input: RestoreInput): Promise<RestoreResult> {
  const targetPath = path.resolve(input.targetPath);
  const assetsDir = path.resolve(input.assetsDirectory);
  const warnings: string[] = [];
  const filesWritten: string[] = [];
  
  const ops = new HatchOperations({
    confirmStepByStep: input.options?.confirmStepByStep,
    logUndo: input.options?.logUndo
  });

  if (input.options?.dryRun) {
    return {
      targetPath,
      filesWritten: [],
      warnings: ["Dry run enabled. No files were written."]
    };
  }

  const exists = await pathExists(targetPath);
  if (exists) {
    if (!input.options?.force && !input.options?.backup) {
      const existingEntries = await fs.readdir(targetPath);
      if (existingEntries.length > 0) {
        throw new Error(
          `Target directory "${targetPath}" is not empty. Use --force to overwrite or --backup to create a backup.`
        );
      }
    }
    
    if (input.options?.backup) {
      // In a full implementation, we would create a zip or copy the folder.
      // For now, we'll just log it. Let's add a warning.
      warnings.push("Backup option is enabled but backup mechanism is not fully implemented yet.");
    }
  } else {
    await fs.mkdir(targetPath, { recursive: true });
  }

  if (await pathExists(assetsDir)) {
    try {
      // 0. Handle Native Enterprise Full Backup
      const nativeBackupDir = path.join(assetsDir, "native-backup");
      if (await pathExists(nativeBackupDir)) {
        const entries = await fs.readdir(nativeBackupDir);
        const tarFile = entries.find(e => e.endsWith(".tar.gz"));
        if (tarFile) {
          const tarPath = path.join(nativeBackupDir, tarFile);
          if (input.options?.confirmStepByStep) {
            const ans = await ops.askConfirmation(`Extract native OpenClaw enterprise backup \x1b[36m${tarFile}\x1b[0m directly into \x1b[36m${targetPath}\x1b[0m?`);
            if (ans === "N" || ans === "S") return { targetPath, filesWritten, warnings: [...warnings, "Native backup extraction skipped."] };
            if (ans === "A") throw new Error("Operation aborted by user.");
          }
          
          process.stdout.write(`  \x1b[36m[EXTRACTING NATIVE BACKUP]\x1b[0m Overwriting 1:1 state utilizing native payload...\n`);
          
          // We extract the tar.gz. The backup tool outputs a folder representing the timestamp, and inside `payload/posix/.../.openclaw`
          // Because OpenClaw backup formats can be deeply nested, the cleanest way to do a 1:1 overwrite of the *state* directory
          // without a dedicated native `restore` command is to use tar with strip-components, but determining the exact strip
          // count is tricky. The guide states: "For Full: Overwrite the ~/.openclaw directory 1:1 utilizing the native payload."
          // Alternatively, since AgentPack built the structure, we can extract to a temp dir and then copy.
          
          const os = await import("node:os");
          const { exec } = await import("node:child_process");
          const { promisify } = await import("node:util");
          const execAsync = promisify(exec);
          
          const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentpack-restore-'));
          await execAsync(`tar -xzf "${tarPath}" -C "${tmpDir}"`);
          
          // Find the actual .openclaw state payload inside the extracted tar
          let sourcePayloadRoot = tmpDir;
          const walkForState = async (dir: string): Promise<string | undefined> => {
            const items = await fs.readdir(dir, { withFileTypes: true });
            for (const item of items) {
              if (item.isDirectory() && item.name === ".openclaw") {
                return path.join(dir, item.name);
              }
              if (item.isDirectory() && (item.name === "payload" || item.name === "posix" || item.name === "home" || item.name.includes("openclaw-backup") || !item.name.startsWith("."))) {
                const found = await walkForState(path.join(dir, item.name));
                if (found) return found;
              }
            }
            return undefined;
          };
          
          const actualStateRoot = await walkForState(tmpDir);
          
          if (actualStateRoot) {
            const stateFiles = await collectFiles(actualStateRoot);
            for (const file of stateFiles) {
              const relPath = path.relative(actualStateRoot, file);
              const fileDest = path.join(targetPath, relPath);
              await ops.performCopy(file, fileDest, input.options?.force ?? true); // Native restore implies forced overwrite
              filesWritten.push(relPath.replace(/\\/g, "/"));
            }
          } else {
             warnings.push("Could not locate the .openclaw state root inside the native backup archive.");
          }
          
          // If we successfully restored the native backup, we should skip the standard remapping logic.
          if (actualStateRoot) {
            await ops.close();
            return { targetPath, filesWritten, warnings };
          }
        }
      }

      // Handle the specialized mappings back to OpenClaw state format
      
      // 1. Remap configuration files
      const configPaths = [
        path.join(assetsDir, "config", "openclaw.full.json"),
        path.join(assetsDir, "config", "openclaw.sanitized.json"),
        path.join(assetsDir, "raw", "openclaw.json")
      ];
      
      for (const configSource of configPaths) {
        if (await pathExists(configSource)) {
          const destFile = path.join(targetPath, "openclaw.json");
          let copied = false;
          if (configSource.endsWith(".json")) {
             copied = await ops.performMergeJson(configSource, destFile, input.options?.force ?? false);
          } else {
             copied = await ops.performCopy(configSource, destFile, input.options?.force ?? false);
          }
          if (copied) filesWritten.push("openclaw.json");
          break; // Use the first available config file
        }
      }
      
      // 2. Remap workspaces
      const workspacesDir = path.join(assetsDir, "workspaces");
      if (await pathExists(workspacesDir)) {
        const workspaceEntries = await fs.readdir(workspacesDir, { withFileTypes: true });
        const workspaceDirs = workspaceEntries.filter(e => e.isDirectory());
        
        // Find the primary workspace (the one with actual DNA files like AGENTS.md or USER.md)
        let primaryWorkspaceName: string | undefined;
        for (const ws of workspaceDirs) {
           const wsSourcePath = path.join(workspacesDir, ws.name);
           const hasAgentsMd = await pathExists(path.join(wsSourcePath, "AGENTS.md"));
           const hasUserMd = await pathExists(path.join(wsSourcePath, "USER.md"));
           if (hasAgentsMd || hasUserMd) {
             primaryWorkspaceName = ws.name;
             break;
           }
        }
        // If we didn't find one with DNA, just default to the first one
        if (!primaryWorkspaceName && workspaceDirs.length > 0) {
           primaryWorkspaceName = workspaceDirs[0].name;
        }
        
        for (const ws of workspaceDirs) {
          const wsSourcePath = path.join(workspacesDir, ws.name);
          
          // Map the primary workspace to 'workspace' root. 
          // If a workspace was actually the state root mistakenly packed, its contents might just be state files 
          // like canvas/ or memory/ - if it's NOT the primary, we just restore it into the target root 
          // so state files land in the right place.
          let destName = ws.name;
          if (ws.name === primaryWorkspaceName) {
            destName = "workspace";
          } else {
             // For any non-primary workspace in this structure, if it doesn't have DNA, it's likely the state root itself.
             const hasAnyDna = await pathExists(path.join(wsSourcePath, "MEMORY.md"));
             if (!hasAnyDna) {
                destName = "."; // Restore to root targetPath
             }
          }
          
          const wsDestPath = path.join(targetPath, destName);
          
          const wsFiles = await collectFiles(wsSourcePath);
          for (const file of wsFiles) {
            const relPath = path.relative(wsSourcePath, file);
            const fileDest = path.join(wsDestPath, relPath);
            const copied = await ops.performCopy(file, fileDest, input.options?.force ?? false);
            if (copied) {
              filesWritten.push(destName === "." ? relPath.replace(/\\/g, "/") : path.join(destName, relPath).replace(/\\/g, "/"));
            }
          }
        }
      }
      
      // 3. Remap remaining state folders (credentials, sessions) if present
      const stateDir = path.join(assetsDir, "state");
      if (await pathExists(stateDir)) {
        const stateEntries = await fs.readdir(stateDir, { withFileTypes: true });
        for (const entry of stateEntries) {
          if (entry.isDirectory()) {
            const stateSourcePath = path.join(stateDir, entry.name);
            const stateDestPath = path.join(targetPath, entry.name);
            
            const stateFiles = await collectFiles(stateSourcePath);
            for (const file of stateFiles) {
              const relPath = path.relative(stateSourcePath, file);
              const fileDest = path.join(stateDestPath, relPath);
              const copied = await ops.performCopy(file, fileDest, input.options?.force ?? false);
              if (copied) {
                filesWritten.push(path.join(entry.name, relPath).replace(/\\/g, "/"));
              }
            }
          }
        }
      }
      
      // 4. Also copy anything else that might be in the root of assets, excluding what we've mapped
      const rootEntries = await fs.readdir(assetsDir, { withFileTypes: true });
      for (const entry of rootEntries) {
        if (!["config", "raw", "workspaces", "state"].includes(entry.name)) {
          const entrySourcePath = path.join(assetsDir, entry.name);
          const entryDestPath = path.join(targetPath, entry.name);
          
          if (entry.isDirectory()) {
            const files = await collectFiles(entrySourcePath);
            for (const file of files) {
              const relPath = path.relative(entrySourcePath, file);
              const fileDest = path.join(entryDestPath, relPath);
              const copied = await ops.performCopy(file, fileDest, input.options?.force ?? false);
              if (copied) {
                filesWritten.push(path.join(entry.name, relPath).replace(/\\/g, "/"));
              }
            }
          } else {
            const copied = await ops.performCopy(entrySourcePath, entryDestPath, input.options?.force ?? false);
            if (copied) filesWritten.push(entry.name);
          }
        }
      }

    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("EEXIST")) {
        throw new Error(`File collision detected during restore. Use --force to overwrite.`);
      }
      throw err;
    } finally {
      await ops.close();
    }
  } else {
    warnings.push(`Assets directory was not found in package: ${assetsDir}`);
    await ops.close();
  }

  return {
    targetPath,
    filesWritten,
    warnings
  };
}
