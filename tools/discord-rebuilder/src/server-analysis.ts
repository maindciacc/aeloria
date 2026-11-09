export type ExpectedRole = {
  name: string;
  legacyNames?: string[];
};

export type ExpectedCategory = {
  name: string;
};

export type LiveRole = {
  name: string;
  managed?: boolean;
};

export type LiveCategory = {
  name: string;
};

export type ServerAnalysisReport = {
  expectedCategories: number;
  visibleCategories: number;
  expectedRoles: number;
  visibleRoles: number;
  categoryMissing: string[];
  categoryUnexpected: string[];
  roleMissing: string[];
  roleUnexpected: string[];
  channelMissing: string[];
  channelUnexpected: string[];
  channelMisplaced: string[];
  channelTypeMismatches: string[];
  duplicateChannels: string[];
};

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function compareServer(
  expectedCategories: readonly ExpectedCategory[],
  liveCategories: readonly LiveCategory[],
  expectedRoles: readonly ExpectedRole[],
  liveRoles: readonly LiveRole[],
  channelReport: Pick<ServerAnalysisReport, "channelMissing" | "channelUnexpected" | "channelMisplaced" | "channelTypeMismatches" | "duplicateChannels">,
): ServerAnalysisReport {
  const expectedCategoryNames = new Set(expectedCategories.map((item) => normalize(item.name)));
  const liveCategoryNames = new Set(liveCategories.map((item) => normalize(item.name)));
  const expectedRoleNames = new Set(expectedRoles.flatMap((item) => [item.name, ...(item.legacyNames ?? [])].map(normalize)));
  const liveRoleNames = new Set(liveRoles.map((item) => normalize(item.name)));

  return {
    expectedCategories: expectedCategories.length,
    visibleCategories: liveCategories.length,
    expectedRoles: expectedRoles.length,
    visibleRoles: liveRoles.length,
    categoryMissing: expectedCategories.filter((item) => !liveCategoryNames.has(normalize(item.name))).map((item) => item.name),
    categoryUnexpected: liveCategories.filter((item) => !expectedCategoryNames.has(normalize(item.name))).map((item) => item.name),
    roleMissing: expectedRoles.filter((item) => !liveRoleNames.has(normalize(item.name)) && !(item.legacyNames ?? []).some((name) => liveRoleNames.has(normalize(name)))).map((item) => item.name),
    roleUnexpected: liveRoles.filter((item) => !item.managed && !expectedRoleNames.has(normalize(item.name))).map((item) => item.name),
    ...channelReport,
  };
}

export function formatServerAnalysis(report: ServerAnalysisReport): string[] {
  const issues = [
    ...report.categoryMissing,
    ...report.categoryUnexpected,
    ...report.roleMissing,
    ...report.roleUnexpected,
    ...report.channelMissing,
    ...report.channelUnexpected,
    ...report.channelMisplaced,
    ...report.channelTypeMismatches,
    ...report.duplicateChannels,
  ];
  const lines = [
    `Repository/server analysis: ${issues.length === 0 ? "MATCH" : `${issues.length} issue(s) found`}`,
    `Categories: ${report.visibleCategories} visible / ${report.expectedCategories} in repository`,
    `Roles: ${report.visibleRoles} visible / ${report.expectedRoles} in repository`,
    `Channels: ${report.channelMissing.length === 0 ? "no missing" : `${report.channelMissing.length} missing`} and ${report.channelUnexpected.length === 0 ? "no unexpected" : `${report.channelUnexpected.length} unexpected`}`,
  ];
  const section = (label: string, values: readonly string[]): void => {
    lines.push("", `${label}: ${values.length}`);
    if (values.length === 0) lines.push("  none");
    else for (const value of values) lines.push(`  ${value}`);
  };
  section("Missing categories", report.categoryMissing);
  section("Unexpected categories", report.categoryUnexpected);
  section("Missing roles", report.roleMissing);
  section("Unexpected unmanaged roles", report.roleUnexpected);
  section("Missing channels", report.channelMissing);
  section("Unexpected channels", report.channelUnexpected);
  section("Misplaced channels", report.channelMisplaced);
  section("Wrong channel types", report.channelTypeMismatches);
  section("Duplicate channels", report.duplicateChannels);
  lines.push("", "Read-only report: no Discord resources were changed. Only visible resources were analyzed.");
  return lines;
}
