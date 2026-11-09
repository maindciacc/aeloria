export type ExpectedChannel = {
  category: string;
  name: string;
  type: "text" | "voice";
  legacyNames?: string[];
};

export type LiveChannel = {
  name: string;
  type: "text" | "voice" | "other";
  category: string | null;
};

export type ChannelCheckReport = {
  expectedCount: number;
  visibleCount: number;
  missing: string[];
  unexpected: string[];
  misplaced: string[];
  typeMismatches: string[];
  duplicates: string[];
};

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function location(category: string | null, channel: string): string {
  return `${category ?? "[uncategorized]"}/#${channel}`;
}

export function expectedChannelsFromManifest(manifest: { categories: Array<{ name: string; channels: Array<{ name: string; type: "text" | "voice"; legacyNames?: string[] }> }> }): ExpectedChannel[] {
  return manifest.categories.flatMap((category) => category.channels.map((channel) => ({
    category: category.name,
    name: channel.name,
    type: channel.type,
    ...(channel.legacyNames ? { legacyNames: channel.legacyNames } : {}),
  })));
}

export function compareChannels(expected: readonly ExpectedChannel[], live: readonly LiveChannel[]): ChannelCheckReport {
  const expectedByKey = new Map<string, ExpectedChannel>();
  const expectedNames = new Set<string>();
  for (const channel of expected) {
    for (const name of [channel.name, ...(channel.legacyNames ?? [])]) {
      expectedByKey.set(`${normalize(channel.category)}:${normalize(name)}`, channel);
      expectedNames.add(normalize(name));
    }
  }

  const liveByKey = new Map<string, LiveChannel[]>();
  for (const channel of live) {
    const key = `${normalize(channel.category ?? "")}:${normalize(channel.name)}`;
    liveByKey.set(key, [...(liveByKey.get(key) ?? []), channel]);
  }

  const missing: string[] = [];
  const typeMismatches: string[] = [];
  const misplaced: string[] = [];
  for (const channel of expected) {
    const key = `${normalize(channel.category)}:${normalize(channel.name)}`;
    const matches = liveByKey.get(key) ?? [];
    if (matches.length === 0) {
      const sameNameElsewhere = live.filter((item) => normalize(item.name) === normalize(channel.name));
      if (sameNameElsewhere.length > 0) {
        misplaced.push(`${location(sameNameElsewhere[0].category, sameNameElsewhere[0].name)} should be ${location(channel.category, channel.name)}`);
      } else {
        missing.push(location(channel.category, channel.name));
      }
      continue;
    }
    if (matches.some((item) => item.type !== channel.type)) {
      typeMismatches.push(`${location(channel.category, channel.name)} should be ${channel.type}, found ${matches.map((item) => item.type).join(", ")}`);
    }
  }

  const unexpected: string[] = [];
  for (const channel of live) {
    const key = `${normalize(channel.category ?? "")}:${normalize(channel.name)}`;
    if (!expectedByKey.has(key) && !expectedNames.has(normalize(channel.name))) unexpected.push(location(channel.category, channel.name));
  }

  const duplicates: string[] = [];
  for (const [key, matches] of liveByKey) {
    if (matches.length > 1) duplicates.push(`${location(matches[0].category, matches[0].name)} (${matches.length} copies)`);
  }

  return {
    expectedCount: expected.length,
    visibleCount: live.length,
    missing,
    unexpected,
    misplaced,
    typeMismatches,
    duplicates,
  };
}

export function formatChannelCheck(report: ChannelCheckReport): string[] {
  const driftCount = report.missing.length + report.unexpected.length + report.misplaced.length + report.typeMismatches.length + report.duplicates.length;
  const lines = [
    `Repository channel check: ${driftCount === 0 ? "MATCH" : `${driftCount} issue(s) found`}`,
    `Expected channels: ${report.expectedCount}; visible channels checked: ${report.visibleCount}`,
  ];
  const section = (label: string, values: readonly string[], empty: string): void => {
    lines.push("", `${label}: ${values.length}`);
    if (values.length === 0) lines.push(`  ${empty}`);
    else for (const value of values) lines.push(`  ${value}`);
  };
  section("Missing from Discord", report.missing, "none");
  section("Unexpected in Discord", report.unexpected, "none");
  section("In the wrong category", report.misplaced, "none");
  section("Wrong channel type", report.typeMismatches, "none");
  section("Duplicate channels", report.duplicates, "none");
  return lines;
}
