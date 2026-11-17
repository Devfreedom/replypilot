/**
 * Browser adapter for the Meta JavaScript SDK used by Embedded Signup v4.
 *
 * The SDK is loaded only when the owner starts onboarding. The app secret is
 * never used here. The returned authorization code is held briefly in component
 * memory and sent to the ReplyPilot API, which performs the server-side
 * exchange.
 */

const SDK_URL = "https://connect.facebook.net/en_US/sdk.js";
const SDK_TIMEOUT_MS = 15_000;

export type MetaLoginResponse = Readonly<{
  status: "connected" | "not_authorized" | "unknown";
  code: string | null;
}>;

type FacebookLoginResponse = {
  status?: string;
  authResponse?: {
    code?: string;
  } | null;
};

type FacebookSdk = {
  init(options: {
    appId: string;
    autoLogAppEvents: boolean;
    xfbml: boolean;
    version: string;
  }): void;
  login(
    callback: (response: FacebookLoginResponse) => void,
    options: Record<string, unknown>,
  ): void;
};

declare global {
  interface Window {
    FB?: FacebookSdk;
  }
}

let loadPromise: Promise<void> | null = null;

export function loadMetaSdk(): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(
      new Error("The Meta SDK can only be loaded in a browser."),
    );
  }

  if (window.FB) {
    return Promise.resolve();
  }

  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      loadPromise = null;
      script.remove();
      reject(new Error("Meta signup took too long to load. Check your connection and retry."));
    }, SDK_TIMEOUT_MS);

    script.src = SDK_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    script.onerror = () => {
      window.clearTimeout(timeout);
      loadPromise = null;
      script.remove();
      reject(
        new Error(
          "Meta signup could not be loaded. Check your connection or content blocker and retry.",
        ),
      );
    };

    document.head.appendChild(script);
  });

  return loadPromise;
}

export type MetaSdkSession = Readonly<{
  login(options: Readonly<{ configId: string }>): Promise<MetaLoginResponse>;
}>;

/**
 * Loads and initializes the SDK, then returns a login wrapper configured for
 * Embedded Signup v4 with an authorization-code response.
 */
export async function initializeMetaSdk(
  options: Readonly<{ appId: string; version: string }>,
): Promise<MetaSdkSession> {
  await loadMetaSdk();
  const sdk = window.FB;

  if (!sdk) {
    throw new Error("Meta signup is unavailable in this browser.");
  }

  sdk.init({
    appId: options.appId,
    autoLogAppEvents: true,
    xfbml: true,
    version: options.version,
  });

  return {
    login: ({ configId }) =>
      new Promise<MetaLoginResponse>((resolve) => {
        sdk.login(
          (response) => {
            const status =
              response.status === "connected" ||
              response.status === "not_authorized"
                ? response.status
                : "unknown";
            const code =
              typeof response.authResponse?.code === "string"
                ? response.authResponse.code
                : null;

            resolve({ status, code });
          },
          {
            config_id: configId,
            response_type: "code",
            override_default_response_type: true,
            extras: { setup: {} },
          },
        );
      }),
  };
}
