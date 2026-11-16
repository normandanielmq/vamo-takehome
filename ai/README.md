# AI guidance

All agent instructions and NestJS skills for this repository live in this folder. There is a single copy of each file — nowhere else.

| Path | Role |
| --- | --- |
| `ai/AGENTS.md` | Shared agent rules (Cursor, Codex, and other AGENTS-aware harnesses) |
| `ai/CLAUDE.md` | Claude Code engineering rules |
| `ai/skills/` | NestJS Agent Skills |

Root `AGENTS.md` and `CLAUDE.md` are short pointers into this folder so harnesses that look at the repo root can find the rules.

## Source

NestJS skills are vendored from [amirtaherkhani/nestjs-skills](https://github.com/amirtaherkhani/nestjs-skills) (MIT). See `ai/skills/LICENSE-nestjs-skills`.
