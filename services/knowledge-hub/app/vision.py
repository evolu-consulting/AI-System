"""
Florence-2 vision module for UI element grounding.

Pipeline:
    screenshot (PIL.Image)
        │
        ▼
    AutoProcessor  <CAPTION_TO_PHRASE_GROUNDING> {query}
        │
        ▼
    Florence-2-base  (float16 on CUDA, float32 on CPU)
        │
        ▼
    post_process_generation  →  bboxes in pixel coordinates
        │
        ▼
    {bounding_box, center_coordinates}
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any

from PIL import Image

logger = logging.getLogger(__name__)

FLORENCE_MODEL_ID = "microsoft/Florence-2-base"
TASK_PROMPT = "<CAPTION_TO_PHRASE_GROUNDING>"

# torch/transformers are ~several-second imports — deferred until a model is
# actually loaded, so the service and its tray icon start fast. _ensure_device()
# populates these lazily on first use.
_device: str | None = None
_dtype = None


def _ensure_device() -> None:
    global _device, _dtype
    if _device is None:
        import torch
        _device = "cuda" if torch.cuda.is_available() else "cpu"
        _dtype = torch.float16 if _device == "cuda" else torch.float32

# HF module cache root for Florence-2 custom code
_FLORENCE_CACHE = (
    Path.home()
    / ".cache" / "huggingface" / "modules"
    / "transformers_modules" / "microsoft"
)

# All patches needed for Florence-2 custom code to run under transformers 5.x.
# Each entry is (filename, old_string, new_string).
#
# Issue 1 — configuration_florence2.py:
#   transformers 5.x raises AttributeError when accessing an undefined config
#   attribute; previously it returned None. Florence2LanguageConfig.__init__
#   accesses self.forced_bos_token_id without a fallback.
#
# Issue 2 — processing_florence2.py:
#   transformers 5.x removed tokenizer.additional_special_tokens as a direct
#   attribute on RobertaTokenizer (used when building Florence-2's special token
#   list). getattr with a [] default reproduces the old behaviour.
_FLORENCE_PATCHES: list[tuple[str, str, str]] = [
    (
        "configuration_florence2.py",
        "if self.forced_bos_token_id is None",
        "if getattr(self, 'forced_bos_token_id', None) is None",
    ),
    (
        "processing_florence2.py",
        "tokenizer.additional_special_tokens",
        "getattr(tokenizer, 'additional_special_tokens', [])",
    ),
]


# ---------------------------------------------------------------------------
# Compatibility patch for transformers 5.x
# ---------------------------------------------------------------------------

def _apply_florence_patch() -> bool:
    """
    Patch Florence-2's cached custom code for transformers 5.x compatibility.

    The patch is idempotent and persists across restarts (the files live in the
    HF module cache). Returns True when at least one file was changed.
    """
    if not _FLORENCE_CACHE.exists():
        return False

    patched_any = False
    for filename, old, new in _FLORENCE_PATCHES:
        for target in _FLORENCE_CACHE.glob(f"*/*/{filename}"):
            original = target.read_text(encoding="utf-8")
            updated = original.replace(old, new)
            if updated != original:
                target.write_text(updated, encoding="utf-8")
                logger.info("Applied transformers-5.x patch to %s", target)
                patched_any = True

    if patched_any:
        # Evict stale imports so the retry picks up the patched files
        stale = [k for k in sys.modules if "florence" in k.lower()]
        for k in stale:
            del sys.modules[k]

    return patched_any


# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------

def _from_pretrained(AutoProcessor, AutoModelForCausalLM, local_files_only: bool) -> tuple[Any, Any]:
    """Load processor + model, either from the local HF cache or over the network."""
    processor = AutoProcessor.from_pretrained(
        FLORENCE_MODEL_ID,
        trust_remote_code=True,
        local_files_only=local_files_only,
    )
    model = AutoModelForCausalLM.from_pretrained(
        FLORENCE_MODEL_ID,
        dtype=_dtype,
        trust_remote_code=True,
        # Florence-2's custom model class does not implement _supports_sdpa;
        # "eager" bypasses the SDPA dispatch check in transformers 4.45+.
        attn_implementation="eager",
        local_files_only=local_files_only,
    ).to(_device)
    model.eval()
    return processor, model


def load_florence() -> tuple[Any, Any]:
    """
    Load Florence-2 processor + model.

    Fast path (every normal run): load entirely from the local HF cache with
    ``local_files_only=True``. This skips the ~8s of HEAD/GET round-trips to
    huggingface.co that ``from_pretrained`` otherwise makes on each startup just
    to check whether the already-cached files are stale.

    Network path (first run only): the cache miss falls through to a networked
    download, then handles the transformers-5.x incompatibility automatically —
    catches the AttributeError, patches the freshly-downloaded custom code, and
    retries transparently.

    Returns:
        (processor, model) — both ready for inference.
    """
    from transformers import AutoModelForCausalLM, AutoProcessor  # lazy heavy import
    _ensure_device()

    # Pre-patch if the custom code is already in cache from a previous run.
    _apply_florence_patch()

    # ── Fast path — local cache, no network ──────────────────────────────────
    try:
        processor, model = _from_pretrained(AutoProcessor, AutoModelForCausalLM, local_files_only=True)
        logger.info("Florence-2 loaded from local cache — device=%s, dtype=%s", _device, _dtype)
        return processor, model
    except Exception as exc:
        logger.info(
            "Florence-2 not fully in local cache (%s) — downloading once from HF Hub ...", exc
        )

    # ── Network path — first-time download (+ one-time compat patch) ──────────
    logger.info("Loading Florence-2 (%s) from HF Hub ...", FLORENCE_MODEL_ID)
    try:
        processor, model = _from_pretrained(AutoProcessor, AutoModelForCausalLM, local_files_only=False)
    except AttributeError as exc:
        if "forced_bos_token_id" not in str(exc):
            raise
        # Custom code was just downloaded for the first time; patch and retry.
        logger.warning(
            "Florence-2 custom code needs a one-time compatibility patch "
            "(transformers 5.x). Patching and retrying..."
        )
        _apply_florence_patch()
        processor, model = _from_pretrained(AutoProcessor, AutoModelForCausalLM, local_files_only=False)

    logger.info("Florence-2 loaded (downloaded) — device=%s, dtype=%s", _device, _dtype)
    return processor, model


# ---------------------------------------------------------------------------
# Coordinate utility
# ---------------------------------------------------------------------------

def _denormalize_bbox(
    bbox_norm: list[float],
    img_width: int,
    img_height: int,
) -> dict[str, int]:
    """
    Convert Florence-2's internal 1000×1000 normalized bbox to actual pixel
    coordinates for the given image dimensions.

    Florence-2 encodes box corners as values in [0, 1000] relative to a
    canonical 1000×1000 grid. This function scales them back:
        x_pixel = x_norm * img_width  / 1000
        y_pixel = y_norm * img_height / 1000

    Note: post_process_generation() already does this internally when
    image_size is supplied, so this function is exposed as a standalone
    utility for testing and transparency.
    """
    return {
        "x1": round(bbox_norm[0] * img_width  / 1000),
        "y1": round(bbox_norm[1] * img_height / 1000),
        "x2": round(bbox_norm[2] * img_width  / 1000),
        "y2": round(bbox_norm[3] * img_height / 1000),
    }


# ---------------------------------------------------------------------------
# Inference
# ---------------------------------------------------------------------------

def locate_ui_element(
    image: Image.Image,
    query: str,
    processor: Any,
    model: Any,
) -> dict[str, Any] | None:
    """
    Run Florence-2 CAPTION_TO_PHRASE_GROUNDING to locate a UI element.

    Args:
        image:     RGB PIL image (the screenshot).
        query:     Natural-language description, e.g. "Login button".
        processor: AutoProcessor loaded by load_florence().
        model:     AutoModelForCausalLM loaded by load_florence().

    Returns:
        dict with keys ``bounding_box`` and ``center_coordinates``, or
        ``None`` when Florence-2 cannot locate the element.
    """
    import torch
    _ensure_device()

    prompt = f"{TASK_PROMPT} {query}"

    inputs = processor(text=prompt, images=image, return_tensors="pt")
    # input_ids must stay as long-int tensors; only pixel_values go to _dtype
    input_ids    = inputs["input_ids"].to(_device)
    pixel_values = inputs["pixel_values"].to(_device, dtype=_dtype)

    with torch.no_grad():
        output_ids = model.generate(
            input_ids=input_ids,
            pixel_values=pixel_values,
            max_new_tokens=1024,
            do_sample=False,
            num_beams=3,
            early_stopping=False,
        )

    generated_text = processor.batch_decode(output_ids, skip_special_tokens=False)[0]

    # post_process_generation converts from 1000×1000 → actual pixel coords
    parsed = processor.post_process_generation(
        generated_text,
        task=TASK_PROMPT,
        image_size=(image.width, image.height),
    )

    bboxes = parsed.get(TASK_PROMPT, {}).get("bboxes", [])
    if not bboxes:
        return None

    # Take the first (highest-confidence) bounding box
    bb = {
        "x1": round(bboxes[0][0]),
        "y1": round(bboxes[0][1]),
        "x2": round(bboxes[0][2]),
        "y2": round(bboxes[0][3]),
    }
    center = {
        "x": round((bb["x1"] + bb["x2"]) / 2),
        "y": round((bb["y1"] + bb["y2"]) / 2),
    }

    logger.debug(
        "locate_ui_element — query=%r, bbox=%s, center=%s",
        query, bb, center,
    )
    return {"bounding_box": bb, "center_coordinates": center}
