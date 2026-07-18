import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const login = process.env.GITHUB_LOGIN || "jatmn";
const tokens = [process.env.PROFILE_TOKEN, process.env.GITHUB_TOKEN, process.env.GH_TOKEN].filter(Boolean);
const outDir = new URL("../assets/", import.meta.url);
const now = new Date();
const from60 = startOfUtcDay(daysAgo(59));
const from30 = startOfUtcDay(daysAgo(29));
const to = now.toISOString();

if (!tokens.length) {
  console.error("Set PROFILE_TOKEN, GITHUB_TOKEN, or GH_TOKEN before running the profile metrics updater.");
  process.exit(1);
}

const query = `
query ProfileMetrics($login: String!, $from60: DateTime!, $from30: DateTime!, $to: DateTime!) {
  user(login: $login) {
    login
    name
    location
    websiteUrl
    followers { totalCount }
    following { totalCount }
    repositories(ownerAffiliations: OWNER, privacy: PUBLIC) {
      totalCount
    }
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalPullRequestReviewContributions
      totalIssueContributions
      totalRepositoriesWithContributedCommits
      commitContributionsByRepository(maxRepositories: 6) {
        contributions { totalCount }
        repository {
          name
          nameWithOwner
          url
          isPrivate
          stargazerCount
          forkCount
          primaryLanguage { name color }
          updatedAt
        }
      }
      pullRequestContributionsByRepository(maxRepositories: 6) {
        contributions { totalCount }
        repository {
          name
          nameWithOwner
          url
          isPrivate
          stargazerCount
          forkCount
          primaryLanguage { name color }
          updatedAt
        }
      }
    }
    recentContributions: contributionsCollection(from: $from60, to: $to) {
      contributionCalendar {
        weeks {
          contributionDays {
            date
            contributionCount
          }
        }
      }
    }
    last30Contributions: contributionsCollection(from: $from30, to: $to) {
      totalCommitContributions
      totalPullRequestContributions
      totalPullRequestReviewContributions
      totalIssueContributions
      totalRepositoriesWithContributedCommits
    }
  }
}`;

const { payload, contributionTotalsMayIncludePrivateActivity } = await fetchProfileMetrics(tokens);

const user = payload.data.user;
if (!user) {
  throw new Error(`GitHub user not found: ${login}`);
}

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
    contributionTotalsMayIncludePrivateActivity,
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
    last60Days: extractDailyContributions(user.recentContributions.contributionCalendar, 60),
    last7Days: extractDailyContributions(user.recentContributions.contributionCalendar, 7),
  },
  recentPublicRepos: buildRecentPublicRepos(user.contributionsCollection),
};

await mkdir(outDir, { recursive: true });
await writeFile(new URL("profile-metrics.json", outDir), `${JSON.stringify(metrics, null, 2)}\n`);
await writeFile(new URL("profile-metrics.svg", outDir), renderSvg(metrics));

async function fetchProfileMetrics(candidateTokens) {
  let lastFailure;

  for (const [index, token] of candidateTokens.entries()) {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "jatmn-profile-metrics",
      },
      body: JSON.stringify({ query, variables: { login, from60, from30, to } }),
    });

    if (!response.ok) {
      lastFailure = `GitHub GraphQL request failed: ${response.status} ${response.statusText}`;
      if (index < candidateTokens.length - 1 && isFallbackEligibleFailure(response.status)) {
        continue;
      }
      throw new Error(lastFailure);
    }

    const payload = await response.json();
    if (!payload.errors?.length) {
      return {
        payload,
        contributionTotalsMayIncludePrivateActivity: token === process.env.PROFILE_TOKEN,
      };
    }

    lastFailure = payload.errors.map((error) => error.message).join("; ");
    if (index < candidateTokens.length - 1 && isFallbackEligibleFailure(lastFailure)) {
      continue;
    }
    throw new Error(lastFailure);
  }

  throw new Error(lastFailure ?? "GitHub GraphQL request failed without a response.");
}

function isFallbackEligibleFailure(statusOrMessage) {
  return (
    statusOrMessage === 401 ||
    statusOrMessage === 403 ||
    /bad credentials|resource not accessible by (integration|personal access token)|resource limits for this query exceeded|rate limit/i.test(String(statusOrMessage))
  );
}
function renderSvg(data) {
  const c = data.contributions;
  const c30 = data.contributionWindows.last30Days;
  const last60Total = sumContributions(data.contributionTrends.last60Days);
  const last7Total = sumContributions(data.contributionTrends.last7Days);
  const repoLine = data.recentPublicRepos
    .slice(0, 3)
    .map((repo) => {
      const language = repo.primaryLanguage?.name ?? "Mixed";
      return `${repo.nameWithOwner ?? repo.name} (${language})`;
    })
    .join(" · ");

  const cards = [
    ["commits", c.totalCommitContributions, c30.totalCommitContributions],
    ["prs opened", c.totalPullRequestContributions, c30.totalPullRequestContributions],
    ["pr reviews", c.totalPullRequestReviewContributions, c30.totalPullRequestReviewContributions],
    [
      "repos contributed",
      c.totalRepositoriesWithContributedCommits,
      c30.totalRepositoriesWithContributedCommits,
    ],
  ];

  const cardMarkup = cards
    .map(([label, value, recentValue], index) => {
      const x = index % 2 === 0 ? 24 : 300;
      const y = index < 2 ? 88 : 158;
      return `
        <g transform="translate(${x} ${y})">
          <rect class="stat-shell" width="252" height="58" rx="6"/>
          <rect class="stat-label-band" x="1" y="1" width="151" height="26" rx="5"/>
          <path class="stat-label-band" d="M146 1H152V27H146Z"/>
          <rect class="stat-value-band" x="152" y="1" width="99" height="26" rx="5"/>
          <path class="stat-value-band" d="M152 1H158V27H152Z"/>
          <text class="muted" x="16" y="18" font-size="12" font-weight="600">${escapeXml(label)}</text>
          <text class="stat-value-text" x="236" y="19" text-anchor="end" font-size="13" font-weight="700">${formatNumber(value)}</text>
          <line class="rule" x1="1" y1="32" x2="251" y2="32"/>
          <text class="muted" x="16" y="48" font-size="11">last 30 days</text>
          <text class="fg" x="236" y="49" text-anchor="end" font-size="12" font-weight="600">${formatNumber(recentValue)}</text>
        </g>`;
    })
    .join("");
  const chartMarkup = [
    renderLineChart({
      title: "Daily contributions, last 60 days",
      total: last60Total,
      days: data.contributionTrends.last60Days,
      x: 24,
      y: 240,
      width: 528,
      height: 152,
      labelMode: "range",
    }),
    renderLineChart({
      title: "Daily contributions, last 7 days",
      total: last7Total,
      days: data.contributionTrends.last7Days,
      x: 24,
      y: 416,
      width: 528,
      height: 152,
      labelMode: "daily",
    }),
  ].join("");

  return `<svg width="576" height="690" viewBox="0 0 576 690" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">JATMN GitHub activity metrics</title>
  <desc id="desc">Current GitHub contribution totals and daily contribution line charts. Repository names shown are public-only.</desc>
  <style>
    text { font-family: Arial, sans-serif; }
    .canvas { fill: #ffffff; }
    .frame { fill: none; stroke: #d0d7de; }
    .chart-card { fill: #ffffff; stroke: #d0d7de; }
    .subtle-card { fill: #f6f8fa; stroke: #d0d7de; }
    .stat-shell { fill: #ffffff; stroke: #d0d7de; }
    .stat-label-band { fill: #f6f8fa; }
    .stat-value-band { fill: #ddf4ff; }
    .stat-value-text { fill: #0969da; }
    .fg { fill: #24292f; }
    .muted { fill: #57606a; }
    .rule { stroke: #d8dee4; }
    .chart-area { fill: #ddf4ff; }
    .chart-line { stroke: #0969da; }
    @media (prefers-color-scheme: dark) {
      .canvas { fill: #0d1117; }
      .frame { stroke: #30363d; }
      .chart-card { fill: #0d1117; stroke: #30363d; }
      .subtle-card { fill: #161b22; stroke: #30363d; }
      .stat-shell { fill: #0d1117; stroke: #30363d; }
      .stat-label-band { fill: #161b22; }
      .stat-value-band { fill: #0d419d; fill-opacity: 0.24; }
      .stat-value-text { fill: #58a6ff; }
      .fg { fill: #c9d1d9; }
      .muted { fill: #8b949e; }
      .rule { stroke: #30363d; }
      .chart-area { fill: #0d419d; fill-opacity: 0.22; }
      .chart-line { stroke: #58a6ff; }
    }
  </style>
  <rect class="canvas" width="576" height="690" rx="6"/>
  <rect class="frame" x="0.5" y="0.5" width="575" height="689" rx="5.5"/>
  <text class="fg" x="24" y="36" font-size="16" font-weight="600">GitHub activity</text>
  <text class="muted" x="24" y="61" font-size="12">Updated ${escapeXml(formatDate(data.updatedAt))} · public repo details only</text>
  <g transform="translate(433 22)">
    <rect class="subtle-card" width="119" height="28" rx="14"/>
    <text class="muted" x="60" y="19" text-anchor="middle" font-size="12">${formatNumber(data.publicRepos)} public repos</text>
  </g>
  ${cardMarkup}
  ${chartMarkup}
  <line class="rule" x1="24" y1="644" x2="552" y2="644"/>
  <text class="muted" x="24" y="667" font-size="12">Recent public work: ${escapeXml(repoLine)}</text>
</svg>
`;
}

function renderLineChart({ title, total, days, x, y, width, height, labelMode }) {
  const plotX = 42;
  const plotY = 30;
  const plotWidth = width - 58;
  const plotHeight = height - 62;
  const max = Math.max(...days.map((day) => day.count), 1);
  const mid = Math.round(max / 2);
  const points = days
    .map((day, index) => {
      const pointX = plotX + (index / Math.max(days.length - 1, 1)) * plotWidth;
      const pointY = plotY + plotHeight - (day.count / max) * plotHeight;
      return `${round(pointX)},${round(pointY)}`;
    })
    .join(" ");
  const areaPoints = `${plotX},${plotY + plotHeight} ${points} ${plotX + plotWidth},${plotY + plotHeight}`;
  const latest = days.at(-1)?.count ?? 0;
  const yTicks = [
    [max, plotY],
    [mid, plotY + plotHeight / 2],
    [0, plotY + plotHeight],
  ]
    .map(
      ([value, tickY]) => `
    <line class="rule" x1="${plotX}" y1="${round(tickY)}" x2="${plotX + plotWidth}" y2="${round(tickY)}"/>
    <text class="muted" x="${plotX - 8}" y="${round(tickY + 4)}" text-anchor="end" font-size="10">${formatNumber(value)}</text>`,
    )
    .join("");
  const xLabels = buildDateLabels(days, labelMode)
    .map(({ label, index }) => {
      const labelX = plotX + (index / Math.max(days.length - 1, 1)) * plotWidth;
      return `<text class="muted" x="${round(labelX)}" y="${plotY + plotHeight + 22}" text-anchor="middle" font-size="10">${escapeXml(label)}</text>`;
    })
    .join("");

  return `
  <g transform="translate(${x} ${y})">
    <rect class="chart-card" width="${width}" height="${height}" rx="6"/>
    <text class="fg" x="12" y="19" font-size="13" font-weight="600">${escapeXml(title)}</text>
    <text class="muted" x="${width - 12}" y="19" text-anchor="end" font-size="12">${formatNumber(total)} total · ${formatNumber(latest)} today</text>
    ${yTicks}
    <polygon class="chart-area" points="${areaPoints}"/>
    <polyline class="chart-line" points="${points}" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
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

function buildRecentPublicRepos(contributions) {
  const byUrl = new Map();
  addContributionRepos(byUrl, contributions.commitContributionsByRepository, "commits");
  addContributionRepos(byUrl, contributions.pullRequestContributionsByRepository, "pullRequests");

  return [...byUrl.values()]
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, 6)
    .map(({ contributionCounts, ...repo }) => ({
      ...repo,
      contributionCounts,
    }));
}

function addContributionRepos(byUrl, repoContributions, key) {
  for (const item of repoContributions) {
    const repo = item.repository;
    if (repo.isPrivate || item.contributions.totalCount <= 0) {
      continue;
    }

    const current = byUrl.get(repo.url) ?? {
      name: repo.name,
      nameWithOwner: repo.nameWithOwner,
      url: repo.url,
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

function sumContributions(days) {
  return days.reduce((total, day) => total + day.count, 0);
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
