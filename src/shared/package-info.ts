import { readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

interface PackageJson {
  name: string
  version: string
}

let cachedPackageInfo: PackageJson | null = null

function loadPackageJson(): PackageJson {
  if (cachedPackageInfo) {
    return cachedPackageInfo
  }

  try {
    const currentDir = dirname(fileURLToPath(import.meta.url))
    
    // Try multiple possible locations (dist vs src)
    const possiblePaths = [
      join(currentDir, "..", "..", "package.json"),      // from dist/shared/
      join(currentDir, "..", "..", "..", "package.json"), // from src/shared/
    ]

    for (const pkgPath of possiblePaths) {
      try {
        const content = readFileSync(pkgPath, "utf-8")
        cachedPackageInfo = JSON.parse(content)
        return cachedPackageInfo!
      } catch {
        continue
      }
    }

    // Fallback if package.json not found
    cachedPackageInfo = { name: "oh-my-opencode", version: "0.0.0" }
    return cachedPackageInfo
  } catch {
    cachedPackageInfo = { name: "oh-my-opencode", version: "0.0.0" }
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
