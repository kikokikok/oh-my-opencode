import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { loadPluginConfig } from "./plugin-config"
import { getPackageName } from "./shared/package-info"

describe("loadPluginConfig", () => {
  let tempDir: string
  let userConfigDir: string
  let originalHome: string | undefined
  let originalXdgConfigHome: string | undefined
  let configFileName: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-config-test-"))
    userConfigDir = path.join(tempDir, ".config", "opencode")
    fs.mkdirSync(userConfigDir, { recursive: true })
    originalHome = process.env.HOME
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME
    process.env.HOME = tempDir
    process.env.XDG_CONFIG_HOME = path.join(tempDir, ".config")
    configFileName = `${getPackageName()}.json`
  })

  afterEach(() => {
    process.env.HOME = originalHome
    if (originalXdgConfigHome !== undefined) {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome
    } else {
      delete process.env.XDG_CONFIG_HOME
    }
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe("letta config support", () => {
    // #given a config with letta key instead of mem0
    // #when the config is loaded
    // #then letta config should be accessible as mem0
    it("should recognize letta config and make it available as mem0", () => {
      const configPath = path.join(userConfigDir, configFileName)
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          letta: {
            enabled: true,
            endpoint: "http://localhost:8283",
            userId: "test-user",
            autoRehydrate: true,
            rehydrateLayers: ["user", "project"],
          },
        })
      )

      const config = loadPluginConfig(tempDir, {})

      // Letta config should be available as mem0
      expect(config.mem0).toBeDefined()
      expect(config.mem0?.enabled).toBe(true)
      expect(config.mem0?.endpoint).toBe("http://localhost:8283")
      expect(config.mem0?.userId).toBe("test-user")
      expect(config.mem0?.autoRehydrate).toBe(true)
      expect(config.mem0?.rehydrateLayers).toEqual(["user", "project"])
    })

    // #given a config with both letta and mem0 keys
    // #when the config is loaded
    // #then mem0 should take precedence over letta
    it("should prefer mem0 over letta when both are present", () => {
      const configPath = path.join(userConfigDir, configFileName)
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          letta: {
            enabled: true,
            endpoint: "http://localhost:8283",
            userId: "letta-user",
          },
          mem0: {
            enabled: true,
            endpoint: "http://localhost:8000/v1",
            userId: "mem0-user",
          },
        })
      )

      const config = loadPluginConfig(tempDir, {})

      // mem0 should take precedence
      expect(config.mem0?.endpoint).toBe("http://localhost:8000/v1")
      expect(config.mem0?.userId).toBe("mem0-user")
    })

    // #given a project config with letta overriding user mem0
    // #when configs are merged
    // #then project letta should override user mem0
    it("should merge project letta config with user mem0 config", () => {
      const userConfigPath = path.join(userConfigDir, configFileName)
      fs.writeFileSync(
        userConfigPath,
        JSON.stringify({
          mem0: {
            enabled: true,
            endpoint: "http://user-endpoint:8000",
            userId: "user-id",
          },
        })
      )

      const projectConfigDir = path.join(tempDir, ".opencode")
      fs.mkdirSync(projectConfigDir, { recursive: true })
      const projectConfigPath = path.join(projectConfigDir, configFileName)
      fs.writeFileSync(
        projectConfigPath,
        JSON.stringify({
          letta: {
            enabled: true,
            endpoint: "http://project-letta:8283",
          },
        })
      )

      const config = loadPluginConfig(tempDir, {})

      // Project letta should override user mem0
      expect(config.mem0?.endpoint).toBe("http://project-letta:8283")
      // But userId from user config should be preserved
      expect(config.mem0?.userId).toBe("user-id")
    })
  })
})
