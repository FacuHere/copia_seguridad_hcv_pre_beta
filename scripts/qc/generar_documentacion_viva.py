"""Genera una vista local de los reportes de Behave sin publicar trazas ni datos."""
import argparse
import hashlib
import html
import json
import math
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
PATRON_REPORTE = re.compile(r"(?:TC-\d{3}|QC)-\d{8}-\d{6}(?:-\d{6})?\.json")
PATRON_ETIQUETA = re.compile(r"(?:TC-\d{3}|RN-\d{3}|RNF-\d{2}|RF-\d+\.\d+|HU-\d{2})")
ESTADOS = {
    "passed": "Aprobado", "failed": "Fallido", "error": "Error",
    "skipped": "Omitido", "untested": "Sin ejecutar",
    "undefined": "Sin implementar", "pending": "Pendiente",
}
TIPOS = {
    "automatizacion": "Automatización", "producto": "Producto",
    "ninguno": "Sin fallo informado", "por_revisar": "Por revisar",
}


def leer_json(ruta):
    try:
        return json.loads(ruta.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise ValueError(f"No se pudo leer el JSON {ruta.name}.") from None


def etiquetas_validas(etiquetas):
    valores = []
    for etiqueta in etiquetas:
        valor = etiqueta.get("name", "") if isinstance(etiqueta, dict) else etiqueta
        if isinstance(valor, str):
            valor = valor.removeprefix("@")
            if PATRON_ETIQUETA.fullmatch(valor) and valor not in valores:
                valores.append(valor)
    return valores


def resumir_reporte(ruta, metadatos, catalogo):
    if not PATRON_REPORTE.fullmatch(ruta.name):
        raise ValueError("Nombre de reporte fuera del formato de QC.")
    huella = hashlib.sha256(ruta.read_bytes()).hexdigest()
    esperada = metadatos.get("sha256_reporte")
    if esperada and huella != esperada:
        raise ValueError(f"La huella del reporte {ruta.name} cambió.")
    datos = leer_json(ruta)
    if not isinstance(datos, list):
        raise ValueError(f"Estructura inesperada en {ruta.name}.")
    escenarios = []
    for funcionalidad in datos:
        for escenario in funcionalidad.get("elements", []):
            if escenario.get("type") not in ("scenario", "scenario_outline"):
                continue
            etiquetas = etiquetas_validas(
                funcionalidad.get("tags", []) + escenario.get("tags", [])
            )
            casos = [t for t in etiquetas if t.startswith("TC-")]
            if len(casos) != 1:
                raise ValueError(f"Cada escenario de {ruta.name} necesita un único TC.")
            caso = casos[0]
            ficha = catalogo.get(caso, {})
            estado = escenario.get("status", "untested")
            if estado not in ESTADOS:
                raise ValueError(f"Estado desconocido en {ruta.name}.")
            pasos = []
            for numero, paso in enumerate(escenario.get("steps", []), 1):
                resultado = paso.get("result", {})
                estado_paso = resultado.get("status", "untested")
                if estado_paso not in ESTADOS:
                    raise ValueError(f"Estado de paso desconocido en {ruta.name}.")
                duracion = resultado.get("duration", 0)
                if not isinstance(duracion, (int, float)) or not math.isfinite(duracion) or duracion < 0:
                    raise ValueError(f"Duración inválida en {ruta.name}.")
                # Solo se publica vocabulario previamente revisado del catálogo local.
                rotulo = ficha.get("pasos", {}).get(paso.get("name", ""), f"Paso {numero}")
                pasos.append({
                    "numero": numero, "descripcion": rotulo,
                    "estado": estado_paso, "duracion_segundos": duracion,
                })
            escenarios.append({
                "caso": caso, "titulo": ficha.get("titulo", caso),
                "etiquetas": etiquetas, "estado": estado, "pasos": pasos,
                "duracion_pasos_segundos": sum(p["duracion_segundos"] for p in pasos),
            })
    if not escenarios:
        raise ValueError(f"El reporte {ruta.name} no contiene escenarios.")
    tipo = metadatos.get("tipo_hallazgo", "por_revisar")
    if tipo not in TIPOS:
        raise ValueError("Clasificación de hallazgo desconocida.")
    return {
        "id": ruta.stem, "archivo": ruta.name, "sha256_reporte": huella,
        "imagen": metadatos.get("imagen"),
        "fecha_cliente": metadatos.get("fecha_cliente"),
        "tipo_hallazgo": tipo,
        "nota_revision": metadatos.get("nota_revision", ""),
        "version_estable": metadatos.get("version_estable"),
        "escenarios": escenarios,
    }


def construir_html(resumen):
    escapar = lambda valor: html.escape(str(valor), quote=True)
    bloques = []
    for ejecucion in resumen["ejecuciones"]:
        for escenario in ejecucion["escenarios"]:
            estado = escenario["estado"]
            rotulo_estado = ESTADOS[estado]
            clase_estado = estado
            if estado == "passed" and ejecucion["version_estable"] is False:
                rotulo_estado = "Behave aprobado; contexto por revisar"
                clase_estado = "pending"
            filas = "".join(
                "<tr><td>{}</td><td>{}</td><td>{}</td><td>{:.3f} s</td></tr>".format(
                    p["numero"], escapar(p["descripcion"]),
                    ESTADOS[p["estado"]], p["duracion_segundos"]
                ) for p in escenario["pasos"]
            )
            imagen = escapar(ejecucion["imagen"] or "Sin versión de aplicación registrada")
            etiquetas = " → ".join(escapar(t) for t in escenario["etiquetas"])
            nota = escapar(ejecucion["nota_revision"] or "Sin nota de revisión registrada.")
            contexto = "Versión estable durante la ejecución." if ejecucion["version_estable"] is True else (
                "La versión cambió durante la ejecución." if ejecucion["version_estable"] is False
                else "No se registró una comparación de versión al inicio y al final."
            )
            bloques.append(f"""
<article>
<header><div><p class="identificador">{escapar(ejecucion["id"])}</p>
<h2>{escapar(escenario["titulo"])}</h2></div>
<span class="estado {clase_estado}">{rotulo_estado}</span></header>
<p class="traza">{etiquetas}</p>
<p><strong>Tipo de hallazgo:</strong> {TIPOS[ejecucion["tipo_hallazgo"]]}</p>
<p><strong>Nota de revisión:</strong> {nota}</p>
<details><summary>Ver pasos y contexto</summary>
<div class="tabla"><table><thead><tr><th>Paso</th><th>Comprobación</th><th>Resultado</th><th>Duración</th></tr></thead><tbody>{filas}</tbody></table></div>
<p><strong>Imagen de aplicación:</strong> <code>{imagen}</code></p>
<p>{contexto}</p>
<p>Duración acumulada de pasos: {escenario["duracion_pasos_segundos"]:.3f} s. No representa esfuerzo humano ni disponibilidad del sistema.</p>
<p><a href="../{escapar(ejecucion["archivo"])}">Reporte JSON original</a></p>
</details></article>""")
    cifras = resumen["totales"]
    tarjetas = "".join(
        f'<div class="cifra"><strong>{cifras[clave]}</strong><span>{rotulo}</span></div>'
        for clave, rotulo in (
            ("ejecuciones", "Reportes conservados"), ("casos_distintos", "Casos distintos"),
            ("aprobadas", "Ejecuciones aprobadas"), ("con_hallazgos", "Ejecuciones sin aprobación"),
        )
    )
    return """<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Documentación viva de pruebas de HCV</title>
<style>
:root{color-scheme:light;font-family:Segoe UI,Arial,sans-serif;color:#153249;background:#f1f5f8}
*{box-sizing:border-box}body{margin:0}main{max-width:1120px;margin:auto;padding:48px 28px}
h1{font-size:38px;line-height:1.15;margin:10px 0 18px}h2{font-size:21px;margin:4px 0 12px}
p{line-height:1.6}.introduccion{max-width:850px}.ceja{font-size:13px;font-weight:700;letter-spacing:1.6px;color:#1b756e}
.cifras{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:30px 0}
.cifra,article{background:#fff;border:1px solid #dbe5eb;border-radius:12px}
.cifra{padding:21px}.cifra strong{display:block;font-size:34px}.cifra span{font-size:14px;color:#4d6578}
article{padding:25px;margin:20px 0;break-inside:avoid}article header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}
.identificador{font-size:13px;color:#536a7b;margin:0;overflow-wrap:anywhere}.estado{font-size:13px;font-weight:700;padding:8px 12px;border-radius:20px;white-space:nowrap;background:#edf1f5}
.passed{background:#dff3ea;color:#126044}.failed,.error{background:#fde9e6;color:#9e3029}
.pending{background:#fff1cb;color:#765400}
.traza{font-size:14px;color:#176a70}.tabla{overflow-x:auto}table{width:100%;border-collapse:collapse;margin:18px 0;font-size:14px}
th,td{text-align:left;padding:12px;border-bottom:1px solid #e3eaf0;vertical-align:top}th{background:#eff5f8}
summary{cursor:pointer;font-weight:600;color:#176a70;padding:10px 0}code{font-size:12px;overflow-wrap:anywhere}
a{color:#146c78}footer{font-size:13px;color:#536a7b;margin-top:28px}
@media(max-width:650px){main{padding:28px 16px}.cifras{grid-template-columns:repeat(2,1fr)}h1{font-size:30px}article header{display:block}.estado{display:inline-block;margin:8px 0}}
@media print{body{background:white}main{padding:0}.cifras{gap:8px}article{border-radius:0}details{display:block}}
</style></head><body><main><p class="ceja">HISTORIAL CLÍNICO VISUAL · CONTROL DE CALIDAD</p>
<h1>Documentación viva de pruebas</h1>
<p class="introduccion">Evidencias conservadas de las ejecuciones de Behave. Cada resultado corresponde a su versión y contexto registrados. Una aprobación no reemplaza un fallo anterior ni acredita aceptación hospitalaria.</p>
""" + f'<section class="cifras" aria-label="Resumen de ejecuciones">{tarjetas}</section>' + (
        '<p>Los conteos corresponden a ejecuciones, no a pasos ni a cobertura de código. '
        'No se combinan versiones diferentes para calcular un porcentaje de calidad.</p>'
    ) + "".join(bloques) + """
<footer>Vista local generada desde los reportes originales y notas de revisión. Se excluyen trazas completas, nombres y valores arbitrarios de los reportes. Los rótulos de pasos proceden del catálogo revisado. Regenerar esta vista no ejecuta pruebas ni verifica el estado actual del servidor.</footer>
</main></body></html>"""


def generar(raiz=RAIZ):
    raiz = Path(raiz).resolve()
    carpeta = raiz / "reports/qc"
    registro = leer_json(raiz / "docs/qc/registro-ejecuciones-behave.json")
    por_archivo = {e["archivo"]: e for e in registro.get("ejecuciones", [])}
    ejecuciones = []
    rutas = [p for p in carpeta.glob("*.json") if PATRON_REPORTE.fullmatch(p.name)]
    rutas.sort(key=lambda p: re.search(r"\d{8}-\d{6}(?:-\d{6})?", p.name).group(), reverse=True)
    for ruta in rutas:
        if not PATRON_REPORTE.fullmatch(ruta.name):
            continue
        if not ruta.resolve().is_relative_to(carpeta.resolve()):
            raise ValueError("Un reporte apunta fuera del directorio de QC.")
        ejecuciones.append(resumir_reporte(ruta, por_archivo.get(ruta.name, {}), registro.get("casos", {})))
    escenarios = [s for e in ejecuciones for s in e["escenarios"]]
    resumen = {
        "totales": {
            "ejecuciones": len(ejecuciones),
            "casos_distintos": len({s["caso"] for s in escenarios}),
            "aprobadas": sum(all(s["estado"] == "passed" for s in e["escenarios"]) and e["version_estable"] is not False for e in ejecuciones),
            "con_hallazgos": sum(any(s["estado"] != "passed" for s in e["escenarios"]) or e["version_estable"] is False for e in ejecuciones),
        },
        "ejecuciones": ejecuciones,
    }
    salida = carpeta / "documentacion-viva"
    salida.mkdir(parents=True, exist_ok=True)
    (salida / "resumen.json").write_text(json.dumps(resumen, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (salida / "index.html").write_text(construir_html(resumen), encoding="utf-8")
    return resumen


def main():
    argparse.ArgumentParser(description=__doc__).parse_args()
    try:
        resumen = generar()
    except ValueError as error:
        raise SystemExit(str(error)) from None
    print("Vista actualizada: reports/qc/documentacion-viva/index.html")
    print(f'Reportes conservados: {resumen["totales"]["ejecuciones"]}; casos distintos: {resumen["totales"]["casos_distintos"]}.')


if __name__ == "__main__":
    main()
