import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chmod: vi.fn(),
  mkdir: vi.fn(),
  rename: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
  writeFile: vi.fn(),
  execFile: vi.fn(),
  health: vi.fn(),
  registerAgent: vi.fn(),
  fromConfigFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  chmod: mocks.chmod,
  mkdir: mocks.mkdir,
  rename: mocks.rename,
  readFile: mocks.readFile,
  rm: mocks.rm,
  writeFile: mocks.writeFile,
}));

vi.mock("node:child_process", () => ({
  execFile: mocks.execFile,
}));

vi.mock("../../src/hub/client.js", () => {
  class HubClientError extends Error {
    constructor(
      message: string,
      public status?: number,
    ) {
      super(message);
    }
  }

  class HubClient {
    static fromConfigFile = mocks.fromConfigFile;
    health = mocks.health;
    registerAgent = mocks.registerAgent;
  }

  const normalizeHubServerUrl = (value: string) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new HubClientError(`Invalid AgentHub server URL: ${value}`);
    }
    return parsed.toString().replace(/\/+$/, "");
  };

  return { HubClient, HubClientError, normalizeHubServerUrl };
});

import { hubCommand } from "../../src/commands/hub.js";

describe("hubCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.exitCode = 0;
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.chmod.mockResolvedValue(undefined);
    mocks.rename.mockResolvedValue(undefined);
    mocks.rm.mockResolvedValue(undefined);
    mocks.readFile.mockRejectedValue(
      Object.assign(new Error("missing"), { code: "ENOENT" }),
    );
    mocks.execFile.mockImplementation(
      (
        file: string,
        _args: string[],
        callback: (
          error: Error | null,
          stdout: string,
          stderr: string,
        ) => void,
      ) => {
        callback(
          null,
          file === "whoami"
            ? '"NORTHAMERICA\\\\shyamsridhar","S-1-5-21-1234"\r\n'
            : "",
          "",
        );
      },
    );
    mocks.fromConfigFile.mockResolvedValue({
      health: mocks.health,
    });
    mocks.health.mockResolvedValue({ status: "ok" });
    mocks.registerAgent.mockResolvedValue({
      id: "smith",
      api_key: "secret",
    });
  });

  afterEach(() => {
    process.exitCode = 0;
  });

  it("writes AgentHub-compatible config atomically with restricted permissions", async () => {
    await hubCommand(
      "register",
      ["http://hub:8080/", "smith"],
      {},
    );

    const [, raw, options] = mocks.writeFile.mock.calls[0];
    expect(JSON.parse(raw as string)).toEqual({
      server_url: "http://hub:8080",
      api_key: "secret",
      agent_id: "smith",
    });
    expect(options).toMatchObject({
      encoding: "utf-8",
      mode: 0o600,
      flag: "wx",
    });
    expect(mocks.rename).toHaveBeenCalledOnce();
    if (process.platform === "win32") {
      expect(mocks.execFile).toHaveBeenCalledWith(
        "icacls",
        expect.arrayContaining([
          "/inheritance:r",
          "/grant:r",
          "*S-1-5-21-1234:(OI)(CI)F",
        ]),
        expect.any(Function),
      );
    }
    expect(mocks.chmod).toHaveBeenCalledWith(
      expect.stringContaining("config.json"),
      0o600,
    );
    expect(process.exitCode).toBe(0);
  });

  it("sets a failing exit code for invalid input", async () => {
    await hubCommand("register", ["not-a-url", "smith"], {});
    expect(process.exitCode).toBe(1);
  });

  it("refuses to overwrite credentials for a different hub", async () => {
    mocks.readFile.mockResolvedValueOnce(JSON.stringify({
      server_url: "http://old-hub:8080",
      api_key: "old-secret",
      agent_id: "old-agent",
    }));

    await hubCommand(
      "register",
      ["http://new-hub:8080", "new-agent"],
      {},
    );

    expect(process.exitCode).toBe(1);
    expect(mocks.health).not.toHaveBeenCalled();
  });

  it("allows an explicit forced credential replacement", async () => {
    mocks.readFile.mockResolvedValueOnce(JSON.stringify({
      server_url: "http://old-hub:8080",
      api_key: "old-secret",
      agent_id: "old-agent",
    }));

    await hubCommand(
      "register",
      ["http://new-hub:8080", "new-agent"],
      { force: true },
    );

    expect(process.exitCode).toBe(0);
    expect(mocks.health).toHaveBeenCalledOnce();
  });

  it("does not re-register an already configured agent", async () => {
    mocks.readFile.mockResolvedValueOnce(JSON.stringify({
      server_url: "http://hub:8080",
      api_key: "secret",
      agent_id: "smith",
    }));

    await hubCommand(
      "register",
      ["http://hub:8080", "smith"],
      {},
    );

    expect(process.exitCode).toBe(0);
    expect(mocks.health).toHaveBeenCalledOnce();
    expect(mocks.registerAgent).not.toHaveBeenCalled();
  });

  it("gives a force recovery path for a malformed stored URL", async () => {
    mocks.readFile.mockResolvedValueOnce(JSON.stringify({
      server_url: "not-a-url",
      api_key: "secret",
      agent_id: "smith",
    }));

    await hubCommand(
      "register",
      ["http://hub:8080", "smith"],
      {},
    );

    expect(process.exitCode).toBe(1);
    expect(mocks.health).not.toHaveBeenCalled();
  });

  it("rejects registration responses without credentials", async () => {
    mocks.registerAgent.mockResolvedValueOnce({
      id: "smith",
      api_key: "",
    });

    await hubCommand(
      "register",
      ["http://hub:8080", "smith"],
      {},
    );

    expect(process.exitCode).toBe(1);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("cleans up the temporary config when saving fails", async () => {
    mocks.writeFile.mockRejectedValueOnce(new Error("disk full"));

    await hubCommand(
      "register",
      ["http://hub:8080", "smith"],
      {},
    );

    expect(process.exitCode).toBe(1);
    expect(mocks.rm).toHaveBeenCalledWith(
      expect.stringContaining(".tmp"),
      { force: true },
    );
  });

  it("sets a failing exit code when a hub operation fails", async () => {
    mocks.fromConfigFile.mockRejectedValueOnce(new Error("offline"));

    await hubCommand("status", [], {});

    expect(process.exitCode).toBe(1);
  });

  it("sets a failing exit code for unknown subcommands", async () => {
    await hubCommand("unknown", [], {});
    expect(process.exitCode).toBe(1);
  });
});
