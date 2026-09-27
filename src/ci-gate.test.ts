import { expect, it } from "vitest";

// Deliberately failing: proves a red CI blocks merge and deploy. Do not merge.
it("ci gate demo", () => {
  expect(1 + 1).toBe(3);
});
