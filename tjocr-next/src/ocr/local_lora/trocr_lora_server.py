from __future__ import annotations

import base64
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .trocr_lora_config import TrOCRLoRAConfig
from .trocr_lora_runtime import TrOCRLoRARuntime


class RecognitionRequest(BaseModel):
    image_base64: Annotated[str, Field(min_length=4)]


class BatchRecognitionRequest(BaseModel):
    images_base64: list[Annotated[str, Field(min_length=4)]] = Field(min_length=1, max_length=32)


runtime = TrOCRLoRARuntime(TrOCRLoRAConfig.from_environment())


@asynccontextmanager
async def lifespan(_: FastAPI):
    runtime.initialize()
    yield


app = FastAPI(title="Tajik TrOCR LoRA Runtime", lifespan=lifespan)


def decode_image(value: str) -> bytes:
    try:
        return base64.b64decode(value, validate=True)
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Invalid base64 image") from error


@app.get("/health")
def health() -> dict[str, object]:
    return runtime.health()


@app.post("/v1/recognize")
def recognize(request: RecognitionRequest) -> dict[str, object]:
    result = runtime.recognize(decode_image(request.image_base64))
    return {"text": result.text, "latencyMs": result.latency_ms}


@app.post("/v1/recognize-batch")
def recognize_batch(request: BatchRecognitionRequest) -> dict[str, object]:
    results = runtime.recognize_batch([decode_image(image) for image in request.images_base64])
    return {"results": [{"text": result.text, "latencyMs": result.latency_ms} for result in results]}
