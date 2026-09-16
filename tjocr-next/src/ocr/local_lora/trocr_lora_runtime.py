from __future__ import annotations

import time
from dataclasses import dataclass
from io import BytesIO
from typing import Iterable, Sequence

import torch
from peft import PeftModel
from PIL import Image
from transformers import TrOCRProcessor, VisionEncoderDecoderModel

from .trocr_lora_config import TrOCRLoRAConfig


@dataclass(frozen=True)
class TrOCRRecognition:
    text: str
    latency_ms: int


class TrOCRLoRARuntime:
    """Runs a local TrOCR base model with a PEFT LoRA adapter.

    This runtime deliberately owns no HTTP client and is not imported by the
    Next.js app. Run it as its own process through `trocr_lora_server.py`.
    """

    def __init__(self, config: TrOCRLoRAConfig) -> None:
        self.config = config
        self._processor: TrOCRProcessor | None = None
        self._model: PeftModel | None = None
        self._device: torch.device | None = None

    @property
    def is_ready(self) -> bool:
        return self._processor is not None and self._model is not None and self._device is not None

    def initialize(self) -> None:
        if self.is_ready:
            return
        if not self.config.adapter_path.is_dir():
            raise FileNotFoundError(
                f"TrOCR LoRA adapter directory does not exist: {self.config.adapter_path}. "
                "Set TROCR_LORA_ADAPTER_PATH to a PEFT adapter directory."
            )

        device = self._resolve_device()
        dtype = self._resolve_dtype(device)
        processor = TrOCRProcessor.from_pretrained(self.config.base_model)
        base_model = VisionEncoderDecoderModel.from_pretrained(
            self.config.base_model,
            torch_dtype=dtype,
            low_cpu_mem_usage=True,
        )
        model = PeftModel.from_pretrained(base_model, str(self.config.adapter_path), is_trainable=False)
        model.to(device)
        model.eval()

        self._processor = processor
        self._model = model
        self._device = device

    @torch.inference_mode()
    def recognize(self, image_bytes: bytes) -> TrOCRRecognition:
        return self.recognize_batch([image_bytes])[0]

    @torch.inference_mode()
    def recognize_batch(self, images: Sequence[bytes]) -> list[TrOCRRecognition]:
        self.initialize()
        if not images:
            return []
        assert self._processor is not None and self._model is not None and self._device is not None

        decoded = [self._decode_image(image) for image in images]
        started_at = time.perf_counter()
        pixel_values = self._processor(images=decoded, return_tensors="pt").pixel_values.to(self._device)
        generated = self._model.generate(
            pixel_values=pixel_values,
            max_new_tokens=self.config.max_new_tokens,
            num_beams=self.config.num_beams,
            do_sample=False,
        )
        texts = self._processor.batch_decode(generated, skip_special_tokens=True)
        elapsed_ms = round((time.perf_counter() - started_at) * 1000)
        per_item_ms = max(1, round(elapsed_ms / len(images)))
        return [TrOCRRecognition(text=text.strip(), latency_ms=per_item_ms) for text in texts]

    def health(self) -> dict[str, object]:
        return {
            "status": "ready" if self.is_ready else "not_initialized",
            "family": "TrOCR",
            "adapter": "LoRA",
            "device": str(self._device) if self._device else self.config.device,
        }

    def _resolve_device(self) -> torch.device:
        if self.config.device == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("TROCR_LORA_DEVICE=cuda was requested, but CUDA is unavailable")
        if self.config.device == "cpu":
            return torch.device("cpu")
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")

    def _resolve_dtype(self, device: torch.device) -> torch.dtype:
        if device.type == "cpu":
            return torch.float32
        return torch.bfloat16 if self.config.use_bf16 else torch.float16

    @staticmethod
    def _decode_image(image_bytes: bytes) -> Image.Image:
        try:
            with Image.open(BytesIO(image_bytes)) as image:
                return image.convert("RGB")
        except Exception as error:  # Pillow errors vary by decoder and version.
            raise ValueError("The submitted OCR image cannot be decoded") from error


def batch_chunks(items: Iterable[bytes], size: int) -> Iterable[list[bytes]]:
    """Yield fixed-size batches for callers that stream a large page collection."""
    batch: list[bytes] = []
    for item in items:
        batch.append(item)
        if len(batch) == size:
            yield batch
            batch = []
    if batch:
        yield batch
