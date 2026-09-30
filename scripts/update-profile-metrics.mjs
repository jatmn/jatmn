import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const login = process.env.GITHUB_LOGIN || "jatmn";
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const outDir = new URL("../assets/", import.meta.url);
const now = new Date();
const from60 = startOfUtcDay(daysAgo(59));
const from30 = startOfUtcDay(daysAgo(29));
const to = now.toISOString();

if (!token) {
  console.error("Set GITHUB_TOKEN or GH_TOKEN before running the profile metrics updater.");
  process.exit(1);
}

const profileQuery = `
query Profile($login: String!) {
  user(login: $login) {
    login
    name
    location
    websiteUrl
    followers { totalCount }
    following { totalCount }
    repositories(ownerAffiliations: OWNER, privacy: PUBLIC) { totalCount }
  }
}`;

const contributionTotalsQuery = `
query ContributionTotals($login: String!) {
  user(login: $login) {
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalPullRequestReviewContributions
      totalIssueContributions
      totalRepositoriesWithContributedCommits
    }
  }
}`;

const contributionCalendarQuery = `
query ContributionCalendar($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    recentContributions: contributionsCollection(from: $from, to: $to) {
      contributionCalendar { weeks { contributionDays { date contributionCount } } }
    }
  }
}`;

const contributionWindowQuery = `
query ContributionWindow($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    last30Contributions: contributionsCollection(from: $from, to: $to) {
      totalCommitContributions
      totalPullRequestContributions
      totalPullRequestReviewContributions
      totalIssueContributions
      totalRepositoriesWithContributedCommits
    }
  }
}`;

const commitReposQuery = `
query CommitRepos($login: String!) {
  user(login: $login) {
    contributionsCollection {
      commitContributionsByRepository(maxRepositories: 100) {
        contributions { totalCount }
        repository { name nameWithOwner url isPrivate visibility stargazerCount forkCount primaryLanguage { name color } owner { avatarUrl(size: 80) } updatedAt }
      }
    }
  }
}`;

const pullRequestReposQuery = `
query PullRequestRepos($login: String!) {
  user(login: $login) {
    contributionsCollection {
      pullRequestContributionsByRepository(maxRepositories: 100) {
        contributions { totalCount }
        repository { name nameWithOwner url isPrivate visibility stargazerCount forkCount primaryLanguage { name color } owner { avatarUrl(size: 80) } updatedAt }
      }
    }
  }
}`;

const ownedReposQuery = `
query OwnedRepos($login: String!, $after: String) {
  user(login: $login) {
    repositories(first: 100, after: $after, ownerAffiliations: OWNER, privacy: PUBLIC) {
      nodes { url parent { url } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const profile = await graphql(profileQuery, { login });
const totals = await graphql(contributionTotalsQuery, { login });
const calendar = await graphql(contributionCalendarQuery, { login, from: from60, to });
const window = await graphql(contributionWindowQuery, { login, from: from30, to });
const commitRepos = await graphql(commitReposQuery, { login });
const pullRequestRepos = await graphql(pullRequestReposQuery, { login });
const retainedRepoUrls = await fetchRetainedRepoUrls();

const user = profile.user && {
  ...profile.user,
  contributionsCollection: {
    ...totals.user?.contributionsCollection,
    commitContributionsByRepository: commitRepos.user?.contributionsCollection.commitContributionsByRepository ?? [],
    pullRequestContributionsByRepository:
      pullRequestRepos.user?.contributionsCollection.pullRequestContributionsByRepository ?? [],
  },
  recentContributions: calendar.user?.recentContributions,
  last30Contributions: window.user?.last30Contributions,
};

async function graphql(query, variables) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "jatmn-profile-metrics",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }

  return payload.data;
}
if (!user) {
  throw new Error(`GitHub user not found: ${login}`);
}

const dailyActivity = await fetchDailyActivity(
  extractDailyContributions(user.recentContributions.contributionCalendar, 60),
);

const metrics = {
  login: user.login,
  name: user.name,
  location: user.location,
  websiteUrl: user.websiteUrl,
  followers: user.followers.totalCount,
  following: user.following.totalCount,
  publicRepos: user.repositories.totalCount,
  updatedAt: new Date().toISOString(),
  privacy: {
    contributionTotalsMayIncludePrivateActivity: true,
    repositoryDetailsArePublicOnly: true,
  },
  contributions: {
    totalCommitContributions: user.contributionsCollection.totalCommitContributions,
    totalPullRequestContributions: user.contributionsCollection.totalPullRequestContributions,
    totalPullRequestReviewContributions:
      user.contributionsCollection.totalPullRequestReviewContributions,
    totalIssueContributions: user.contributionsCollection.totalIssueContributions,
    totalRepositoriesWithContributedCommits:
      user.contributionsCollection.totalRepositoriesWithContributedCommits,
  },
  contributionWindows: {
    last30Days: {
      totalCommitContributions: user.last30Contributions.totalCommitContributions,
      totalPullRequestContributions: user.last30Contributions.totalPullRequestContributions,
      totalPullRequestReviewContributions:
        user.last30Contributions.totalPullRequestReviewContributions,
      totalIssueContributions: user.last30Contributions.totalIssueContributions,
      totalRepositoriesWithContributedCommits:
        user.last30Contributions.totalRepositoriesWithContributedCommits,
    },
  },
  contributionTrends: {
    last60Days: dailyActivity,
    last7Days: dailyActivity.slice(-7),
  },
  recentPublicRepos: buildRecentPublicRepos(user.contributionsCollection, retainedRepoUrls),
};

const avatarImages = new Map(await Promise.all(
  metrics.recentPublicRepos.slice(0, 20).map(async (repo) => [repo.url, await fetchAvatar(repo.ownerAvatarUrl)]),
));

await mkdir(outDir, { recursive: true });
await writeFile(new URL("profile-metrics.json", outDir), `${JSON.stringify(metrics, null, 2)}\n`);
await writeFile(new URL("profile-metrics.svg", outDir), renderSvg(metrics, avatarImages));

async function fetchRetainedRepoUrls() {
  const urls = new Set();
  let after = null;
  let page;
  do {
    const data = await graphql(ownedReposQuery, { login, after });
    page = data.user.repositories;
    for (const repo of page.nodes) {
      urls.add(repo.url);
      // Contribution history targets the upstream even after a fork is deleted.
      if (repo.parent) urls.add(repo.parent.url);
    }
    after = page.pageInfo.endCursor;
  } while (page.pageInfo.hasNextPage);
  return urls;
}

async function fetchDailyActivity(days) {
  const result = [];
  // Scalar daily totals avoid pagination or inferring categories from calendar totals.
  // GitHub deduplicates reviewed PRs per query window; daily reviews are not additive
  // with the 30-day/year summary counts.
  for (let offset = 0; offset < days.length; offset += 10) {
    const batch = days.slice(offset, offset + 10);
    const fields = batch.map((day, index) => {
      const from = `${day.date}T00:00:00.000Z`;
      const end = `${day.date}T23:59:59.999Z`;
      const until = end < to ? end : to;
      return `day${index}: contributionsCollection(from: ${JSON.stringify(from)}, to: ${JSON.stringify(until)}) {
        totalCommitContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
      }`;
    }).join("\n");
    const data = await graphql(`query DailyActivity($login: String!) {
      user(login: $login) { ${fields} }
    }`, { login });
    result.push(...batch.map((day, index) => {
      const totals = data.user[`day${index}`];
      return {
        ...day,
        commits: totals.totalCommitContributions,
        pullRequests: totals.totalPullRequestContributions,
        reviews: totals.totalPullRequestReviewContributions,
      };
    }));
  }
  return result;
}

async function fetchAvatar(url) {
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const type = response.headers.get("content-type")?.split(";")[0];
    if (!response.ok || !["image/png", "image/jpeg", "image/webp"].includes(type)) {
      throw new Error("Avatar unavailable or unsupported image type");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    console.warn("A repository owner avatar could not be loaded; using initials.");
    return null;
  }
}

function renderSvg(data, avatarImages = new Map()) {
  const c = data.contributions;
  const c30 = data.contributionWindows.last30Days;
  const cards = [
    ["Commits", c30.totalCommitContributions, c.totalCommitContributions, "sky"],
    ["Pull requests opened", c30.totalPullRequestContributions, c.totalPullRequestContributions, "blue"],
    ["PRs reviewed", c30.totalPullRequestReviewContributions, c.totalPullRequestReviewContributions, "orange"],
  ];
  const cardMarkup = cards
    .map(([label, recent, yearly, color], index) => `
    <g transform="translate(${28 + index * 266} 94)">
      <rect class="card" width="252" height="132" rx="14"/>
      <circle class="${color}" cx="20" cy="25" r="4"/>
      <text class="muted" x="32" y="30" font-size="15">${escapeXml(label)}</text>
      <text class="fg" x="20" y="82" font-size="40" font-weight="700">${formatNumber(recent)}</text>
      <text class="muted" x="20" y="111" font-size="13">${formatNumber(yearly)} in the past year</text>
    </g>`)
    .join("");
  const charts = [
    ["The last 60 days", data.contributionTrends.last60Days, 250, "range"],
    ["The last 7 days", data.contributionTrends.last7Days, 448, "daily"],
  ].map(([title, days, y, labelMode], index) => renderLineChart({
    title,
    days,
    x: 28,
    y,
    width: 784,
    height: 178,
    labelMode,
    showContext: index === 0,
  })).join("");
  const repos = data.recentPublicRepos.slice(0, 20);
  const footerHeight = Math.max(Math.ceil(repos.length / 2), 1) * 80;
  const height = 772 + footerHeight;
  const repoMarkup = repos.length
    ? repos.map((repo, index) => {
      const name = repo.nameWithOwner ?? repo.name;
      const label = name.length > 36 ? `${name.slice(0, 33)}…` : name;
      const avatar = avatarImages.get(repo.url);
      const initials = (name.split("/")[0].slice(0, 2)).toUpperCase();
      const detail = `${formatNumber(repo.contributionCounts.commits)} commits · ${formatNumber(repo.contributionCounts.pullRequests)} PRs`;
      return `<g transform="translate(${28 + (index % 2) * 400} ${686 + Math.floor(index / 2) * 80})">
        <rect class="card" width="384" height="68" rx="10"/>
        <svg x="10" y="14" width="40" height="40" viewBox="0 0 40 40">
          <rect class="blue" width="40" height="40" rx="8"/>
          ${avatar ? `<image href="${escapeXml(avatar)}" width="40" height="40"><title>${escapeXml(name.split("/")[0])} GitHub avatar</title></image>` : `<text fill="#ffffff" x="20" y="26" text-anchor="middle" font-size="16">${escapeXml(initials)}</text>`}
        </svg>
        <text class="fg" x="64" y="22" font-size="14" font-weight="600"><title>${escapeXml(name)}</title>${escapeXml(label)}</text>
        <text class="muted" x="64" y="40" font-size="12">${escapeXml(repo.primaryLanguage?.name ?? "Mixed")}</text>
        <text class="muted" x="64" y="57" font-size="12">${escapeXml(detail)}</text>
      </g>`;
    }).join("\n")
    : '<text class="muted" x="28" y="694" font-size="14">No recent public repositories to show.</text>';

  return `<svg width="840" height="${height}" viewBox="0 0 840 ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">JATMN — building, contributing, reviewing</title>
  <desc id="desc">Last 30 days: ${formatNumber(c30.totalCommitContributions)} commits, ${formatNumber(c30.totalPullRequestContributions)} pull requests opened, and ${formatNumber(c30.totalPullRequestReviewContributions)} distinct PRs reviewed. Past-year totals appear below each figure. Both charts show separate daily commit, opened pull request, and reviewed-PR counts. Reviews count distinct PRs in each daily or summary window. Only public repository names are shown.</desc>
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; }
    .canvas { fill: #B9E2FC; }
    .frame { stroke: #87BADA; }
    .card { fill: #E7F5FF; stroke: #87BADA; }
    .fg { fill: #153F66; }
    .muted { fill: #365C78; }
    .sky { fill: #2076AD; }
    .blue { fill: #153F66; }
    .orange { fill: #FFC18F; }
    .rule { stroke: #87BADA; }
    .line-sky { stroke: #267CB2; }
    .line-blue { stroke: #153F66; }
    .line-orange { stroke: #FFC18F; }
  </style>
  <rect class="canvas" x=".5" y=".5" width="839" height="${height - 1}" rx="16"/>
  <rect class="frame" x=".5" y=".5" width="839" height="${height - 1}" rx="16"/>
  <text class="fg" x="28" y="40" font-size="24" font-weight="700">Building. Contributing. Reviewing.</text>
  <text class="muted" x="28" y="68" font-size="14">LAST 30 DAYS</text>
  <text class="muted" x="812" y="68" text-anchor="end" font-size="14">${formatNumber(c30.totalRepositoriesWithContributedCommits)} repos with commits</text>
  ${cardMarkup}
  ${charts}
  <line class="rule" x1="28" y1="648" x2="812" y2="648"/>
  <text class="fg" x="28" y="671" font-size="14" font-weight="600">RECENT PUBLIC WORK</text>
  <text class="muted" x="812" y="671" text-anchor="end" font-size="13">Contributions in the past year</text>
  ${repoMarkup}
  <text class="muted" x="28" y="${height - 62}" font-size="12">Updated ${escapeXml(formatDate(data.updatedAt))} · GitHub contribution counts</text>
  <text class="muted" x="28" y="${height - 40}" font-size="12">Totals may include private activity; repository names are public only.</text>
  <text class="muted" x="28" y="${height - 20}" font-size="12">Reviews count distinct PRs per day; summaries deduplicate across the period.</text>
</svg>
`;
}

function renderLineChart({ title, days, x, y, width, height, labelMode, showContext = true }) {
  const series = [
    { key: "commits", label: "Commits", color: "sky", dash: "" },
    { key: "pullRequests", label: "PRs opened", color: "blue", dash: "7 4" },
    { key: "reviews", label: "PRs reviewed", color: "orange", dash: "2 4" },
  ];
  const plotX = 42;
  const plotY = showContext ? 62 : 36;
  const plotWidth = width - 58;
  const plotHeight = height - plotY - 30;
  const max = Math.ceil(Math.max(2, ...days.flatMap((day) => series.map(({ key }) => day[key]))) / 2) * 2;
  const yTicks = [max, max / 2, 0].map((value) => {
    const tickY = plotY + plotHeight - (value / max) * plotHeight;
    return `<line class="rule" x1="${plotX}" y1="${round(tickY)}" x2="${plotX + plotWidth}" y2="${round(tickY)}"/>
      <text class="muted" x="${plotX - 8}" y="${round(tickY + 4)}" text-anchor="end" font-size="12">${formatNumber(value)}</text>`;
  }).join("");
  const lines = series.map(({ key, color, dash }) => {
    const points = days.map((day, index) => {
      const px = plotX + (index / Math.max(days.length - 1, 1)) * plotWidth;
      const py = plotY + plotHeight - (day[key] / max) * plotHeight;
      return `${round(px)},${round(py)}`;
    }).join(" ");
    return `<polyline class="line-${color}" points="${points}" fill="none" stroke-width="2.5" stroke-dasharray="${dash}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join("");
  const legend = series.map(({ label, color, dash }, index) => {
    const lx = index * 260;
    return `<line class="line-${color}" x1="${lx}" y1="39" x2="${lx + 26}" y2="39" stroke-width="3" stroke-dasharray="${dash}"/>
      <text class="muted" x="${lx + 34}" y="43" font-size="13">${label}</text>`;
  }).join("");
  const xLabels = buildDateLabels(days, labelMode).map(({ label, index }) => {
    const labelX = plotX + (index / Math.max(days.length - 1, 1)) * plotWidth;
    return `<text class="muted" x="${round(labelX)}" y="${plotY + plotHeight + 22}" text-anchor="middle" font-size="12">${escapeXml(label)}</text>`;
  }).join("");
  return `<g transform="translate(${x} ${y})">
    <text class="fg" x="0" y="18" font-size="17" font-weight="600">${escapeXml(title)}</text>
    ${showContext ? `<text class="muted" x="${width}" y="18" text-anchor="end" font-size="13">Daily GitHub contributions</text>${legend}` : ""}
    ${yTicks}
    ${lines}
    ${xLabels}
  </g>`;
}

function buildDateLabels(days, mode) {
  if (!days.length) {
    return [];
  }

  if (mode === "daily") {
    return days.map((day, index) => ({
      index,
      label: formatShortDate(day.date),
    }));
  }

  const middle = Math.floor((days.length - 1) / 2);
  return [0, middle, days.length - 1].map((index) => ({
    index,
    label: formatShortDate(days[index].date),
  }));
}

function extractDailyContributions(calendar, count) {
  const days = calendar.weeks
    .flatMap((week) => week.contributionDays)
    .map((day) => ({
      date: day.date,
      count: day.contributionCount,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return days.slice(-count);
}

function buildRecentPublicRepos(contributions, retainedRepoUrls) {
  const byUrl = new Map();
  addContributionRepos(byUrl, contributions.commitContributionsByRepository, "commits");
  addContributionRepos(byUrl, contributions.pullRequestContributionsByRepository, "pullRequests");

  return [...byUrl.values()]
    .filter((repo) => retainedRepoUrls.has(repo.url))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, 20)
    .map(({ contributionCounts, ...repo }) => ({
      ...repo,
      contributionCounts,
    }));
}

function addContributionRepos(byUrl, repoContributions, key) {
  for (const item of repoContributions) {
    const repo = item.repository;
    if (!repo || repo.visibility !== "PUBLIC" || repo.isPrivate
      || repo.nameWithOwner?.toLowerCase() === `${login}/${login}`.toLowerCase()
      || item.contributions.totalCount <= 0) {
      continue;
    }

    const current = byUrl.get(repo.url) ?? {
      name: repo.name,
      nameWithOwner: repo.nameWithOwner,
      url: repo.url,
      ownerAvatarUrl: repo.owner?.avatarUrl ?? null,
      stargazerCount: repo.stargazerCount,
      forkCount: repo.forkCount,
      primaryLanguage: repo.primaryLanguage
        ? {
            name: repo.primaryLanguage.name,
            color: repo.primaryLanguage.color,
          }
        : null,
      updatedAt: repo.updatedAt,
      contributionCounts: {
        commits: 0,
        pullRequests: 0,
      },
    };

    current.contributionCounts[key] += item.contributions.totalCount;
    if (new Date(repo.updatedAt) > new Date(current.updatedAt)) {
      current.updatedAt = repo.updatedAt;
    }
    byUrl.set(repo.url, current);
  }
}

function daysAgo(days) {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  }).format(new Date(value));
}

function formatShortDate(value) {
  return new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
