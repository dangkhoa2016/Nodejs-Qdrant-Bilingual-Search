# Data licensing and provenance
> 🌐 Language / Ngôn ngữ: **English** | [Tiếng Việt](LICENSE-DATA.vi.md)

Application code and generated data have separate licensing concerns. Every normalized entity keeps source provenance through `source`, `sourceId`, and `sourceRefs`.

## GeoNames

GeoNames is the canonical geographic backbone. GeoNames publishes its gazetteer under **Creative Commons Attribution 4.0 (CC BY 4.0)**.

The project uses `cities15000.zip`, `countryInfo.txt`, `admin1CodesASCII.txt`, and `alternateNamesV2.zip`. Public releases or hosted demonstrations that redistribute or expose derived GeoNames data must retain appropriate GeoNames attribution and a reference to CC BY 4.0.

## Who's On First

Who's On First is optional multilingual enrichment. WOF documentation states that crediting Who's On First is recommended and linking back to the **Who's On First License** is required. WOF is both an original work and a modification/aggregation of multiple open-data sources, and some component sources require their own attribution.

Public redistribution of WOF-derived names/aliases should therefore include:

- a “Data from Who's On First” credit;
- a link/reference to the Who's On First License;
- the relevant WOF sources/attribution information for the distributed data snapshot.

The build manifest records WOF archive URLs and SHA-256 values so the exact downloaded enrichment snapshot can be identified.

## Machine-generated Vietnamese

Machine translation is optional generated enrichment. It is never presented as native GeoNames or WOF data. Generated fields are marked `machine_translation` and retain provider/model/prompt/language/source-hash/version metadata.

Cloud credentials and API-key slot names are never embedded into dataset provenance.

## Reproducibility

Public sources evolve. For strict benchmark/release reproducibility, archive the generated dataset plus the GeoNames inputs and cached WOF archives used for that release. The WOF archive SHA-256 values are emitted in the dataset manifest.
