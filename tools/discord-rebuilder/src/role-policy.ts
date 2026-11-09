export type RoleKind = "separator" | "staff" | "self-selectable" | "member" | "onboarding";

export type RoleSpec = {
  name: string;
  color?: string;
  hoist?: boolean;
  kind?: RoleKind;
  group?: string;
  selfAssignable?: boolean;
  autoAssign?: boolean;
  legacyNames?: string[];
  reactionEmoji?: string;
};

export function normalizeRoleName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function roleNamesMatch(spec: RoleSpec, actualName: string): boolean {
  const names = [spec.name, ...(spec.legacyNames ?? [])];
  return names.some((name) => normalizeRoleName(name) === normalizeRoleName(actualName));
}

export function validateRoleManifest(roles: readonly RoleSpec[]): string[] {
  const errors: string[] = [];
  const names = new Set<string>();
  const groups = new Set<string>();
  const reactionEmojis = new Set<string>();
  for (const role of roles) {
    const normalized = normalizeRoleName(role.name);
    if (names.has(normalized)) errors.push(`Duplicate role name: ${role.name}`);
    names.add(normalized);
    if (role.kind === "separator") {
      if (role.selfAssignable) errors.push(`Separator role cannot be self-assignable: ${role.name}`);
      if (role.group) groups.add(role.group);
    }
    if (role.autoAssign && role.kind !== "separator" && role.kind !== "member" && role.kind !== "onboarding") {
      errors.push(`Only separator/member roles may auto-assign: ${role.name}`);
    }
    if (role.selfAssignable && role.kind !== "self-selectable") {
      errors.push(`Only self-selectable roles may be self-assignable: ${role.name}`);
    }
    if (role.selfAssignable && !role.group) errors.push(`Self-selectable role needs a group: ${role.name}`);
    if (role.kind === "self-selectable" && role.selfAssignable) {
      const emoji = role.reactionEmoji?.trim();
      if (!emoji) errors.push(`Self-selectable role needs a reaction emoji: ${role.name}`);
      else if (reactionEmojis.has(emoji)) errors.push(`Reaction emoji is assigned to multiple roles: ${emoji}`);
      else reactionEmojis.add(emoji);
    }
    if (role.color && !/^#[0-9a-f]{6}$/i.test(role.color)) errors.push(`Invalid role color: ${role.name}`);
  }
  for (const role of roles) {
    if (role.kind === "self-selectable" && role.group && !groups.has(role.group)) {
      errors.push(`Self-selectable role group has no separator: ${role.group}`);
    }
  }
  return errors;
}

export function selfAssignableRoles(roles: readonly RoleSpec[]): RoleSpec[] {
  return roles.filter((role) => role.kind === "self-selectable" && role.selfAssignable);
}

export function roleForReaction(roles: readonly RoleSpec[], emoji: string): RoleSpec | undefined {
  return selfAssignableRoles(roles).find((role) => role.reactionEmoji === emoji);
}

export function separatorRoles(roles: readonly RoleSpec[]): RoleSpec[] {
  return roles.filter((role) => role.kind === "separator" && role.autoAssign);
}
