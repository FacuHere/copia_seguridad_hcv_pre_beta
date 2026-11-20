"""Ejecuta Behave en el Docker beta y actualiza la documentación local."""
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from generar_documentacion_viva import RAIZ, generar, leer_json

CONTENEDOR = "hcv_docker_beta_test-api-1"


def hora_cliente():
    try:
        zona = ZoneInfo("America/Buenos_Aires")
    except ZoneInfoNotFoundError:
        zona = timezone(timedelta(hours=-3), "UTC-03")
    return datetime.now(zona)


def consultar_imagen():
    ejecutable = shutil.which("docker")
    if not ejecutable:
        raise ValueError("Docker no está disponible para identificar la versión de pruebas.")
    resultado = subprocess.run(
        [ejecutable, "inspect", "--format", "{{.Image}}|{{.State.Health.Status}}", CONTENEDOR],
        capture_output=True, text=True, timeout=15, check=False,
    )
    if resultado.returncode:
        raise ValueError("No se pudo consultar la aplicación beta. No se inició la prueba.")
    partes = resultado.stdout.strip().split("|")
    if len(partes) != 2 or not partes[0].startswith("sha256:") or partes[1] != "healthy":
        raise ValueError("La aplicación beta no está saludable o no informa su versión.")
    return partes[0]


def ejecutar(etiquetas):
    imagen = consultar_imagen()
    fecha = hora_cliente()
    ruta_registro = RAIZ / "docs/qc/registro-ejecuciones-behave.json"
    registro = leer_json(ruta_registro)
    carpeta = RAIZ / "reports/qc"
    carpeta.mkdir(parents=True, exist_ok=True)
    # La ejecución puede incluir varios TC; sus identidades se leen de las etiquetas.
    nombre = f"QC-{fecha:%Y%m%d-%H%M%S-%f}.json"
    ruta = carpeta / nombre
    if ruta.exists():
        raise ValueError("El identificador de ejecución ya existe.")
    comando = [
        sys.executable, "-m", "behave", f"--tags={etiquetas}",
        "--no-capture", "--no-color", "-f", "plain", "-o", "-",
        "-f", "json.pretty", "-o", str(ruta),
    ]
    inicio = time.perf_counter()
    resultado = subprocess.run(comando, cwd=RAIZ, check=False)
    duracion = time.perf_counter() - inicio
    # Leer el reporte, nunca convertir ausencia de escenarios en una aprobación.
    datos = leer_json(ruta)
    escenarios = [e for f in datos for e in f.get("elements", [])
                  if e.get("type") in ("scenario", "scenario_outline")]
    if not escenarios:
        raise ValueError("No se ejecutó ningún escenario con las etiquetas seleccionadas.")
    try:
        imagen_final = consultar_imagen()
    except ValueError:
        imagen_final = None
    huellas = {
        p.relative_to(RAIZ).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted((RAIZ / "features").rglob("*"))
        if p.is_file() and p.suffix in (".py", ".feature")
    }
    aprobado = resultado.returncode == 0 and all(e.get("status") == "passed" for e in escenarios)
    registro["ejecuciones"].append({
        "archivo": nombre, "fecha_cliente": fecha.isoformat(),
        "zona_horaria_cliente": "America/Buenos_Aires",
        "tipo_hallazgo": "ninguno" if aprobado else "por_revisar",
        "imagen": imagen, "imagen_al_final": imagen_final,
        "version_estable": imagen_final == imagen,
        "url_entorno": "http://127.0.0.1:3002",
        "nota_revision": "Ejecución registrada automáticamente; una falla requiere clasificación posterior.",
        "sha256_reporte": hashlib.sha256(ruta.read_bytes()).hexdigest(),
        "huellas_pruebas": huellas, "duracion_proceso_segundos": duracion,
    })
    temporal = ruta_registro.with_suffix(".tmp")
    temporal.write_text(json.dumps(registro, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporal.replace(ruta_registro)
    generar(RAIZ)
    print("Resultado y versión conservados. Vista: reports/qc/documentacion-viva/index.html")
    if imagen_final != imagen:
        print("La versión no se mantuvo estable; revisar el contexto antes de aceptar la ejecución.")
        return 2
    return resultado.returncode


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--etiquetas", default="@TC-015", help="Expresión de etiquetas de Behave.")
    parser.add_argument("--solo-reportes", action="store_true", help="Regenerar la vista sin Docker ni ejecución de pruebas.")
    argumentos = parser.parse_args()
    try:
        if argumentos.solo_reportes:
            generar(RAIZ)
            print("Vista local actualizada sin ejecutar pruebas.")
            return 0
        return ejecutar(argumentos.etiquetas)
    except (ValueError, subprocess.TimeoutExpired) as error:
        # No se publican cuerpos HTTP, secretos o salidas completas de Docker.
        print(str(error) if isinstance(error, ValueError) else "Se agotó la espera al consultar Docker.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
