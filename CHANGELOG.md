# Changelog

All notable changes to this repo. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]
### Added
- 2026-11-16: Phase 2 of the TypeTorch dashboard, every remaining web explorer page native: Roblox overview (benchmark
  cards, benchmarks kept on the phone, realtime, acquisition from Roblox, 7-day trends per join source), Retention,
  Funnels (compare, players who reached or dropped off at a step), Players (search by pid or UserId, server-side order,
  funnel progress, identity backfill) with a player page (profile, funnels, spending, playtime, sessions, timeline with
  the node graph as lists, errors), Flow, Experiments (variants, how sure, weights, players), First session, Events,
  Server history plus the server page's offline history (timeline, debug bundles with a bundle screen, whole-life
  charts), Performance (percentiles by group, chart steps, deploy marks, vs previous period, live servers, builds and
  before-vs-after compare), Economy, Monetization (day and product buyers, top buyers, latest purchases), Query (named
  queries, read-only SQL, saved queries), and for owners Audit log and Backend stats. A shared filter bar (range,
  branch, artifact, device, new / returning, variant) per backend; line charts take dashed series and deploy marks, bar
  charts a tap.
- 2026-11-16: The app (Expo SDK 58, expo-router, TypeScript strict, Expo Go compatible; `eas.json` preview = APK).
  Projects home from the Open Cloud key's universes + the user's and their groups' experiences; per-experience
  Overview, Creator Hub analytics (Analytics Query API, react-native-svg charts), Open Cloud tools (data stores with
  revisions / edit / delete, ordered data stores, memory stores, messaging, restart servers, bans, passes / products /
  badges); TypeTorch backends (browser PKCE sign-in or admin token -> device token, refresh, sessions list / revoke)
  with a native dashboard: Overview, Fleet (5 s polling), server detail, deploys + detail (alert ack), errors + detail,
  settings. Key and tokens in expo-secure-store; no telemetry. Phase-2 pages listed in README TODO.
- 2026-10-04: Repo folder created. Design in `../plans/07-web-mobile.md`.
