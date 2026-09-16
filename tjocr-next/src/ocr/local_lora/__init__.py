"""Standalone local TrOCR + LoRA runtime. This package is not wired into the web application."""

from .trocr_lora_config import TrOCRLoRAConfig
from .trocr_lora_runtime import TrOCRLoRARuntime

__all__ = ["TrOCRLoRAConfig", "TrOCRLoRARuntime"]
