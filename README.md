# LikeToOrder

Map-first food discovery: restaurants and home cooks as country-flag markers, pickup and table requests, and a personal food-photo activity grid.

**Stack:** Expo · React Native · TypeScript · Supabase

| Read this | For |
|---|---|
| `docs/workflow.md` | How we work (start here) |
| `docs/product/v1.md` | What v1 does |
| `CLAUDE.md` | Rules for Claude + feature status |
| `.claude/specs/` | One spec per feature |

## Getting started

Needs Node 22 (`.nvmrc`) and Docker Desktop (for local Supabase).

```bash
nvm use
npm install
npx supabase start            # prints the local API URL and anon key
cp .env.example .env          # fill in EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
npx expo start                # press i / a for a simulator
```

Quality checks: `npm run lint` · `npm run typecheck` · `npm test` · `npx supabase test db`.
After a migration: `npm run db:types`.
