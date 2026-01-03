import * as path from "path"
import * as os from "os"
import * as fs from "fs"
import { getConfigFileName } from "./package-info"

/**
 * Returns the user-level config directory based on the OS.
 * - Linux/macOS: XDG_CONFIG_HOME or ~/.config
 * - Windows: Checks ~/.config first (cross-platform), then %APPDATA% (fallback)
 *
 * On Windows, prioritizes ~/.config for cross-platform consistency.
 * Falls back to %APPDATA% for backward compatibility with existing installations.
 */
export function getUserConfigDir(): string {
  const configFileName = getConfigFileName()
  
  if (process.platform === "win32") {
    const crossPlatformDir = path.join(os.homedir(), ".config")
    const crossPlatformConfigPath = path.join(crossPlatformDir, "opencode", configFileName)

    const appdataDir = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
    const appdataConfigPath = path.join(appdataDir, "opencode", configFileName)

    if (fs.existsSync(crossPlatformConfigPath)) {
      return crossPlatformDir
    }

    if (fs.existsSync(appdataConfigPath)) {
      return appdataDir
    }

    return crossPlatformDir
  }

  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
}

/**
 * Returns the full path to the user-level config file.
 */
export function getUserConfigPath(): string {
  return path.join(getUserConfigDir(), "opencode", getConfigFileName())
}

/**
 * Returns the full path to the project-level config file.
 */
export function getProjectConfigPath(directory: string): string {
  return path.join(directory, ".opencode", getConfigFileName())
}
