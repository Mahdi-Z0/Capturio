# Project Config

**Project:** Capturio (created as ScreenRecorder; renamed 2026-09-25)
**Created:** 2026-09-16

## Project Settings

```yaml
project:
  name: Capturio
  version: 0.1.0
```

## Integrations

### SonarQube

```yaml
sonarqube:
  enabled: true
  project_key: capturio
```

> **Not yet operational.** This flag is on, but SonarQube needs two things that are not installed:
> a reachable SonarQube server (local Docker or SonarCloud) and the SonarQube MCP server registered
> in Claude Code. Until both exist, quality-gate steps that call SonarQube will no-op or error.
> See the setup notes at the bottom of this file.

### Enterprise Plan Audit

```yaml
enterprise_plan_audit:
  enabled: true
```

> Adds an architectural review step between PLAN and APPLY via `/paul:audit`. This is a heavier
> gate than a solo personal project usually needs — disable it in this file if it slows you down.

## Preferences

```yaml
preferences:
  auto_commit: false
  verbose_output: false
```

## SonarQube setup notes

To make the flag above real:

1. Run a server — SonarCloud (hosted, free for public projects) or local:
   `docker run -d --name sonarqube -p 9000:9000 sonarqube:lts-community`
2. Create a project with key `capturio` and generate a user token.
3. Register the SonarQube MCP server in Claude Code so `/paul:audit` can query it.
4. Add `sonar-project.properties` to the repo root pointing at `src/`.

Until step 3 is done, set `enabled: false` here to avoid failed audit steps.

---

_Config created: 2026-09-16 — renamed to Capturio 2026-09-27_
