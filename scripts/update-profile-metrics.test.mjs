import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("recent work follows retained repositories and forks through generated JSON and SVG", async () => {
  const dir = await mkdtemp(join(tmpdir(), "profile-metrics-"));
  try {
    await mkdir(join(dir, "scripts"));
    await copyFile(new URL("./update-profile-metrics.mjs", import.meta.url), join(dir, "scripts/update.mjs"));
    const mock = join(dir, "github.mjs");
    await writeFile(mock, `
import assert from "node:assert/strict";
const repo = (name, visibility = "PUBLIC") => ({
  name: name.split("/")[1], nameWithOwner: name, url: "https://github.com/" + name,
  visibility, isPrivate: visibility === "PRIVATE", updatedAt: "2026-09-29T00:00:00Z",
  stargazerCount: 0, forkCount: 0, primaryLanguage: null,
});
const group = (name, totalCount, visibility) => ({ repository: repo(name, visibility), contributions: { totalCount } });
const totals = { totalCommitContributions: 11, totalPullRequestContributions: 7,
  totalPullRequestReviewContributions: 2, totalIssueContributions: 0,
  totalRepositoriesWithContributedCommits: 2 };
let ownedPages = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "https://api.github.com/graphql");
  const { query, variables } = JSON.parse(options.body);
  let user;
  if (query.includes("query Profile(")) {
    user = { login: "jatmn", followers: { totalCount: 1 }, following: { totalCount: 1 }, repositories: { totalCount: 4 } };
  } else if (query.includes("query OwnedRepos(")) {
    assert.match(query, /ownerAffiliations: OWNER/);
    assert.match(query, /privacy: PUBLIC/);
    assert.match(query, /parent\\s*\\{\\s*url/);
    assert.equal(variables.after, ownedPages === 0 ? null : "next-page");
    const nodes = ownedPages++ === 0
      ? [repo("jatmn/Deneb"), repo("jatmn/jatmn"), repo("jatmn/private", "PRIVATE")]
      : process.env.RETAIN_FORK === "yes"
        ? [{ ...repo("jatmn/renamed-fork"), parent: { url: "https://github.com/mrdoob/three.js" } }]
        : [];
    user = { repositories: { nodes, pageInfo: { hasNextPage: ownedPages === 1, endCursor: "next-page" } } };
  } else if (query.includes("query CommitRepos(")) {
    user = { contributionsCollection: { commitContributionsByRepository: [
      group("mrdoob/three.js", 5), group("jatmn/Deneb", 6), group("jatmn/jatmn", 1),
      group("jatmn/private", 4, "PRIVATE"), { repository: null, contributions: { totalCount: 1 } },
    ] } };
  } else if (query.includes("query PullRequestRepos(")) {
    user = { contributionsCollection: { pullRequestContributionsByRepository: [
      ...(process.env.RETAIN_FORK === "yes" ? Array.from({ length: 21 }, (_, i) => ({ ...group("deleted/repo" + i, 1), repository: { ...repo("deleted/repo" + i), updatedAt: "2026-09-30T00:00:00Z" } })) : []),
      group("mrdoob/three.js", 3), group("jatmn/Deneb", 4),
    ] } };
  } else if (query.includes("query ContributionCalendar(")) {
    user = { recentContributions: { contributionCalendar: { weeks: [{ contributionDays: [{ date: "2026-09-29", contributionCount: 3 }] }] } } };
  } else if (query.includes("query ContributionWindow(")) {
    user = { last30Contributions: totals };
  } else if (query.includes("query DailyActivity(")) {
    user = { day0: totals };
  } else {
    assert.match(query, /query ContributionTotals\\(/);
    user = { contributionsCollection: totals };
  }
  return { ok: true, json: async () => ({ data: { user } }) };
};
`);
    for (const retained of ["no", "yes"]) {
      const run = spawnSync(process.execPath, ["--import", mock, join(dir, "scripts/update.mjs")], {
        env: { ...process.env, GITHUB_TOKEN: "fixture-token", GITHUB_LOGIN: "jatmn", RETAIN_FORK: retained },
        encoding: "utf8",
      });
      assert.equal(run.status, 0, run.stderr);
      const metrics = JSON.parse(await readFile(join(dir, "assets/profile-metrics.json"), "utf8"));
      const svg = await readFile(join(dir, "assets/profile-metrics.svg"), "utf8");
      assert.deepEqual(metrics.recentPublicRepos.map((repo) => repo.nameWithOwner).sort(),
        retained === "yes" ? ["jatmn/Deneb", "mrdoob/three.js"] : ["jatmn/Deneb"]);
      assert.deepEqual(metrics.recentPublicRepos.find((repo) => repo.nameWithOwner === "jatmn/Deneb").contributionCounts,
        { commits: 6, pullRequests: 4 });
      assert.equal(svg.includes("mrdoob/three.js"), retained === "yes");
      assert.ok(svg.includes("jatmn/Deneb"));
      assert.ok(!svg.includes("deleted/repo"));
      assert.ok(!svg.includes("jatmn/private"));
      assert.equal(metrics.contributions.totalPullRequestContributions, 7);
      assert.equal(metrics.contributionWindows.last30Days.totalCommitContributions, 11);
      assert.equal(metrics.contributionTrends.last60Days[0].reviews, 2);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
