# Public dataset pipeline

The public build uses **GeoNames `cities15000` as the canonical geographic backbone** and **Who's On First (WOF) as optional multilingual enrichment**. Wikidata is not part of the public ingestion path.

## GeoNames backbone

GeoNames provides the canonical application identity and geographic facts. GeoNames publishes the gazetteer under **CC BY 4.0**. City IDs remain:

```text
geonames:city:<geonameid>
geonames:country:<geonameid>
```

The builder reads `cities15000.zip`, `countryInfo.txt`, `admin1CodesASCII.txt`, then streams `alternateNamesV2.zip` only for entities that survive deterministic representative selection. Explicit `en`/`vi` alternate names can replace the untagged GeoNames fallback name. Vietnamese-tagged alternate names retain the narrow legacy normalization `Ð/ð → Đ/đ`.

GeoNames is fail-fast for malformed UTF-8, replacement characters, invalid row shape, invalid coordinates and invalid IDs. Geographic QA still rejects a large city dataset that loses North or South America.

## Who's On First enrichment

WOF is a **best-effort enrichment source**, never the canonical geography source. The current downloads are the global locality and country GeoJSON `tar.bz2` archives published by Geocode Earth.

WOF is joined only by the single primary GeoNames concordance `wof:concordances["gn:id"]`. Alternate concordances and imported `gn:geonameid` fields are never canonical identities, and records with multiple primary GeoNames IDs are quarantined. There is no fuzzy name matching. The accepted placetypes are:

- canonical `city` → WOF `locality`;
- canonical `country` → WOF `country` or `dependency`.

English precedence is WOF preferred name > explicit GeoNames English > GeoNames fallback. Vietnamese precedence is explicit GeoNames Vietnamese > WOF preferred Vietnamese > missing. A WOF `vie` name/alias containing legacy `Ð/ð` is discarded rather than rewritten, and non-selected primary names are retained as aliases. WOF contributes only language/identity metadata (`wofId`, placetype, names, aliases, `sourceRefs`); GeoNames continues to own population, coordinates, country/admin data and timezone.

If multiple WOF records claim the same GeoNames ID, or one WOF ID claims multiple GeoNames entities, that identity is quarantined: the GeoNames record is preserved and WOF enrichment is skipped for that record. The archive path is bounded-memory: `bzip2` emits the TAR stream, the reader frames one GeoJSON entry at a time, decodes only its `properties` object, rejects unrelated GeoNames concordances before `JSON.parse`, and releases the raw entry before moving on. Geometry is never retained in enrichment candidates. Malformed relevant WOF records are counted and skipped. If one WOF archive is unavailable, the build continues with GeoNames and records `partial`/`unavailable` status in the manifest.

## Cache and reproducibility

WOF archives are cached under `data/cache/wof` by default. Downloads are written atomically and SHA-256 is recorded in `manifest.wofEnrichment.archives`. Re-running without `--wof-refresh` reuses the cached archive.

```bash
npm run dataset:build -- \
  --sources geonames,wof \
  --types country,city \
  --limit 20000
```

Use a custom cache or force a fresh upstream snapshot:

```bash
npm run dataset:build -- \
  --wof-cache-dir /path/to/wof-cache \
  --wof-refresh \
  --limit 20000
```

GeoNames-only baseline remains available:

```bash
npm run dataset:build -- --sources geonames --types city --limit 20000
```

## Manifest v6

The manifest records source counts, selected count, geographic/language coverage, GeoNames dataset name and WOF enrichment diagnostics. `wofEnrichment` contains status, requested/matched/ambiguous/invalid counts, `scanned` and `skippedUnmatched` archive counters, per-type status, archive URL/file/SHA-256 and bounded ambiguity samples. During a real scan, periodic stderr progress includes scanned records, matched target IDs, skipped/invalid counts, heap, RSS and elapsed time.

`dataQuality.policy` is `geonames_fail_fast_wof_best_effort`: canonical GeoNames quality errors remain fatal while optional WOF problems do not destroy an otherwise valid dataset. `dataQuality.checks` records final-output invariants for duplicate canonical IDs, duplicate source references, and remaining Vietnamese legacy `Ð/ð` text; acceptance requires all three counters to be zero.

## Translation

Machine translation remains a separate optional stage. Missing Vietnamese is valid. Native GeoNames or WOF Vietnamese is never overwritten. Generated values are marked `machine_translation` with provider/model/prompt/source-hash/version provenance.
