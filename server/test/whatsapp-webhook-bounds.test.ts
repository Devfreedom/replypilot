import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { test } from "node:test";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import type { Pool } from "pg";
import {
  InvalidWhatsAppPayloadError,
  MAX_WEBHOOK_CHANGES_PER_ENTRY,
  MAX_WEBHOOK_CONTACTS_PER_CHANGE,
  MAX_WEBHOOK_ENTRIES,
  MAX_WEBHOOK_MESSAGES_PER_PAYLOAD,
  MAX_WEBHOOK_STATUSES_PER_PAYLOAD,
  PHONE_NUMBER_ID_PATTERN,
  parseWhatsAppDeliveryStatuses,
  parseWhatsAppWebhook,
} from "../src/whatsapp/parser.js";
import type { WhatsAppIntegrationConfig } from "../src/whatsapp/types.js";
import { createWhatsAppWebhookRouter } from "../src/whatsapp/webhook-routes.js";

const TEST_APP_SECRET = "test-whatsapp-app-secret-0123456789";
const TEST_VERIFY_TOKEN = "test-whatsapp-verify-token-0123456789";
const VALID_PHONE_NUMBER_ID = "106540352242922";
const TEST_SENDER_WA_ID = "447700900123";

const TEST_CONFIG: WhatsAppIntegrationConfig = {
  verifyToken: TEST_VERIFY_TOKEN,
  appSecret: TEST_APP_SECRET,
};

const UNUSED_POOL = {
  query() {
    throw new Error("Database must not be queried in bounds/signature tests");
  },
  connect() {
    throw new Error("Database must not be connected in bounds/signature tests");
  },
} as unknown as Pool;

function signPayload(rawBody: string | Buffer): string {
  const buffer = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(rawBody, "utf8");
  return `sha256=${createHmac("sha256", TEST_APP_SECRET).update(buffer).digest("hex")}`;
}

function makeMessage(index = 0, text = "Hello") {
  return {
    from: TEST_SENDER_WA_ID,
    id: `wamid.msg_${index}`,
    timestamp: "1760000000",
    type: "text",
    text: { body: text },
  };
}

function makeStatus(index = 0) {
  return {
    id: `wamid.status_${index}`,
    status: "delivered",
    timestamp: "1760000000",
  };
}

function makeContact(index = 0) {
  return {
    wa_id: TEST_SENDER_WA_ID,
    profile: { name: `Customer ${index}` },
  };
}

function wrapChanges(changes: unknown[]) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "waba-1", changes }],
  };
}

function messageChange(
  messages: unknown[],
  phoneNumberId: unknown = VALID_PHONE_NUMBER_ID,
  contacts?: unknown[],
) {
  return {
    field: "messages",
    value: {
      messaging_product: "whatsapp",
      metadata: {
        display_phone_number: "15550783881",
        phone_number_id: phoneNumberId,
      },
      ...(contacts ? { contacts } : {}),
      messages,
    },
  };
}

function statusChange(
  statuses: unknown[],
  phoneNumberId: unknown = VALID_PHONE_NUMBER_ID,
) {
  return {
    field: "messages",
    value: {
      messaging_product: "whatsapp",
      metadata: {
        display_phone_number: "15550783881",
        phone_number_id: phoneNumberId,
      },
      statuses,
    },
  };
}

async function withWebhookServer(
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(
    "/api/webhooks/whatsapp",
    createWhatsAppWebhookRouter({ pool: UNUSED_POOL, config: TEST_CONFIG }),
  );
  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      next: NextFunction,
    ) => {
      if (response.headersSent) {
        next(error);
        return;
      }

      if (
        typeof error === "object" &&
        error !== null &&
        "type" in error &&
        error.type === "entity.too.large"
      ) {
        response.status(413).json({ error: "Payload too large" });
        return;
      }

      response.status(500).json({ error: "Unexpected error" });
    },
  );

  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/webhooks/whatsapp`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function postSignedJson(
  baseUrl: string,
  payload: unknown,
): Promise<globalThis.Response> {
  const body = JSON.stringify(payload);
  return fetch(baseUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": signPayload(body),
    },
    body,
  });
}

// ─── Parser bounds & phone_number_id validation ──────────────────────────────

test("H-09 exports expected webhook parser bounds and phone_number_id regex", () => {
  assert.equal(MAX_WEBHOOK_ENTRIES, 1_000);
  assert.equal(MAX_WEBHOOK_CHANGES_PER_ENTRY, 1_000);
  assert.equal(MAX_WEBHOOK_MESSAGES_PER_PAYLOAD, 1_000);
  assert.equal(MAX_WEBHOOK_STATUSES_PER_PAYLOAD, 1_000);
  assert.equal(MAX_WEBHOOK_CONTACTS_PER_CHANGE, 1_000);
  assert.equal(PHONE_NUMBER_ID_PATTERN.source, "^\\d{5,32}$");
});

test("H-09 rejects webhook arrays at 1_001 and accepts 1_000 in parser", () => {
  const okEntries = {
    object: "whatsapp_business_account",
    entry: Array.from({ length: 1_000 }, (_, i) => ({
      id: `waba-${i}`,
      changes: [],
    })),
  };
  assert.deepEqual(parseWhatsAppWebhook(okEntries), []);
  assert.deepEqual(parseWhatsAppDeliveryStatuses(okEntries), []);

  const tooManyEntries = {
    object: "whatsapp_business_account",
    entry: Array.from({ length: 1_001 }, (_, i) => ({
      id: `waba-${i}`,
      changes: [],
    })),
  };
  assert.throws(
    () => parseWhatsAppWebhook(tooManyEntries),
    InvalidWhatsAppPayloadError,
  );
  assert.throws(
    () => parseWhatsAppDeliveryStatuses(tooManyEntries),
    InvalidWhatsAppPayloadError,
  );

  const okChanges = wrapChanges(
    Array.from({ length: 1_000 }, () => ({ field: "other" })),
  );
  assert.deepEqual(parseWhatsAppWebhook(okChanges), []);
  assert.deepEqual(parseWhatsAppDeliveryStatuses(okChanges), []);

  const tooManyChanges = wrapChanges(
    Array.from({ length: 1_001 }, () => ({ field: "other" })),
  );
  assert.throws(
    () => parseWhatsAppWebhook(tooManyChanges),
    InvalidWhatsAppPayloadError,
  );
  assert.throws(
    () => parseWhatsAppDeliveryStatuses(tooManyChanges),
    InvalidWhatsAppPayloadError,
  );

  const okMessages = wrapChanges([
    messageChange(Array.from({ length: 1_000 }, (_, i) => makeMessage(i))),
  ]);
  assert.equal(parseWhatsAppWebhook(okMessages).length, 1_000);

  const tooManyMessagesSingle = wrapChanges([
    messageChange(Array.from({ length: 1_001 }, (_, i) => makeMessage(i))),
  ]);
  assert.throws(
    () => parseWhatsAppWebhook(tooManyMessagesSingle),
    InvalidWhatsAppPayloadError,
  );

  const tooManyMessagesSplit = wrapChanges([
    messageChange(Array.from({ length: 600 }, (_, i) => makeMessage(i))),
    messageChange(Array.from({ length: 401 }, (_, i) => makeMessage(600 + i))),
  ]);
  assert.throws(
    () => parseWhatsAppWebhook(tooManyMessagesSplit),
    InvalidWhatsAppPayloadError,
  );

  const okStatuses = wrapChanges([
    statusChange(Array.from({ length: 1_000 }, (_, i) => makeStatus(i))),
  ]);
  assert.equal(parseWhatsAppDeliveryStatuses(okStatuses).length, 1_000);

  const tooManyStatusesSingle = wrapChanges([
    statusChange(Array.from({ length: 1_001 }, (_, i) => makeStatus(i))),
  ]);
  assert.throws(
    () => parseWhatsAppDeliveryStatuses(tooManyStatusesSingle),
    InvalidWhatsAppPayloadError,
  );

  const tooManyStatusesSplit = wrapChanges([
    statusChange(Array.from({ length: 500 }, (_, i) => makeStatus(i))),
    statusChange(Array.from({ length: 501 }, (_, i) => makeStatus(500 + i))),
  ]);
  assert.throws(
    () => parseWhatsAppDeliveryStatuses(tooManyStatusesSplit),
    InvalidWhatsAppPayloadError,
  );

  const okContacts = wrapChanges([
    messageChange(
      [makeMessage(0)],
      VALID_PHONE_NUMBER_ID,
      Array.from({ length: 1_000 }, (_, i) => makeContact(i)),
    ),
  ]);
  assert.equal(parseWhatsAppWebhook(okContacts).length, 1);

  const tooManyContacts = wrapChanges([
    messageChange(
      [makeMessage(0)],
      VALID_PHONE_NUMBER_ID,
      Array.from({ length: 1_001 }, (_, i) => makeContact(i)),
    ),
  ]);
  assert.throws(
    () => parseWhatsAppWebhook(tooManyContacts),
    InvalidWhatsAppPayloadError,
  );
});

test("H-09 logs only counts when webhook array bounds are exceeded (never PII or bodies)", () => {
  const originalWarn = console.warn;
  const loggedArgs: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    loggedArgs.push(args);
  };

  try {
    const secretText = "PRIVATE_BODY_DO_NOT_LOG";
    const payload = wrapChanges([
      messageChange(
        Array.from({ length: 1_001 }, (_, i) => makeMessage(i, secretText)),
      ),
    ]);

    assert.throws(
      () => parseWhatsAppWebhook(payload),
      InvalidWhatsAppPayloadError,
    );
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(loggedArgs.length, 1);
  const serialized = JSON.stringify(loggedArgs[0]);
  assert.match(serialized, /1001/);
  assert.match(serialized, /1000/);
  assert.ok(!serialized.includes(TEST_SENDER_WA_ID));
  assert.ok(!serialized.includes("PRIVATE_BODY_DO_NOT_LOG"));
});

test("H-09 validates metadata.phone_number_id against /^\\d{5,32}$/ in message and status parsers", () => {
  for (const validId of ["12345", "1".repeat(32), VALID_PHONE_NUMBER_ID]) {
    const msgPayload = wrapChanges([messageChange([makeMessage()], validId)]);
    assert.equal(parseWhatsAppWebhook(msgPayload).length, 1);

    const statusPayload = wrapChanges([statusChange([makeStatus()], validId)]);
    assert.equal(parseWhatsAppDeliveryStatuses(statusPayload).length, 1);
  }

  for (const invalidId of [
    "",
    "1234",
    "1".repeat(33),
    "not-numeric",
    "+106540352242922",
    " 106540352242922 ",
    106540352242922,
    null,
  ]) {
    const msgPayload = wrapChanges([messageChange([makeMessage()], invalidId)]);
    assert.throws(
      () => parseWhatsAppWebhook(msgPayload),
      InvalidWhatsAppPayloadError,
      `Expected message parser to reject phone_number_id=${String(invalidId)}`,
    );
    assert.throws(
      () => parseWhatsAppWebhook(msgPayload, VALID_PHONE_NUMBER_ID),
      InvalidWhatsAppPayloadError,
    );

    const statusPayload = wrapChanges([
      statusChange([makeStatus()], invalidId),
    ]);
    assert.throws(
      () => parseWhatsAppDeliveryStatuses(statusPayload),
      InvalidWhatsAppPayloadError,
      `Expected status parser to reject phone_number_id=${String(invalidId)}`,
    );
    assert.throws(
      () => parseWhatsAppDeliveryStatuses(statusPayload, VALID_PHONE_NUMBER_ID),
      InvalidWhatsAppPayloadError,
    );
  }
});

// ─── Router integration: HTTP 400 on bounds/phone_number_id ──────────────────

test("H-09 router returns HTTP 400 for 1_001 array bounds and invalid phone_number_id without DB calls", async () => {
  await withWebhookServer(async (baseUrl) => {
    const payloads: Array<[string, unknown]> = [
      [
        "entries",
        {
          object: "whatsapp_business_account",
          entry: Array.from({ length: 1_001 }, (_, i) => ({
            id: `w-${i}`,
            changes: [],
          })),
        },
      ],
      [
        "changes",
        wrapChanges(
          Array.from({ length: 1_001 }, () => ({ field: "other" })),
        ),
      ],
      [
        "messages",
        wrapChanges([
          messageChange(
            Array.from({ length: 1_001 }, (_, i) => makeMessage(i)),
          ),
        ]),
      ],
      [
        "statuses",
        wrapChanges([
          statusChange(
            Array.from({ length: 1_001 }, (_, i) => makeStatus(i)),
          ),
        ]),
      ],
      [
        "contacts",
        wrapChanges([
          messageChange(
            [makeMessage()],
            VALID_PHONE_NUMBER_ID,
            Array.from({ length: 1_001 }, (_, i) => makeContact(i)),
          ),
        ]),
      ],
      [
        "invalid phone_number_id (non-numeric)",
        wrapChanges([messageChange([makeMessage()], "abc-123")]),
      ],
      [
        "invalid phone_number_id (too short)",
        wrapChanges([statusChange([makeStatus()], "1234")]),
      ],
      [
        "invalid phone_number_id (too long)",
        wrapChanges([messageChange([makeMessage()], "1".repeat(33))]),
      ],
    ];

    for (const [label, payload] of payloads) {
      const response = await postSignedJson(baseUrl, payload);
      assert.equal(response.status, 400, `Expected 400 for ${label}`);
      assert.deepEqual(await response.json(), {
        error: "Invalid webhook payload",
      });
    }
  });
});

// ─── L-03-webhook: Pre-buffer signature format guard ─────────────────────────

test("L-03-webhook rejects missing or malformed x-hub-signature-256 with 401 before buffering body stream", async () => {
  await withWebhookServer(async (baseUrl) => {
    // 1. GET verification remains untouched.
    const verifyRes = await fetch(
      `${baseUrl}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(TEST_VERIFY_TOKEN)}&hub.challenge=challenge-ok`,
    );
    assert.equal(verifyRes.status, 200);
    assert.equal(await verifyRes.text(), "challenge-ok");

    // 2. Un-ended chunked HTTP stream returns 401 immediately without waiting for stream end.
    const malformedHeaders: Array<[string, string | undefined]> = [
      ["missing", undefined],
      ["empty", ""],
      ["non-hex", "sha256=not-hex"],
      ["too-short", `sha256=${"a".repeat(63)}`],
      ["too-long", `sha256=${"a".repeat(65)}`],
      ["wrong-alg", `md5=${"a".repeat(64)}`],
    ];

    for (const [label, sigHeader] of malformedHeaders) {
      const result = await new Promise<{ status?: number; body: string }>(
        (resolve, reject) => {
          const headers: Record<string, string> = {
            "content-type": "application/json",
            "transfer-encoding": "chunked",
          };
          if (sigHeader !== undefined) {
            headers["x-hub-signature-256"] = sigHeader;
          }

          const req = http.request(
            baseUrl,
            { method: "POST", headers },
            (res) => {
              let body = "";
              res.on("data", (chunk) => {
                body += chunk;
              });
              res.on("end", () => {
                req.destroy();
                resolve({ status: res.statusCode, body });
              });
            },
          );
          req.on("error", reject);
          req.write('{"unterminated":true');
          // Intentionally never call req.end() — only a pre-buffer middleware responds here.
        },
      );

      assert.equal(result.status, 401, `Expected 401 for ${label}`);
      assert.deepEqual(JSON.parse(result.body), {
        error: "Invalid webhook signature",
      });
    }

    // 3. Oversized (>3MB) body with missing/malformed signature returns 401, NOT 413.
    const oversizedBody = JSON.stringify({ pad: "x".repeat(3_500_000) });
    const unbuffered401 = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": "sha256=invalid",
      },
      body: oversizedBody,
    });
    assert.equal(unbuffered401.status, 401);
    assert.deepEqual(await unbuffered401.json(), {
      error: "Invalid webhook signature",
    });

    // 4. Well-formed signature format with >3MB body still enforces WEBHOOK_BODY_LIMIT (413).
    const oversizedSigned = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signPayload(oversizedBody),
      },
      body: oversizedBody,
    });
    assert.equal(oversizedSigned.status, 413);

    // 5. Well-formed signature format with wrong HMAC digest is still rejected with 401.
    const wrongHmac = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${"a".repeat(64)}`,
      },
      body: JSON.stringify({ object: "other" }),
    });
    assert.equal(wrongHmac.status, 401);
    assert.deepEqual(await wrongHmac.json(), {
      error: "Invalid webhook signature",
    });
  });
});

test("L-03-webhook never reads or attaches data listeners to custom Readable stream on missing/malformed signature", async () => {
  const router = createWhatsAppWebhookRouter({
    pool: UNUSED_POOL,
    config: TEST_CONFIG,
  });

  for (const signatureHeader of [undefined, "sha256=bad"]) {
    let readCalled = false;
    let dataListenerAttached = false;

    const requestHeaders: Record<string, string> = {
      "content-type": "application/json",
      ...(signatureHeader ? { "x-hub-signature-256": signatureHeader } : {}),
    };
    const fakeRequest = new Readable({
      read() {
        readCalled = true;
      },
    }) as Readable & {
      method: string;
      url: string;
      originalUrl: string;
      headers: Record<string, string>;
      header: (name: string) => string | undefined;
    };
    fakeRequest.method = "POST";
    fakeRequest.url = "/";
    fakeRequest.originalUrl = "/api/webhooks/whatsapp";
    fakeRequest.headers = requestHeaders;
    fakeRequest.header = (name: string) => requestHeaders[name.toLowerCase()];
    fakeRequest.push(Buffer.from('{"shouldNotBeRead":true}', "utf8"));

    const origOn = fakeRequest.on.bind(fakeRequest);
    fakeRequest.on = ((event: string | symbol, listener: (...args: unknown[]) => void) => {
      if (event === "data") {
        dataListenerAttached = true;
      }
      return origOn(event, listener);
    }) as typeof fakeRequest.on;

    const headers = new Map<string, string>();
    let statusCode = 200;
    let responseBody = "";

    class MockServerResponse extends EventEmitter {
      headersSent = false;
      status(code: number) {
        statusCode = code;
        return this;
      }
      setHeader(name: string, value: string) {
        headers.set(name.toLowerCase(), value);
        return this;
      }
      getHeader(name: string) {
        return headers.get(name.toLowerCase());
      }
      json(body: unknown) {
        responseBody = JSON.stringify(body);
        this.headersSent = true;
        this.emit("finish");
        return this;
      }
    }

    const fakeResponse = new MockServerResponse();

    await new Promise<void>((resolve, reject) => {
      fakeResponse.once("finish", resolve);
      (
        router as unknown as (
          req: unknown,
          res: unknown,
          next: (err?: unknown) => void,
        ) => void
      )(fakeRequest, fakeResponse, (error) => {
        reject(error ?? new Error("Unexpected next() call"));
      });
    });

    assert.equal(statusCode, 401);
    assert.deepEqual(JSON.parse(responseBody), {
      error: "Invalid webhook signature",
    });
    assert.equal(readCalled, false, "Stream _read must not be invoked");
    assert.equal(
      dataListenerAttached,
      false,
      "No 'data' listener may be attached to the request stream",
    );
  }
});
