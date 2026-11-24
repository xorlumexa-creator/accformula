#!/usr/bin/env bash
# Run once from the accformula-main folder (git repo root). Removes stray / duplicate files; nothing here is referenced by the app.
set -e
git rm --cached .env 2>/dev/null || true        # stop tracking the committed .env; your local copy stays (it is now in .gitignore)
rm -f "supabase/functions/design-generator/Index."
rm -f "src/components/AssemblyScene (2).tsx"
# add_project_assemblies is recorded in the database as 20261103134914; remove the older local copies of it
rm -f "supabase/migrations/20261102120000_add_project_assemblies (1).sql"
rm -f "supabase/migrations/20261102120000_add_project_assemblies.sql"
# first version of the backend-registry migration: wrong for your database (the right one is 20261113003559_...)
rm -f "supabase/migrations/20261113090000_lumexa_backend_registry.sql"
echo "frontend cleanup done"
