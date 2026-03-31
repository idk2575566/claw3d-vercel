import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const ORIGINAL_ENV = { ...process.env };

const setupAndImportHook = async (
  gatewayUrl: string | null,
  browserUrl = "http://localhost:3000/",
  options?: { closeOnStart?: { code: number; reason: string } }
) => {
  const url = new URL(browserUrl);
  vi.spyOn(window, "location", "get").mockReturnValue({
    ...window.location,
    hostname: url.hostname,
    host: url.host,
    href: url.href,
    origin: url.origin,
    protocol: url.protocol,
  } as Location);
  process.env = { ...ORIGINAL_ENV };
  if (gatewayUrl === null) {
    delete process.env.NEXT_PUBLIC_GATEWAY_URL;
  } else {
    process.env.NEXT_PUBLIC_GATEWAY_URL = gatewayUrl;
  }

  vi.resetModules();
  vi.spyOn(console, "info").mockImplementation(() => {});

  const captured: { url: string | null; token: unknown; authScopeKey: unknown } = {
    url: null,
    token: null,
    authScopeKey: null,
  };

  vi.doMock("../../src/lib/gateway/openclaw/GatewayBrowserClient", () => {
    class GatewayBrowserClient {
      connected = false;
      private opts: {
        onHello?: (hello: unknown) => void;
        onEvent?: (event: unknown) => void;
        onClose?: (info: { code: number; reason: string }) => void;
        onGap?: (info: { expected: number; received: number }) => void;
      };

      constructor(opts: Record<string, unknown>) {
        captured.url = typeof opts.url === "string" ? opts.url : null;
        captured.token = "token" in opts ? opts.token : null;
        captured.authScopeKey = "authScopeKey" in opts ? opts.authScopeKey : null;
        this.opts = {
          onHello: typeof opts.onHello === "function" ? (opts.onHello as (hello: unknown) => void) : undefined,
          onEvent: typeof opts.onEvent === "function" ? (opts.onEvent as (event: unknown) => void) : undefined,
          onClose: typeof opts.onClose === "function" ? (opts.onClose as (info: { code: number; reason: string }) => void) : undefined,
          onGap: typeof opts.onGap === "function" ? (opts.onGap as (info: { expected: number; received: number }) => void) : undefined,
        };
      }

      start() {
        this.connected = true;
        if (options?.closeOnStart) {
          window.setTimeout(() => {
            this.opts.onClose?.(options.closeOnStart!);
          }, 0);
          return;
        }
        this.opts.onHello?.({ type: "hello-ok", protocol: 1 });
      }

      stop() {
        this.connected = false;
      }

      async request<T = unknown>(method: string, params: unknown): Promise<T> {
        void method;
        void params;
        return {} as T;
      }
    }

    return { GatewayBrowserClient };
  });

  const mod = await import("@/lib/gateway/GatewayClient");
  return {
    useGatewayConnection: mod.useGatewayConnection as (settingsCoordinator: {
      loadSettings: () => Promise<unknown>;
      loadSettingsEnvelope?: () => Promise<unknown>;
      schedulePatch: (patch: unknown) => void;
      flushPending: () => Promise<void>;
    }) => {
      gatewayUrl: string;
      token: string;
      localGatewayDefaults: { url: string; token: string } | null;
      useLocalGatewayDefaults: () => void;
      error: string | null;
      connect: () => Promise<void>;
    },
    captured,
  };
};

describe("useGatewayConnection", () => {
  afterEach(() => {
    cleanup();
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("defaults_to_env_url_when_set", async () => {
    const { useGatewayConnection } = await setupAndImportHook("ws://example.test:1234");
    const coordinator = {
      loadSettings: async () => null,
      schedulePatch: () => {},
      flushPending: async () => {},
    };

    const Probe = () =>
      createElement(
        "div",
        { "data-testid": "gatewayUrl" },
        useGatewayConnection(coordinator).gatewayUrl
      );

    render(createElement(Probe));

    await waitFor(() => {
      expect(screen.getByTestId("gatewayUrl")).toHaveTextContent("ws://example.test:1234");
    });
  });

  it("falls_back_to_local_default_when_env_unset_on_loopback_hosts", async () => {
    const { useGatewayConnection } = await setupAndImportHook(null, "http://localhost:3000/");
    const coordinator = {
      loadSettings: async () => null,
      schedulePatch: () => {},
      flushPending: async () => {},
    };

    const Probe = () =>
      createElement(
        "div",
        { "data-testid": "gatewayUrl" },
        useGatewayConnection(coordinator).gatewayUrl
      );

    render(createElement(Probe));

    await waitFor(() => {
      expect(screen.getByTestId("gatewayUrl")).toHaveTextContent("ws://localhost:18789");
    });
  });

  it("leaves_gateway_blank_when_env_unset_on_remote_hosts", async () => {
    const { useGatewayConnection } = await setupAndImportHook(null, "https://claw3d-preview.vercel.app/");
    const coordinator = {
      loadSettings: async () => null,
      schedulePatch: () => {},
      flushPending: async () => {},
    };

    const Probe = () =>
      createElement(
        "div",
        { "data-testid": "gatewayUrl" },
        useGatewayConnection(coordinator).gatewayUrl
      );

    render(createElement(Probe));

    await waitFor(() => {
      expect(screen.getByTestId("gatewayUrl")).toHaveTextContent("");
    });
  });

  it("connects_via_studio_proxy_ws_and_does_not_pass_token", async () => {
    const { useGatewayConnection, captured } = await setupAndImportHook(null);
    const coordinator = {
      loadSettings: async () => null,
      schedulePatch: () => {},
      flushPending: async () => {},
    };

    const Probe = () => {
      useGatewayConnection(coordinator);
      return createElement("div", null, "ok");
    };

    render(createElement(Probe));

    await waitFor(() => {
      expect(captured.url).toBe("ws://localhost:3000/api/gateway/ws");
    });
    expect(captured.token).toBe("");
    expect(captured.authScopeKey).toBe("ws://localhost:18789");
  });

  it("auto_applies_runtime_local_defaults_when_no_saved_gateway_and_build_time_empty", async () => {
    // Simulates #57: NEXT_PUBLIC_GATEWAY_URL was never rebuilt, but
    // CLAW3D_GATEWAY_URL is set on the server so localGatewayDefaults
    // comes through in the sanitized (public) form with tokenConfigured.
    const { useGatewayConnection } = await setupAndImportHook("");
    const coordinator = {
      loadSettings: async () => null,
      loadSettingsEnvelope: async () => ({
        settings: {
          version: 1,
          gateway: null, // no saved gateway settings
          focused: {},
          avatars: {},
          analytics: {},
          voiceReplies: {},
          office: {},
          deskAssignments: {},
          standup: {},
        },
        // Sanitized public form — token is replaced with tokenConfigured
        localGatewayDefaults: { url: "ws://my-server:18789", tokenConfigured: true },
      }),
      schedulePatch: () => {},
      flushPending: async () => {},
    };

    const Probe = () => {
      const state = useGatewayConnection(coordinator);
      return createElement(
        "div",
        null,
        createElement("div", { "data-testid": "gatewayUrl" }, state.gatewayUrl),
        createElement(
          "div",
          { "data-testid": "localDefaultsUrl" },
          state.localGatewayDefaults?.url ?? ""
        )
      );
    };

    render(createElement(Probe));

    // The runtime local defaults should be auto-applied since there are
    // no saved settings and the build-time default is empty.
    await waitFor(() => {
      expect(screen.getByTestId("gatewayUrl")).toHaveTextContent("ws://my-server:18789");
    });
    expect(screen.getByTestId("localDefaultsUrl")).toHaveTextContent("ws://my-server:18789");
  });

  it("applies_local_defaults_from_settings_envelope", async () => {
    const { useGatewayConnection } = await setupAndImportHook(null);
    const coordinator = {
      loadSettings: async () => ({
        version: 1,
        gateway: null,
        focused: {},
        avatars: {},
        analytics: {},
        voiceReplies: {},
      }),
      loadSettingsEnvelope: async () => ({
        settings: {
          version: 1,
          gateway: { url: "wss://remote.example", token: "remote-token" },
          focused: {},
          avatars: {},
          analytics: {},
          voiceReplies: {},
        },
        localGatewayDefaults: { url: "ws://localhost:18789", token: "local-token" },
      }),
      schedulePatch: () => {},
      flushPending: async () => {},
    };

    const Probe = () => {
      const state = useGatewayConnection(coordinator);
      return createElement(
        "div",
        null,
        createElement("div", { "data-testid": "gatewayUrl" }, state.gatewayUrl),
        createElement("div", { "data-testid": "token" }, state.token),
        createElement(
          "div",
          { "data-testid": "localDefaultsUrl" },
          state.localGatewayDefaults?.url ?? ""
        ),
        createElement(
          "button",
          {
            type: "button",
            onClick: state.useLocalGatewayDefaults,
            "data-testid": "useLocalDefaults",
          },
          "use"
        )
      );
    };

    render(createElement(Probe));

    await waitFor(() => {
      expect(screen.getByTestId("gatewayUrl")).toHaveTextContent("wss://remote.example");
    });
    expect(screen.getByTestId("token")).toHaveTextContent("remote-token");
    expect(screen.getByTestId("localDefaultsUrl")).toHaveTextContent("ws://localhost:18789");

    fireEvent.click(screen.getByTestId("useLocalDefaults"));

    await waitFor(() => {
      expect(screen.getByTestId("gatewayUrl")).toHaveTextContent("ws://localhost:18789");
    });
    expect(screen.getByTestId("token")).toHaveTextContent("local-token");
  });

  it("surfaces_studio_access_auth_error_when_ws_close_is_generic_1006", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      text: async () =>
        JSON.stringify({
          error: "Studio access token required. Send the configured Studio access cookie and retry.",
        }),
    } as Response);

    const { useGatewayConnection } = await setupAndImportHook(
      "ws://example.test:1234",
      "http://localhost:3000/",
      { closeOnStart: { code: 1006, reason: "" } }
    );
    const coordinator = {
      loadSettings: async () => null,
      schedulePatch: () => {},
      flushPending: async () => {},
    };

    const Probe = () => {
      const state = useGatewayConnection(coordinator);
      return createElement("div", null, createElement("div", { "data-testid": "error" }, state.error ?? ""));
    };

    render(createElement(Probe));

    await waitFor(() => {
      expect(screen.getByTestId("error").textContent).toContain(
        "Studio access token required"
      );
    });
  });

  it("shows_explicit_error_on_vercel_preview_hosts", async () => {
    const { useGatewayConnection } = await setupAndImportHook(null, "https://claw3d-preview.vercel.app/");
    const coordinator = {
      loadSettings: async () => null,
      schedulePatch: () => {},
      flushPending: async () => {},
    };

    const Probe = () => {
      const state = useGatewayConnection(coordinator);
      return createElement(
        "div",
        null,
        createElement("div", { "data-testid": "error" }, state.error ?? ""),
        createElement(
          "button",
          {
            type: "button",
            onClick: () => void state.connect(),
            "data-testid": "connect",
          },
          "connect"
        )
      );
    };

    render(createElement(Probe));
    fireEvent.click(screen.getByTestId("connect"));

    await waitFor(() => {
      expect(screen.getByTestId("error").textContent).toContain("Vercel preview is missing the Studio WebSocket proxy");
    });
  });

  it("replaces_legacy_saved_loopback_proxy_urls_with_runtime_local_defaults", async () => {
    const { useGatewayConnection } = await setupAndImportHook(null);
    const coordinator = {
      loadSettings: async () => null,
      loadSettingsEnvelope: async () => ({
        settings: {
          version: 1,
          gateway: { url: "ws://localhost:18080/api/gateway/ws", tokenConfigured: true },
          focused: {},
          avatars: {},
          analytics: {},
          voiceReplies: {},
          office: {},
          deskAssignments: {},
          standup: {},
        },
        localGatewayDefaults: { url: "ws://localhost:18789", tokenConfigured: true },
      }),
      schedulePatch: () => {},
      flushPending: async () => {},
    };

    const Probe = () => {
      const state = useGatewayConnection(coordinator);
      return createElement(
        "div",
        null,
        createElement("div", { "data-testid": "gatewayUrl" }, state.gatewayUrl),
        createElement("div", { "data-testid": "token" }, state.token),
        createElement(
          "div",
          { "data-testid": "localDefaultsUrl" },
          state.localGatewayDefaults?.url ?? ""
        )
      );
    };

    render(createElement(Probe));

    await waitFor(() => {
      expect(screen.getByTestId("gatewayUrl")).toHaveTextContent("ws://localhost:18789");
    });
    expect(screen.getByTestId("token")).toHaveTextContent("");
    expect(screen.getByTestId("localDefaultsUrl")).toHaveTextContent("ws://localhost:18789");
  });
});
