# Notebook demo Kaggle CPU-FP16 hướng đến production
> 🌐 Language / Ngôn ngữ: [English](kaggle-production-demo-notebook.md) | **Tiếng Việt**

Điểm vào Kaggle tương tác canonical là:

```text
notebooks/kaggle-cpu-fp16-production-demo.ipynb
```

Notebook dùng workflow repository-first được pin theo release: import notebook từ GitHub, sau đó code cell đầu tiên clone hoặc refresh repository chính thức dưới `/kaggle/working`, force-fetch annotated tag `v1.0.0`, resolve tag đó về commit tương ứng và checkout chính xác commit này ở detached HEAD. GitHub vẫn là source of truth, còn release tag là source identity bất biến dùng cho qualification.

## Bắt đầu nhanh

1. Tạo Kaggle Notebook mới và chọn **File → Import Notebook → GitHub**.
2. Chọn repository `dangkhoa2016/Nodejs-Qdrant-Bilingual-Search` và notebook `notebooks/kaggle-cpu-fp16-production-demo.ipynb`.
3. Bật **Internet** và đặt **Accelerator=None**.
4. Gắn model bằng slug `dangkhoa2016/qwen-qwen3-embedding-4b`, chọn **Framework: `Transformers`** và **Variation: `default`** (`Transformers/default`).
5. Gắn dataset bằng slug `dangkhoa2016/qdrant-bilingual-search-canonical-v2-1-20k`.
6. Giữ các mặc định an toàn:

   ```python
   RUN_LIVE_DEMO = True
   ENABLE_PUBLIC_TUNNEL = False
   ```

7. Chọn **Restart Session → Run All**.

Kaggle mount model và dataset đã gắn ở chế độ read-only bên dưới `/kaggle/input`. Không sao chép các canonical input này vào `/kaggle/working`; writable runtime state phải nằm dưới `/kaggle/working/qdrant-bilingual-search/`.

## Repository bootstrap sạch và được pin theo release

Checkout tại `/kaggle/working/Nodejs-Qdrant-Bilingual-Search` được xem là source state dùng một lần. Mỗi lần chạy, bootstrap refresh repository, force-fetch `refs/tags/v1.0.0`, xác minh `v1.0.0` là annotated tag, resolve `v1.0.0^{commit}`, checkout chính xác commit đó với detached HEAD, rồi chạy `git clean -ffd`.

Notebook cố ý **không** qualification một `origin/main` đang di chuyển. Cell xác minh source identity kiểm tra:

```text
HEAD == v1.0.0^{commit}
Git status == clean
RELEASE_SOURCE_IDENTITY = PASS
```

Cách này vừa loại bỏ file/thư mục untracked cũ còn sót lại từ lần chạy Kaggle trước, vừa bảo đảm fresh evidence có thể quy về chính xác frozen release source.

Persistent/runtime data được giữ bên ngoài source checkout. Canonical Qdrant storage dùng `/kaggle/working/qdrant-bilingual-search/qdrant-data`; temporary snapshot-restore process dùng `/kaggle/working/qdrant-bilingual-search/snapshot-restore-runtime`, bao gồm các thư mục `snapshots/` và `tmp/` riêng. Nhờ vậy Qdrant không thể tạo lại runtime snapshot file bên trong Git checkout trong canonical restore workflow.

### Khôi phục snapshot an toàn khi chạy lại

Canonical restore path an toàn để chạy lại trong cùng Kaggle session. Trước khi chạm vào snapshot, `restore-canonical-qdrant-snapshot.sh` gọi `prepare-canonical-qdrant-restore.sh`, tái sử dụng ownership model của production demo để chỉ dừng các process được chứng minh là thuộc repository này. Việc này dọn stack Node/embedding/Qdrant cũ có thể vẫn giữ port `6333` sau một lần notebook chạy dở hoặc chạy lặp lại.

Ranh giới an toàn vẫn fail-closed: service bên ngoài hoặc service tái sử dụng không bao giờ bị cleanup này kill. Sau owned-process cleanup, port `6333` phải trống. Nếu một service khác vẫn đang listen, restore sẽ abort thay vì tái sử dụng hoặc terminate service đó.

Các marker pre-restore mong đợi:

```text
QDRANT_PORT_6333=CLEAN
QDRANT_PRE_RESTORE_OWNED_CLEANUP=PASS
```

## Core demo bắt buộc và public demo tùy chọn

Notebook cố ý tách hai lớp validation.

### Core local demo — bắt buộc

Sections 1–5 restore và chạy canonical stack hoàn toàn trên loopback:

```text
Node/Hono API       127.0.0.1:3000
Embedding service   127.0.0.1:8001
Qdrant              127.0.0.1:6333
```

Kaggle profile ép Node host thành `127.0.0.1`. Evidence collector fail-closed nếu Node, Qdrant hoặc embedding service listen trên wildcard interface.

Stable local acceptance gồm bảy check:

```text
/health
/ready
canonical /api/v1/info
Thailand EN
Tokyo VI
Beijing VI
Casablanca negative
```

Marker mong đợi:

```text
PRODUCTION_DEMO_ACCEPTANCE_PASS=13
```

### Authenticated public demo — tùy chọn

Sections 6–7 chỉ chạy khi:

```python
ENABLE_PUBLIC_TUNNEL = True
```

Chúng **không bắt buộc để xác thực core Kaggle demo**. Khi bật, public topology là:

```text
Internet
  -> Cloudflare Quick Tunnel
  -> 127.0.0.1:8090 authenticated gateway
  -> 127.0.0.1:3000 Node/Hono API
  -> 127.0.0.1:8001 embedding service
  -> 127.0.0.1:6333 Qdrant
```

Public acceptance thêm một unauthenticated `401` check trước bảy core check. Vì vậy authenticated public acceptance hoàn chỉnh có tám check:

```text
PRODUCTION_DEMO_ACCEPTANCE_PASS=14
```

Notebook chỉ báo cáo `AUTHENTICATED_PUBLIC_DEMO=PASS` sau khi Sections 6–7 thực sự hoàn tất thành công. Nếu public mode bị tắt hoặc bị bỏ qua, notebook báo `AUTHENTICATED_PUBLIC_DEMO=NOT_RUN` thay vì PASS giả.

Quick Tunnel là demo endpoint tạm thời, không phải dịch vụ hosting 24/7 có SLA.

## Frozen runtime và snapshot contract

```text
model                  = Qwen/Qwen3-Embedding-4B
backend                = transformers
runtime                = pytorch-cpu
device                 = cpu
internal dtype         = float16
batch size             = 1
dimension              = 2560
public vector dtype    = float32
transport              = binary-f32
embedding text         = v2.1

Qdrant                 = 1.18.3
collection             = knowledge_entities_qwen3_4b_text_v21
points                 = 20000
indexed vectors        = 20000
distance               = Cosine
```

Canonical snapshot:

```text
knowledge_entities_qwen3_4b_text_v21-20260827T013824Z.snapshot
bytes  = 283812352
sha256 = 71f12fe14ef51966069347290ad15302d389e488d7904dab6cf0cf190f43064f
```

Notebook xác minh snapshot identity và restore snapshot mà không reseed.

## Evidence và publication hygiene

Section 8 gọi:

```text
scripts/kaggle/collect-production-demo-notebook-evidence.sh
```

Nó tạo:

```text
nodejs-qdrant-v1.0.0-production-demo-evidence-<UTC>.zip
nodejs-qdrant-v1.0.0-production-demo-evidence-<UTC>.zip.sha256
```

Các publication safeguard gồm:

- Git worktree phải clean; `.runtime/` được ignore như ephemeral state.
- Temporary Qdrant restore snapshot và temp file luôn nằm ngoài source checkout.
- Process evidence bỏ full command-line arguments để Kaggle/Jupyter session credential không thể rò qua output `ps`.
- Listener check của Qdrant, embedding và Node fail khi phát hiện wildcard exposure.
- Bearer-token value và token-named file bị loại khỏi evidence.
- `SHA256SUMS` nội bộ dùng relative path, loại chính nó và được verify lại sau independent ZIP extraction.
- `.zip.sha256` bên ngoài chỉ chứa basename của ZIP và dùng được với `sha256sum -c` sau download.
- Public PASS marker yêu cầu public acceptance log thật có unauthenticated `401` và `PRODUCTION_DEMO_ACCEPTANCE_PASS=14`.
- `system/environment.txt` phân biệt `SYSTEM_NODE_VERSION` với `DEMO_NODE_VERSION` của Node API runtime thực tế.
- Notebook giữ `evidence_completed=False` cho đến khi Section 8 tạo thành công ZIP và sidecar mong đợi. Section 9 phát `EVIDENCE_COLLECTION=FAIL` và `PRODUCTION_ORIENTED_DEMO_NOTEBOOK=INCOMPLETE` nếu evidence packaging chưa hoàn tất.

Các final marker thành công mong đợi cho local-only run:

```text
CORE_LOCAL_DEMO=PASS
EVIDENCE_COLLECTION=PASS
AUTHENTICATED_PUBLIC_DEMO=NOT_RUN
PRODUCTION_ORIENTED_DEMO_NOTEBOOK=PASS
```

## Trạng thái validation

GitHub CI xác thực notebook structure, bilingual guidance marker, exact annotated-tag bootstrap behavior, rerun-safe owned-Qdrant cleanup với external-service fail-closed behavior, Qdrant runtime snapshot-path hygiene, tính trung thực của final evidence state, localhost/public topology contract, publication hygiene, helper syntax, Node tests, Python embedding tests và Qdrant integration.

Sau khi final publication history và annotated tag `v1.0.0` được freeze, một fresh Kaggle **Restart Session → Run All** trên chính xác tag target đó là live qualification gate có thẩm quyền. Chỉ evidence được tạo từ final tag-pinned session này mới được dùng để overwrite controlled public release evidence assets và các digest tương ứng.
