from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

try:
    from rembg import remove
    rembg_import_error = None
except Exception as exc:  # pragma: no cover
    remove = None
    rembg_import_error = str(exc)


app = FastAPI(title="Prop Tool rembg Service")


class BatchRequest(BaseModel):
    input_dir: str
    output_dir: str


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "rembg_loaded": remove is not None, "rembg_import_error": rembg_import_error}


@app.post("/remove-bg")
async def remove_bg(file: UploadFile = File(...)) -> Response:
    if remove is None:
        raise HTTPException(status_code=503, detail="rembg is not available")
    data = await file.read()
    output = remove(data)
    return Response(content=output, media_type="image/png")


@app.post("/remove-bg-batch")
def remove_bg_batch(payload: BatchRequest) -> dict[str, Any]:
    if remove is None:
        raise HTTPException(status_code=503, detail="rembg is not available")

    input_dir = Path(payload.input_dir).resolve()
    output_dir = Path(payload.output_dir).resolve()
    if not input_dir.exists() or not input_dir.is_dir():
        raise HTTPException(status_code=400, detail="input_dir does not exist")

    output_dir.mkdir(parents=True, exist_ok=True)
    files: list[dict[str, str]] = []
    success = 0
    failed = 0

    for source in sorted(input_dir.glob("*.png")):
        target = output_dir / source.name
        try:
            target.write_bytes(remove(source.read_bytes()))
            files.append({"input": source.name, "output": target.name, "status": "success"})
            success += 1
        except Exception as exc:  # pragma: no cover
            files.append({"input": source.name, "output": target.name, "status": "failed", "error": str(exc)})
            failed += 1

    return {"total": success + failed, "success": success, "failed": failed, "files": files}
