import assert from "node:assert/strict";
import { test } from "node:test";
import { BRAND, brandAltText, brandPageTitle } from "./brand";

test("centralized BRAND config defines complete non-empty product identity", () => {
  assert.ok(BRAND.name.trim().length > 0);
  assert.ok(BRAND.tagline.trim().length > 0);
  assert.ok(BRAND.metaDescription.trim().length > 0);
  assert.ok(BRAND.footerTagline.trim().length > 0);
  assert.ok(BRAND.mark.outerPath.length > 0);
  assert.ok(BRAND.mark.stitchPaths.length >= 1);
});

test("brandPageTitle and brandAltText always derive from central BRAND.name", () => {
  assert.equal(
    brandPageTitle("WhatsApp inbox"),
    `${BRAND.name} - WhatsApp inbox`,
  );
  assert.equal(
    brandPageTitle("   "),
    `${BRAND.name} - ${BRAND.defaultPageTitle}`,
  );
  assert.equal(brandAltText(), `${BRAND.name} logo`);
  assert.equal(brandAltText("home"), `${BRAND.name} home`);
});
