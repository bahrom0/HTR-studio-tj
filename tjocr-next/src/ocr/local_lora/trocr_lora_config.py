from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal


DeviceName = Literal["auto", "cpu", "cuda"]


@dataclass(frozen=True)
class TrOCRLoRAConfig:
    """Configuration for an independently launched local TrOCR inference process.

    The adapter directory must contain a PEFT adapter_config.json and adapter weights
    created against the exact `base_model` revision.
    """

    base_model: str = "microsoft/trocr-base-handwritten"
    adapter_path: Path = Path("models/tajik-trocr-lora")
    device: DeviceName = "auto"
    max_new_tokens: int = 128
    num_beams: int = 1
    batch_size: int = 8
    use_bf16: bool = False

    @classmethod
    def from_environment(cls) -> "TrOCRLoRAConfig":
        device = os.getenv("TROCR_LORA_DEVICE", "auto").lower()
        if device not in {"auto", "cpu", "cuda"}:
            raise ValueError("TROCR_LORA_DEVICE must be one of: auto, cpu, cuda")
        config = cls(
            base_model=os.getenv("TROCR_LORA_BASE_MODEL", cls.base_model),
            adapter_path=Path(os.getenv("TROCR_LORA_ADAPTER_PATH", str(cls.adapter_path))),
            device=device,  # type: ignore[arg-type]
            max_new_tokens=int(os.getenv("TROCR_LORA_MAX_NEW_TOKENS", cls.max_new_tokens)),
            num_beams=int(os.getenv("TROCR_LORA_NUM_BEAMS", cls.num_beams)),
            batch_size=int(os.getenv("TROCR_LORA_BATCH_SIZE", cls.batch_size)),
            use_bf16=os.getenv("TROCR_LORA_BF16", "false").lower() == "true",
        )
        if config.max_new_tokens < 1 or config.num_beams < 1 or config.batch_size < 1:
            raise ValueError("TrOCR LoRA generation and batch values must be positive")
        return config
