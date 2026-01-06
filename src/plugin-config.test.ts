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
    // #given a config with letta key
    // #when the config is loaded
    // #then letta config should be available as separate config
    it("should load letta config separately from mem0", () => {
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

      // #then letta config should be available separately
      expect(config.letta).toBeDefined()
      expect(config.letta?.enabled).toBe(true)
      expect(config.letta?.endpoint).toBe("http://localhost:8283")
      expect(config.letta?.userId).toBe("test-user")
      expect(config.letta?.autoRehydrate).toBe(true)
      expect(config.letta?.rehydrateLayers).toEqual(["user", "project"])
      expect(config.mem0).toBeUndefined()
    })

    // #given a config with both letta and mem0 keys
    // #when the config is loaded
    // #then both should be available independently
    it("should keep letta and mem0 as separate configs", () => {
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

      // #then both configs should be available
      expect(config.letta?.endpoint).toBe("http://localhost:8283")
      expect(config.letta?.userId).toBe("letta-user")
      expect(config.mem0?.endpoint).toBe("http://localhost:8000/v1")
      expect(config.mem0?.userId).toBe("mem0-user")
    })

    // #given a project config with letta overriding user letta
    // #when configs are merged
    // #then project letta should be deep merged with user letta
    it("should merge project letta config with user letta config", () => {
      const userConfigPath = path.join(userConfigDir, configFileName)
      fs.writeFileSync(
        userConfigPath,
        JSON.stringify({
          letta: {
            enabled: true,
            endpoint: "http://user-endpoint:8283",
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

      // #then project letta should override user letta endpoint
      expect(config.letta?.endpoint).toBe("http://project-letta:8283")
      expect(config.letta?.userId).toBe("user-id")
      expect(config.letta?.enabled).toBe(true)
    })
  })
})
