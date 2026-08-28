# Pipeline public dataset

Public build dùng **GeoNames `cities15000` làm geographic backbone canonical** và **Who's On First (WOF) làm enrichment đa ngôn ngữ tùy chọn**. Wikidata không còn nằm trong public ingestion path.

## GeoNames backbone

GeoNames phát hành gazetteer theo giấy phép **CC BY 4.0**.

GeoNames sở hữu canonical identity và geography facts. ID giữ nguyên:

```text
geonames:city:<geonameid>
geonames:country:<geonameid>
```

Builder đọc `cities15000.zip`, `countryInfo.txt`, `admin1CodesASCII.txt`, sau đó stream `alternateNamesV2.zip` chỉ cho entity sống sót sau representative selection deterministic. Alternate name `en`/`vi` rõ language tag có thể thay GeoNames fallback. Row `vi` vẫn áp dụng normalization hẹp `Ð/ð → Đ/đ`.

GeoNames vẫn fail-fast với UTF-8 hỏng, replacement character, row shape/coordinate/ID không hợp lệ. Geographic QA vẫn chặn large-city dataset mất hoàn toàn North America hoặc South America.

## Who's On First enrichment

WOF là **best-effort enrichment**, không thay GeoNames làm canonical geography. Nguồn hiện tại là global locality/country GeoJSON `tar.bz2` do Geocode Earth phát hành.

Join chỉ dùng duy nhất primary GeoNames concordance `wof:concordances["gn:id"]`. Alternate concordance và `gn:geonameid` imported không được coi là canonical identity; record có nhiều primary GeoNames ID bị quarantine. Tuyệt đối không fuzzy-match theo tên. Placetype hợp lệ:

- canonical `city` → WOF `locality`;
- canonical `country` → WOF `country` hoặc `dependency`.

Thứ tự English là WOF preferred > GeoNames English explicit > GeoNames fallback. Thứ tự Vietnamese là GeoNames Vietnamese explicit > WOF preferred Vietnamese > missing. WOF `vie` name/alias có legacy `Ð/ð` bị loại thay vì tự sửa ký tự; primary name không được chọn vẫn được giữ thành alias. WOF chỉ đóng góp language/identity metadata (`wofId`, placetype, names, aliases, `sourceRefs`); population, coordinates, country/admin data và timezone vẫn do GeoNames sở hữu.

Nếu nhiều WOF record cùng claim một GeoNames ID, hoặc một WOF ID claim nhiều GeoNames entity, identity đó bị quarantine: giữ nguyên GeoNames entity và skip riêng WOF enrichment. Đường đọc archive dùng bộ nhớ có giới hạn: `bzip2` phát TAR stream, reader frame từng GeoJSON entry, chỉ decode object `properties`, loại GeoNames concordance không liên quan trước `JSON.parse`, rồi giải phóng raw entry trước record kế tiếp. Geometry không được giữ trong enrichment candidate. WOF record liên quan nhưng malformed được đếm và bỏ qua. Nếu một archive WOF không tải/đọc được, build vẫn tiếp tục bằng GeoNames và ghi `partial`/`unavailable` trong manifest.

## Cache và reproducibility

Archive WOF mặc định cache tại `data/cache/wof`. Download dùng atomic write và SHA-256 được ghi vào `manifest.wofEnrichment.archives`. Chạy lại không có `--wof-refresh` sẽ reuse cache.

```bash
npm run dataset:build -- \
  --sources geonames,wof \
  --types country,city \
  --limit 20000
```

Custom cache hoặc refresh snapshot upstream:

```bash
npm run dataset:build -- \
  --wof-cache-dir /path/to/wof-cache \
  --wof-refresh \
  --limit 20000
```

GeoNames-only baseline vẫn giữ:

```bash
npm run dataset:build -- --sources geonames --types city --limit 20000
```

## Manifest v6

Manifest ghi source counts, selected count, coverage địa lý/ngôn ngữ, GeoNames dataset name và WOF diagnostics. `wofEnrichment` có status, requested/matched/ambiguous/invalid, counter `scanned` và `skippedUnmatched`, trạng thái theo type, archive URL/file/SHA-256 và ambiguity samples có giới hạn. Khi scan thật, progress định kỳ trên stderr hiển thị số record đã quét, target đã match, skipped/invalid, heap, RSS và elapsed time.

`dataQuality.policy = geonames_fail_fast_wof_best_effort`: lỗi canonical GeoNames vẫn fatal; lỗi optional WOF không được phép phá dataset GeoNames hợp lệ. `dataQuality.checks` ghi ba invariant của output cuối: duplicate canonical ID, duplicate source reference và Vietnamese legacy `Ð/ð`; acceptance yêu cầu cả ba counter bằng 0.

## Translation

Machine translation vẫn là stage tùy chọn riêng. Thiếu tiếng Việt là hợp lệ. Vietnamese native từ GeoNames/WOF không bị ghi đè. Field generated dùng provenance `machine_translation` cùng provider/model/prompt/source-hash/version.
