# JATMN

<p align="left">
  <a href="https://jat.mn"><img alt="Website" src="https://img.shields.io/badge/JAT.MN-111827?style=for-the-badge&logo=firefoxbrowser&logoColor=white"></a>
  <a href="https://github.com/jatmn"><img alt="GitHub" src="https://img.shields.io/badge/GitHub-jatmn-24292f?style=for-the-badge&logo=github&logoColor=white"></a>
  <a href="https://twitter.com/THEJATMN"><img alt="X / Twitter" src="https://img.shields.io/badge/@THEJATMN-0f1419?style=for-the-badge&logo=x&logoColor=white"></a>
</p>

Builder, reviewer, and open-source tinkerer in SoCal. I spend most of my time around coding agents, provider compatibility, review automation, 3D-printing tooling, and the occasional game or modding side quest.

![JATMN live profile stats](./assets/profile-metrics.svg)

## Current Focus

- Shipping practical coding-agent workflows that survive real repositories.
- Reviewing PRs with an eye for correctness, safety, test coverage, and whether the change is actually worth merging.
- Building and maintaining tools across TypeScript, Rust, C++, Lua, and shell-heavy automation.
- Keeping local-first workflows sharp before turning them into public infrastructure.

## Workbench

<p align="left">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178c6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="Rust" src="https://img.shields.io/badge/Rust-b7410e?style=flat-square&logo=rust&logoColor=white">
  <img alt="C++" src="https://img.shields.io/badge/C++-00599c?style=flat-square&logo=cplusplus&logoColor=white">
  <img alt="Lua" src="https://img.shields.io/badge/Lua-000080?style=flat-square&logo=lua&logoColor=white">
  <img alt="GitHub Actions" src="https://img.shields.io/badge/GitHub_Actions-2088ff?style=flat-square&logo=githubactions&logoColor=white">
</p>

## Recent Public Repos

| Repo | What it is |
| --- | --- |
| [Yuoki-Factorio-2.0](https://github.com/jatmn/Yuoki-Factorio-2.0) | Yuoki-Industries Factorio mod work. |
| [openclaude](https://github.com/jatmn/openclaude) | Open-source coding-agent CLI experiments and compatibility work. |
| [opencode](https://github.com/jatmn/opencode) | Open-source coding agent fork/workspace. |
| [node](https://github.com/jatmn/node) | Decentralized git node with Ed25519 identity and libp2p gossip. |
| [OrcaSlicer](https://github.com/jatmn/OrcaSlicer) | 3D-printing slicer support work. |
| [CuraEngine](https://github.com/jatmn/CuraEngine) | G-code engine work for 3D-printing pipelines. |

## Keeping This Fresh

This profile is designed to be local-first. Run the updater whenever you want current stats:

```bash
GITHUB_TOKEN=... npm run update
```

The included GitHub Actions workflow can refresh `assets/profile-metrics.svg` and `assets/profile-metrics.json` on a schedule after this is pushed to a `jatmn/jatmn` profile repository. Add a `PROFILE_TOKEN` secret if you want aggregate contribution totals to include private activity visible to your account. Repository details are intentionally public-only, so private repo names, URLs, PR titles, and org names are not written to the generated files.
