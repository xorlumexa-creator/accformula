
## Lumexa Platform Rebuild Plan

This is a major rebuild covering branding, database, onboarding, dashboard, and 6+ new pages. Here's the phased approach:

---

### Phase 1 — Rebrand + Database Schema
- Rename "Dynaxor" back to "Lumexa" across all files
- New database tables: `user_profiles_extended` (DOB, country, occupation, experience_level, cad_software, purpose), `project_parts` (body parts list per project), `project_electronics` (electronics list per project), `project_tasks` (weekly task schedule), `user_streaks` (daily streak tracking)
- Update `projects` table with new fields (environment, power_source, control_method, microcontroller, has_3d_printer, target_weight, target_size, budget_currency)

### Phase 2 — Onboarding Redesign (3 pages)
- Page 1: Name, DOB, Country, Occupation
- Page 2: Experience level, Purpose of using Lumexa
- Page 3: CAD software preference
- All stored in extended profile, used to personalize AI responses

### Phase 3 — Dashboard + Project Plan Generator
- Dashboard: Welcome header with streak, active project card, weekly task schedule, quick nav
- First-login behavior with "Create Project" prompt
- Project Plan page: 3-step project creation form → Gemini generates parts list + electronics list
- Parts & Materials page with two tabs, budget tracker

### Phase 4 — Design Guide + CAD Analysis Upgrade
- Design Guide page: Step-by-step CAD guide per part, context-aware chatbot, fix guide after analysis
- CAD Analysis: Part selector dropdown from project, context-aware AI filtering (don't flag intentional features), brief summary cards instead of full report, fix guide generation

### Phase 5 — Code Section + IC Integration + Pricing
- Code Section: Platform selection, module-by-module code guide, test verification
- IC & Wire page: 6 screenshot upload, AI-generated wiring diagram
- Pricing page with 3 tiers (Basic $20, Pro $40, Elite $80)

---

### What stays the same
- Telemetry page (as-is)
- AI Coach/Chat (as-is, with context awareness)
- Black and red theme
- Hamburger navigation

### AI Model
- Gemini 3 Flash for all AI features (via Lovable AI gateway)

**Shall I proceed with Phase 1 (rebrand + database)?**
