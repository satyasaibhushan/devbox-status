import time
from pathlib import Path

import psutil
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

app = FastAPI()

BOOT_TIME = psutil.boot_time()
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


def read_temperatures():
    sensor_reader = getattr(psutil, "sensors_temperatures", None)
    temps = sensor_reader() if sensor_reader else None
    if not temps:
        return []
    readings = []
    for chip, entries in temps.items():
        for entry in entries:
            readings.append(
                {
                    "chip": chip,
                    "label": entry.label or chip,
                    "current": round(entry.current, 1),
                    "high": entry.high,
                    "critical": entry.critical,
                }
            )
    return readings


@app.get("/api/status")
def status():
    cpu_percent = psutil.cpu_percent(interval=0.3)
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    load1, load5, load15 = psutil.getloadavg()

    return {
        "timestamp": time.time(),
        "uptime_seconds": int(time.time() - BOOT_TIME),
        "cpu": {
            "percent": cpu_percent,
            "count": psutil.cpu_count(logical=True),
            "load_avg": {"1m": load1, "5m": load5, "15m": load15},
        },
        "memory": {
            "total": mem.total,
            "used": mem.used,
            "percent": mem.percent,
        },
        "disk": {
            "total": disk.total,
            "used": disk.used,
            "percent": disk.percent,
        },
        "temperatures": read_temperatures(),
    }


app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
