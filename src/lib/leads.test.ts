import assert from "node:assert/strict";
import { test } from "node:test";
import { dashboardViewHref, parseDashboardView } from "./leads.js";

test("dashboard view query parsing defaults to overview and accepts known views", () => {
  assert.equal(parseDashboardView(null), "overview");
  assert.equal(parseDashboardView(""), "overview");
  assert.equal(parseDashboardView("overview"), "overview");
  assert.equal(parseDashboardView("leads"), "leads");
  assert.equal(parseDashboardView("follow-ups"), "follow-ups");
  assert.equal(parseDashboardView("unknown"), "overview");
});

test("dashboard view links use the view query parameter", () => {
  assert.equal(dashboardViewHref("overview"), "/?view=overview");
  assert.equal(dashboardViewHref("leads"), "/?view=leads");
  assert.equal(dashboardViewHref("follow-ups"), "/?view=follow-ups");
});
