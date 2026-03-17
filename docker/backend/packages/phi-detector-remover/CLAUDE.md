# phi-detector-remover

## Overview

Modular PHI (Protected Health Information) detection and removal package for iOS screenshots. Supports multiple detection strategies with configurable pipelines optimized for research data processing.

**Key Features:**
- OCR text extraction with Tesseract, Hunyuan LVM, or Rust PyO3 (leptess) engines
- Multiple detector types: Presidio NER, regex patterns, LLM-based, GliNER NER, Vision/LVM
- Detector and OCR engine registries for extensibility
- Batched LLM API calls for efficiency
- OCR caching for repeated processing
- Red box redaction (HIPAA-visible)
- Polars DataFrame integration for Dagster pipelines
- Benchmarking subsystem for evaluating detector accuracy

## Quick Start

### Simple Usage

```python
from phi_detector_remover import process_image

# Detect and redact PHI in one call
image_bytes = Path("screenshot.png").read_bytes()
clean_image, regions = process_image(image_bytes, removal_method="redbox")
Path("clean.png").write_bytes(clean_image)
```

### Dagster Pipeline Integration

```python
from phi_detector_remover import detect_phi_batch, PHIDetectionConfig

# Configure for your LLM endpoint
config = PHIDetectionConfig(
    llm_endpoint="http://10.23.7.55:1234/v1",  # LMStudio
    llm_model="gpt-oss-20b",
    llm_batch_size=20,  # Images per LLM call
    ocr_workers=8,      # Parallel OCR
)

# Process from DataFrame or file list
results_df = detect_phi_batch(
    catalog=screenshot_catalog_df,
    file_path_column="file_path",
    config=config,
    cache_dir=Path("./ocr_cache"),
)

# Results DataFrame columns:
# - file_path, phi_detected, phi_entities, phi_count, ocr_text
```

### Dagster Asset Example

```python
from dagster import asset, AssetIn
import polars as pl
from phi_detector_remover import detect_phi_batch, PHIDetectionConfig

@asset(ins={"catalog": AssetIn("ios_screenshots_raw_catalog")})
def ios_phi_detection_results(context, catalog: pl.DataFrame) -> pl.DataFrame:
    config = PHIDetectionConfig(
        llm_endpoint="http://10.23.7.55:1234/v1",
        llm_model="gpt-oss-20b",
        redact=True,
        redact_output_dir=Path("/data/redacted"),
    )
    
    return detect_phi_batch(
        catalog=catalog,
        file_path_column="file_path",
        config=config,
        cache_dir=Path("/tmp/ocr_cache"),
    )
```

## API Reference

### High-Level API (Recommended for Dagster)

#### `detect_phi_batch()`

Main entry point for batch processing with OCR caching and batched LLM calls.

```python
from phi_detector_remover import detect_phi_batch, PHIDetectionConfig

config = PHIDetectionConfig(
    # LLM settings
    llm_endpoint="http://10.23.7.55:1234/v1",
    llm_model="gpt-oss-20b",
    llm_batch_size=20,
    
    # OCR settings
    ocr_workers=8,
    
    # Redaction settings
    redact=False,
    redact_output_dir=None,
    redact_method="redbox",
)

results = detect_phi_batch(
    catalog=df_or_file_list,
    file_path_column="file_path",
    config=config,
    cache_dir=Path("./cache"),
    use_content_hash=False,  # True for duplicate handling
)
```

**Returns:** Polars DataFrame with columns:
- `file_path`: Original file path
- `phi_detected`: Boolean
- `phi_entities`: JSON list of detected entities
- `phi_count`: Number of entities
- `ocr_text`: Extracted text
- `ocr_confidence`: OCR confidence score
- `processing_time_ms`: Processing time

#### `detect_phi_single()`

Process a single image:

```python
from phi_detector_remover import detect_phi_single, PHIDetectionConfig

result = detect_phi_single(
    image_path=Path("screenshot.png"),
    config=PHIDetectionConfig(llm_endpoint="http://localhost:1234/v1"),
)
```

#### `process_image()`

Simple one-shot detection and redaction:

```python
from phi_detector_remover import process_image

clean_bytes, regions = process_image(
    image_bytes,
    removal_method="redbox",
    pipeline_preset="balanced",  # fast, balanced, hipaa_compliant
)
```

### Pipeline Builder API (Advanced)

For custom detector configurations:

```python
from phi_detector_remover import PHIPipelineBuilder, BatchProcessor

# Build custom pipeline
pipeline = (
    PHIPipelineBuilder()
    .with_ocr("tesseract", lang="eng")
    .add_presidio(entities=["PERSON", "EMAIL"], score_threshold=0.7)
    .add_regex()
    .add_llm(model="gpt-oss-20b", api_endpoint="http://10.23.7.55:1234/v1")
    .with_prompt("hipaa")
    .union_aggregation()
    .parallel()
    .build()
)

# Process single image
result = pipeline.process(image_bytes)

# Batch process with DataFrame output
processor = BatchProcessor(pipeline, max_workers=4)
results_df = processor.process_directory("./screenshots/", pattern="*.png")
```

### Pipeline Presets

| Preset | Detectors | Use Case |
|--------|-----------|----------|
| `PHIPipelineBuilder.fast()` | Tesseract + Presidio | Quick scanning |
| `PHIPipelineBuilder.balanced()` | + Regex | Default choice |
| `PHIPipelineBuilder.hipaa_compliant()` | Lower thresholds | Max recall |
| `PHIPipelineBuilder.screen_time()` | Optimized for iOS | Screen Time data |

## LLM Endpoint Configuration

The package supports OpenAI-compatible APIs. Provide the base `/v1` endpoint:

```python
# LMStudio (local or network)
config = PHIDetectionConfig(
    llm_endpoint="http://10.23.7.55:1234/v1",
    llm_model="gpt-oss-20b",
)

# Ollama
config = PHIDetectionConfig(
    llm_endpoint="http://localhost:11434/api/generate",
    llm_model="llama3.2",
)
```

The code automatically appends `/chat/completions` for OpenAI-compatible endpoints.

## Prompt Configuration

For LLM detectors, prompts use a three-part structure:
- **system_prompt**: Role and output format
- **positive_prompt**: What to detect (PHI categories)
- **negative_prompt**: What to ignore (app names, UI elements)

```python
config = PHIDetectionConfig(
    llm_endpoint="http://localhost:1234/v1",
    system_prompt="You are a PHI detector...",
    positive_prompt="## DETECT: Personal names, emails...",
    negative_prompt="## IGNORE: App names, UI elements...",
)
```

## OCR Caching

OCR results are cached to disk for efficiency:

```python
results = detect_phi_batch(
    catalog=files,
    config=config,
    cache_dir=Path("./ocr_cache"),  # Creates ocr_cache.pkl
    use_content_hash=False,  # Fast: name+size+mtime
    # use_content_hash=True,  # Slow but handles duplicates
)
```

Cache key by default uses `{filename}_{size}_{mtime}`. Set `use_content_hash=True` for content-based hashing (slower but handles duplicate files in different directories).

## Redaction

```python
from phi_detector_remover import PHIRemover, RedactionMethod

remover = PHIRemover(method=RedactionMethod.REDBOX)
clean_bytes = remover.remove(image_bytes, regions)
```

Methods:
- `REDBOX`: Red rectangle (default, HIPAA-visible)
- `BLACKBOX`: Black rectangle
- `PIXELATE`: Mosaic effect

## Architecture

```
phi_detector_remover/
├── __init__.py              # Public API exports (70+ symbols)
├── dagster.py               # High-level batch API for pipelines
├── core/
│   ├── models.py            # PHIRegion, BoundingBox, OCRResult
│   ├── config.py            # Configuration dataclasses
│   ├── detector.py          # Main PHIDetector orchestrator class
│   ├── patterns.py          # PHI regex pattern definitions
│   ├── prompts.py           # LLM prompt templates
│   ├── protocols.py         # Protocol/interface definitions
│   ├── remover.py           # Image redaction
│   ├── batch.py             # BatchProcessor class
│   ├── ocr.py               # OCR facade/wrapper
│   ├── ocr/
│   │   ├── tesseract.py     # Tesseract OCR engine
│   │   ├── hunyuan.py       # Hunyuan LVM OCR engine
│   │   ├── rust_engine.py   # Rust PyO3 OCR engine (leptess)
│   │   └── registry.py      # OCR engine discovery/registry
│   ├── detectors/
│   │   ├── presidio.py      # Presidio NER
│   │   ├── regex.py         # Regex patterns
│   │   ├── llm.py           # LLM text detector
│   │   ├── gliner.py        # GliNER NER entity extraction
│   │   ├── vision.py        # Vision/LVM detectors
│   │   └── registry.py      # Detector discovery/registry
│   ├── benchmark/           # Benchmarking subsystem
│   │   ├── dataset.py       # Benchmark dataset management
│   │   ├── metrics.py       # Evaluation metrics
│   │   └── runner.py        # Benchmark runner
│   └── pipeline/
│       ├── builder.py       # PHIPipelineBuilder
│       ├── executor.py      # PHIPipeline
│       └── aggregator.py    # Result aggregation
├── web/                     # FastAPI service (optional)
│   ├── main.py, routes.py, schemas.py
└── client/                  # HTTP client (optional)
    └── client.py
```

## Dependencies

**Required:**
- `pytesseract` + Tesseract binary installed on system
- `opencv-python`, `Pillow`
- `polars`, `httpx`
- `presidio-analyzer`, `presidio-anonymizer`

**Optional:**
- `gliner` - GliNER NER detector
- Rust PyO3 `leptess` module - high-performance OCR engine
- Hunyuan LVM endpoint - vision-based OCR

**System Requirements:**
- Tesseract OCR must be installed separately:
  - Windows: https://github.com/UB-Mannheim/tesseract/wiki
  - Mac: `brew install tesseract`
  - Linux: `apt-get install tesseract-ocr`

## Testing

```bash
cd packages/phi-detector-remover
uv run pytest tests/ -v
```

## Notes

- For GNSM/TECH studies, use `detect_phi_batch()` with LLM detection
- Presidio has false positives on app names - LLM detection is more accurate
- Always keep original images; redaction is permanent
- OCR caching significantly speeds up repeated processing
