import { readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

interface PackageJson {
  name: string
  version: string
}

let cachedPackageInfo: PackageJson | null = null

function isValidPackageJson(obj: unknown): obj is PackageJson {
  return (
    typeof obj === "object" &&
    obj !== null &&
    typeof (obj as PackageJson).name === "string" &&
    (obj as PackageJson).name.length > 0
  )
}

function loadPackageJson(): PackageJson {
  if (cachedPackageInfo) {
    return cachedPackageInfo
  }

  const fallback: PackageJson = { name: "oh-my-opencode", version: "0.0.0" }

  try {
    const currentDir = dirname(fileURLToPath(import.meta.url))
    
    // Try multiple possible locations:
    // - dist/index.js (bundled flat) -> ../package.json
    // - dist/shared/ (if not bundled) -> ../../package.json
    // - src/shared/ (development) -> ../../package.json
    const possiblePaths = [
      join(currentDir, "..", "package.json"),           // from dist/ (bundled)
      join(currentDir, "..", "..", "package.json"),     // from dist/shared/ or src/shared/
      join(currentDir, "..", "..", "..", "package.json"), // deeper nesting
    ]

    for (const pkgPath of possiblePaths) {
      try {
        const content = readFileSync(pkgPath, "utf-8")
        const parsed = JSON.parse(content)
        // Validate that this is actually our package.json with a valid name
        if (isValidPackageJson(parsed)) {
          cachedPackageInfo = parsed
          return cachedPackageInfo
        }
      } catch {
        continue
      }
    }

    // Fallback if no valid package.json found
    cachedPackageInfo = fallback
    return cachedPackageInfo
  } catch {
    cachedPackageInfo = fallback
    return cachedPackageInfo
  }
}

export function getPackageName(): string {
  return loadPackageJson().name
}

export function getPackageVersion(): string {
  return loadPackageJson().version
}

export function getConfigFileName(): string {
  return `${getPackageName()}.json`
}

export function getConfigFileNameC(): string {
  return `${getPackageName()}.jsonc`
}

export function getLogFileName(): string {
  return `${getPackageName()}.log`
}

export function getSchemaFileName(): string {
  return `${getPackageName()}.schema.json`
}
