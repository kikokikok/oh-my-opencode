import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { getLogFileName } from "./package-info"

const logFile = path.join(os.tmpdir(), getLogFileName())

export function log(message: string, data?: unknown): void {
  try {
    const timestamp = new Date().toISOString()
    const logEntry = `[${timestamp}] ${message} ${data ? JSON.stringify(data) : ""}\n`
    fs.appendFileSync(logFile, logEntry)
  } catch {
  }
}

export function getLogFilePath(): string {
  return logFile
}
