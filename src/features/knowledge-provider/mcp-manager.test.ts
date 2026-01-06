import { describe, it, expect, beforeEach, mock, spyOn } from "bun:test"
import { KnowledgeMcpManager } from "./mcp-manager"
import type { MCPProviderConfig } from "./types"

describe("KnowledgeMcpManager", () => {
  let manager: KnowledgeMcpManager

  beforeEach(() => {
    manager = new KnowledgeMcpManager()
  })

  describe("registerServer", () => {
    it("should register a server configuration", () => {
      // #given a server config
      const config: MCPProviderConfig = {
        name: "test-server",
        command: "npx",
        args: ["-y", "@test/mcp-server"],
        searchTool: "search",
      }

      // #when registering the server
      manager.registerServer(config)

      // #then the server should be in the registered list
      expect(manager.getRegisteredServers()).toContain("test-server")
    })

    it("should allow registering multiple servers", () => {
      // #given two server configs
      const config1: MCPProviderConfig = {
        name: "server-1",
        command: "npx",
        args: ["-y", "@test/mcp-1"],
        searchTool: "search",
      }
      const config2: MCPProviderConfig = {
        name: "server-2",
        command: "npx",
        args: ["-y", "@test/mcp-2"],
        searchTool: "search",
      }

      // #when registering both servers
      manager.registerServer(config1)
      manager.registerServer(config2)

      // #then both servers should be registered
      const servers = manager.getRegisteredServers()
      expect(servers).toContain("server-1")
      expect(servers).toContain("server-2")
      expect(servers).toHaveLength(2)
    })
  })

  describe("unregisterServer", () => {
    it("should unregister a server configuration", async () => {
      // #given a registered server
      const config: MCPProviderConfig = {
        name: "test-server",
        command: "npx",
        args: ["-y", "@test/mcp-server"],
        searchTool: "search",
      }
      manager.registerServer(config)

      // #when unregistering the server
      await manager.unregisterServer("test-server")

      // #then the server should not be in the registered list
      expect(manager.getRegisteredServers()).not.toContain("test-server")
    })

    it("should be safe to unregister non-existent server", async () => {
      // #given no registered servers
      // #when unregistering a non-existent server
      // #then it should not throw
      await expect(
        manager.unregisterServer("non-existent")
      ).resolves.toBeUndefined()
    })
  })

  describe("isServerAvailable", () => {
    it("should return false for unregistered server", async () => {
      // #given no registered servers
      // #when checking availability of non-existent server
      const available = await manager.isServerAvailable("non-existent")

      // #then it should return false
      expect(available).toBe(false)
    })
  })

  describe("getRegisteredServers", () => {
    it("should return empty array when no servers registered", () => {
      // #given a fresh manager
      // #when getting registered servers
      const servers = manager.getRegisteredServers()

      // #then it should return empty array
      expect(servers).toEqual([])
    })
  })

  describe("getConnectedServers", () => {
    it("should return empty array when no servers connected", () => {
      // #given a fresh manager
      // #when getting connected servers
      const servers = manager.getConnectedServers()

      // #then it should return empty array
      expect(servers).toEqual([])
    })
  })

  describe("isConnected", () => {
    it("should return false when server not connected", () => {
      // #given a registered but not connected server
      const config: MCPProviderConfig = {
        name: "test-server",
        command: "npx",
        args: ["-y", "@test/mcp-server"],
        searchTool: "search",
      }
      manager.registerServer(config)

      // #when checking if server is connected
      const connected = manager.isConnected("test-server")

      // #then it should return false
      expect(connected).toBe(false)
    })
  })

  describe("disconnectAll", () => {
    it("should handle disconnecting when no servers connected", async () => {
      // #given no connected servers
      // #when disconnecting all
      // #then it should not throw
      await expect(manager.disconnectAll()).resolves.toBeUndefined()
    })
  })

  describe("SSE transport configuration", () => {
    it("should register SSE server configuration", () => {
      // #given an SSE server config
      const config: MCPProviderConfig = {
        name: "dust-mcp",
        transport: "sse",
        url: "http://localhost:60062/sse",
        searchTool: "dust_search",
      }

      // #when registering the server
      manager.registerServer(config)

      // #then the server should be in the registered list
      expect(manager.getRegisteredServers()).toContain("dust-mcp")
    })

    it("should allow registering both stdio and SSE servers", () => {
      // #given stdio and SSE server configs
      const stdioConfig: MCPProviderConfig = {
        name: "notebooklm-mcp",
        command: "notebooklm-mcp",
        searchTool: "notebook_query",
      }
      const sseConfig: MCPProviderConfig = {
        name: "dust-mcp",
        transport: "sse",
        url: "http://localhost:60062/sse",
        searchTool: "dust_search",
      }

      // #when registering both servers
      manager.registerServer(stdioConfig)
      manager.registerServer(sseConfig)

      // #then both servers should be registered
      const servers = manager.getRegisteredServers()
      expect(servers).toContain("notebooklm-mcp")
      expect(servers).toContain("dust-mcp")
      expect(servers).toHaveLength(2)
    })

    it("should return false for SSE server availability when server not running", async () => {
      // #given an SSE server config pointing to a non-existent server
      const config: MCPProviderConfig = {
        name: "dust-mcp",
        transport: "sse",
        url: "http://localhost:99999/sse",
        searchTool: "dust_search",
      }
      manager.registerServer(config)

      // #when checking availability
      const available = await manager.isServerAvailable("dust-mcp")

      // #then it should return false (can't connect)
      expect(available).toBe(false)
    })
  })
})
