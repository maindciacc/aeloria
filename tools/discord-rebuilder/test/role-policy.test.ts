import assert from "node:assert/strict";
import test from "node:test";
import { separatorRoles, selfAssignableRoles, validateRoleManifest } from "../src/role-policy.js";

test("role manifest separates safe self-selectable roles from staff roles", () => {
  const roles = [
    { name: "━━ CONTRIBUTORS ━━", kind: "separator" as const, group: "contributors", autoAssign: true },
    { name: "Builder", kind: "self-selectable" as const, group: "contributors", selfAssignable: true, reactionEmoji: "🧱" },
    { name: "Moderator", kind: "staff" as const },
  ];
  assert.deepEqual(validateRoleManifest(roles), []);
  assert.equal(separatorRoles(roles).length, 1);
  assert.equal(selfAssignableRoles(roles).length, 1);
});

test("reaction emoji mappings are unique and limited to self-selectable roles", () => {
  const errors = validateRoleManifest([
    { name: "━━ CONTRIBUTORS ━━", kind: "separator", group: "contributors", autoAssign: true },
    { name: "Builder", kind: "self-selectable", group: "contributors", selfAssignable: true, reactionEmoji: "🧱" },
    { name: "Artist", kind: "self-selectable", group: "contributors", selfAssignable: true, reactionEmoji: "🧱" },
  ]);
  assert.equal(errors.some((error) => error.includes("assigned to multiple roles")), true);
});

test("invalid role permissions and groups fail closed", () => {
  const errors = validateRoleManifest([
    { name: "Bad separator", kind: "separator", selfAssignable: true },
    { name: "Bad staff", kind: "staff", autoAssign: true },
    { name: "Unbacked", kind: "self-selectable", group: "missing", selfAssignable: true },
  ]);
  assert.equal(errors.some((error) => error.includes("Separator role cannot be self-assignable")), true);
  assert.equal(errors.some((error) => error.includes("Only separator/member roles may auto-assign")), true);
  assert.equal(errors.some((error) => error.includes("Self-selectable role group has no separator")), true);
});
