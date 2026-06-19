-- Asides deleted (docs/decisions/geometry-first-regions.md): the placeless intro/outro framing +
-- clock-beat library — the ONLY content type with no coordinates, and so the only thing that ever
-- wanted a region FK — is removed from v2 (returns in v3 with guided tours). A drive's between-story
-- texture is now the already-defined PLACED forms: `break` (pitstops) + `scenic` (overlooks). The
-- table starts EMPTY in v2 core, so this drops no live content.
DROP TABLE "asides" CASCADE;
