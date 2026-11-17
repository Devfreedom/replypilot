import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assistantProviderBadgeLabel,
  parseWorkspaceResponse,
  resolveWorkspaceCanManage,
} from "./workspace";

test("parseWorkspaceResponse accepts mock, gemini, and omitted replyDraftProvider", () => {
  const base = {
    workspace: { id: "ws-1", name: "Ada Studio" },
    role: "owner",
  };

  assert.deepEqual(parseWorkspaceResponse({ ...base, replyDraftProvider: "gemini" }), {
    workspace: { id: "ws-1", name: "Ada Studio" },
    role: "owner",
    replyDraftProvider: "gemini",
  });

  assert.deepEqual(parseWorkspaceResponse({ ...base, replyDraftProvider: "mock" }), {
    workspace: { id: "ws-1", name: "Ada Studio" },
    role: "owner",
    replyDraftProvider: "mock",
  });

  assert.deepEqual(parseWorkspaceResponse(base), {
    workspace: { id: "ws-1", name: "Ada Studio" },
    role: "owner",
    replyDraftProvider: "mock",
  });

  assert.equal(
    parseWorkspaceResponse({ ...base, replyDraftProvider: "unknown" }),
    null,
  );
  assert.equal(parseWorkspaceResponse(null), null);
});

test("assistantProviderBadgeLabel displays Gemini AI vs Mock provider copy accurately", () => {
  assert.equal(
    assistantProviderBadgeLabel("gemini"),
    "Gemini AI · grounded drafts",
  );
  assert.equal(
    assistantProviderBadgeLabel("mock"),
    "Mock provider · no live AI",
  );
  assert.equal(
    assistantProviderBadgeLabel(null),
    "Mock provider · no live AI",
  );
});

test("resolveWorkspaceCanManage derives permission from workspace role unless explicitly overridden", () => {
  assert.equal(resolveWorkspaceCanManage("owner"), true);
  assert.equal(resolveWorkspaceCanManage("member"), false);
  assert.equal(resolveWorkspaceCanManage(null), false);
  assert.equal(resolveWorkspaceCanManage("owner", false), false);
  assert.equal(resolveWorkspaceCanManage("member", true), true);
});
