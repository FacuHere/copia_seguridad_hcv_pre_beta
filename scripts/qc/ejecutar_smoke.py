"""Smoke acotado de acceso y consulta en Docker beta, sin altas clínicas."""
import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import time
from getpass import getpass
from pathlib import Path

from playwright.sync_api import Error as ErrorPlaywright, expect, sync_playwright

from ejecutar_behave import CONTENEDOR, hora_cliente
from generar_documentacion_viva import RAIZ

URL_BASE = "http://127.0.0.1:3002"
CONTENEDOR_BASE = "hcv_docker_beta_test-db-1"
PLAN = [
    ("SMK-01", "Entorno Docker beta identificado y saludable"),
    ("SMK-02", "Salud de MariaDB y almacenamiento"),
    ("SMK-03", "Formulario de ingreso y acceso anónimo restringido"),
    ("SMK-04", "Ingreso de la cuenta administrativa de pruebas"),
    ("SMK-05", "Identidad y sesión conservadas al recargar"),
    ("SMK-06", "Consulta del listado de pacientes"),
    ("SMK-07", "Acceso al listado administrativo de usuarios"),
    ("SMK-08", "Cierre de sesión y acceso nuevamente restringido"),
    ("SMK-09", "Ausencia de excepciones JavaScript no controladas"),
    ("SMK-10", "Contenedores e imágenes estables al finalizar"),
]


class FalloSmoke(Exception):
    """Diferencia observable respecto del esperado, con mensaje revisado."""


class BloqueoSmoke(Exception):
    """Precondición o herramienta que impide completar la evaluación."""


def validar_entorno(entorno):
    for servicio in ("api", "db"):
        datos = entorno.get(servicio, {})
        if datos.get("proyecto") != "hcv_docker_beta_test" or datos.get("servicio") != servicio:
            raise BloqueoSmoke("El destino no corresponde al proyecto Docker beta previsto.")
        if datos.get("estado") != "running" or datos.get("salud") != "healthy":
            raise BloqueoSmoke("Un contenedor beta no está iniciado y saludable.")
        if not datos.get("imagen", "").startswith("sha256:") or not datos.get("id") or not datos.get("inicio"):
            raise BloqueoSmoke("No se pudo identificar completamente la versión de pruebas.")
    publicados = entorno["api"].get("puertos", {}).get("3000/tcp") or []
    if publicados != [{"HostIp": "127.0.0.1", "HostPort": "3002"}]:
        raise BloqueoSmoke("La API beta no publica exclusivamente la dirección local prevista.")


def consultar_entorno():
    ejecutable = shutil.which("docker")
    if not ejecutable:
        raise BloqueoSmoke("Docker no está disponible.")
    formato = ('{{.Image}}|{{.Id}}|{{.State.Status}}|{{.State.Health.Status}}|'
               '{{.State.StartedAt}}|{{index .Config.Labels "com.docker.compose.project"}}|'
               '{{index .Config.Labels "com.docker.compose.service"}}|{{json .NetworkSettings.Ports}}')
    try:
        respuesta = subprocess.run(
            [ejecutable, "inspect", "--format", formato, CONTENEDOR, CONTENEDOR_BASE],
            capture_output=True, text=True, timeout=20, check=False,
        )
        if respuesta.returncode:
            raise BloqueoSmoke("No se pudieron consultar los contenedores beta.")
        entorno = {}
        for linea in respuesta.stdout.strip().splitlines():
            partes = linea.split("|", 7)
            if len(partes) != 8:
                raise BloqueoSmoke("Docker devolvió un contexto incompleto.")
            imagen, identificador, estado, salud, inicio, proyecto, servicio, puertos = partes
            entorno[servicio] = dict(imagen=imagen, id=identificador, estado=estado,
                                    salud=salud, inicio=inicio, proyecto=proyecto,
                                    servicio=servicio, puertos=json.loads(puertos))
        validar_entorno(entorno)
        return entorno
    except (subprocess.TimeoutExpired, OSError, ValueError, TypeError):
        raise BloqueoSmoke("No se pudo obtener un contexto Docker válido dentro del tiempo previsto.") from None


def contexto_estable(inicial, final):
    return all(inicial.get(s, {}).get(k) == final.get(s, {}).get(k) is not None
               for s in ("api", "db") for k in ("imagen", "id", "inicio"))


def resumir_estado(pasos, estable):
    if estable is not True or any(p["estado"] == "bloqueado" for p in pasos):
        return "bloqueado"
    if any(p["estado"] == "fallido" for p in pasos):
        return "fallido"
    if [p["id"] for p in pasos] != [i for i, _ in PLAN] or any(p["estado"] != "aprobado" for p in pasos):
        return "bloqueado"
    return "aprobado"


def exigir(condicion, mensaje):
    if not condicion:
        raise FalloSmoke(mensaje)


def leer_respuesta(respuesta, esperado):
    exigir(respuesta.status == esperado, f"Se esperaba HTTP {esperado}; se recibió HTTP {respuesta.status}.")
    try:
        datos = respuesta.json()
    except (ValueError, TypeError):
        raise FalloSmoke("La respuesta no contiene JSON válido.") from None
    exigir(isinstance(datos, dict), "La respuesta no es el objeto JSON esperado.")
    return datos


def ejecutar_paso(pasos, identificador, accion):
    paso = next(p for p in pasos if p["id"] == identificador)
    inicio = time.perf_counter()
    try:
        accion()
        paso.update(estado="aprobado", observacion="Criterio comprobado.")
    except (FalloSmoke, BloqueoSmoke) as error:
        paso.update(estado="fallido" if isinstance(error, FalloSmoke) else "bloqueado",
                    observacion=str(error))
    except ErrorPlaywright:
        paso.update(estado="fallido", observacion="La interacción no alcanzó el estado esperado; causa por revisar.")
    except Exception:
        paso.update(estado="bloqueado", observacion="La herramienta no pudo completar la comprobación; causa por revisar.")
    paso["duracion_segundos"] = round(time.perf_counter() - inicio, 6)
    print(f"{identificador}: {paso['estado']} — {paso['titulo']}")
    return paso["estado"] == "aprobado"


def ejecutar():
    fecha = hora_cliente()
    pasos = [dict(id=i, titulo=t, estado="no_ejecutado") for i, t in PLAN]
    contexto = {"inicial": None, "final": None}
    navegador_version = None
    limpieza = None
    inicio = time.perf_counter()

    def identificar():
        contexto["inicial"] = consultar_entorno()

    if ejecutar_paso(pasos, "SMK-01", identificar):
        usuario = os.environ.get("HCV_QC_USUARIO_A") or input("Usuario administrativo de pruebas: ").strip()
        contrasena = os.environ.get("HCV_QC_CONTRASENA_A") or getpass("Contraseña (no se guarda): ")
        if not usuario or not contrasena:
            def informar_credenciales_ausentes():
                raise BloqueoSmoke("Faltan credenciales de la cuenta de pruebas.")
            ejecutar_paso(pasos, "SMK-04", informar_credenciales_ausentes)
        else:
            try:
                with sync_playwright() as herramienta:
                    navegador = herramienta.chromium.launch(channel="chromium", headless=True)
                    navegador_version = navegador.version
                    sesion = navegador.new_context()
                    pagina = sesion.new_page()
                    pagina.set_default_timeout(7000)
                    pagina.set_default_navigation_timeout(15000)
                    errores_pagina = []
                    pagina.on("pageerror", lambda _: errores_pagina.append(True))
                    identidad = {}
                    sesion_iniciada = False

                    def salud():
                        base = leer_respuesta(sesion.request.get(URL_BASE + "/api/health/database", timeout=10000), 200)
                        exigir(base.get("status") == "ok" and base.get("database") == "connected", "MariaDB no informa conexión saludable.")
                        archivos = leer_respuesta(sesion.request.get(URL_BASE + "/api/health/storage", timeout=10000), 200)
                        exigir(archivos.get("status") == "ready", "El almacenamiento no informa estado ready.")

                    def acceso_anonimo():
                        respuesta = pagina.goto(URL_BASE)
                        exigir(respuesta is not None and respuesta.status == 200, "La página inicial no respondió HTTP 200.")
                        pagina.wait_for_load_state("networkidle")
                        expect(pagina.locator("#loginForm")).to_be_visible()
                        expect(pagina.locator("#appShell")).to_be_hidden()
                        for ruta in ("/api/auth/me", "/api/pacientes"):
                            exigir(sesion.request.get(URL_BASE + ruta, timeout=10000).status == 401, "Una ruta protegida no rechazó el acceso anónimo con HTTP 401.")

                    def ingresar():
                        nonlocal sesion_iniciada
                        formulario = pagina.locator("#loginForm")
                        formulario.get_by_label("Usuario", exact=True).fill(usuario)
                        formulario.get_by_label("Contraseña", exact=True).fill(contrasena)
                        with pagina.expect_response("**/api/auth/login") as intercambio:
                            formulario.get_by_role("button", name="Ingresar", exact=True).click()
                        sesion_iniciada = intercambio.value.status == 200
                        datos = leer_respuesta(intercambio.value, 200)
                        exigir(isinstance(datos.get("user"), dict), "El ingreso no devolvió la identidad esperada.")
                        identidad.update(datos["user"])
                        exigir(identidad.get("username") == usuario, "La identidad devuelta no coincide con la cuenta prevista.")
                        expect(pagina.locator("#appShell")).to_be_visible()
                        expect(formulario).to_be_hidden()

                    def recargar():
                        pagina.reload()
                        pagina.wait_for_load_state("networkidle")
                        expect(pagina.locator("#appShell")).to_be_visible()
                        datos = leer_respuesta(sesion.request.get(URL_BASE + "/api/auth/me", timeout=10000), 200)
                        exigir(datos.get("user", {}).get("id") == identidad.get("id") and identidad.get("id") is not None, "La sesión no conserva la identidad prevista.")
                        expect(pagina.locator("#currentUser")).to_have_text(identidad["displayName"])

                    def pacientes():
                        datos = leer_respuesta(sesion.request.get(URL_BASE + "/api/pacientes", timeout=10000), 200)
                        exigir(isinstance(datos.get("data"), list), "No se obtuvo un listado de pacientes válido.")
                        expect(pagina.get_by_placeholder("Buscar por nombre o DNI", exact=True)).to_be_visible()

                    def usuarios():
                        expect(pagina.get_by_role("button", name="Gestión de usuarios", exact=True)).to_be_visible()
                        datos = leer_respuesta(sesion.request.get(URL_BASE + "/api/usuarios", timeout=10000), 200)
                        exigir(isinstance(datos.get("data"), list), "No se obtuvo un listado administrativo válido.")

                    def cerrar():
                        nonlocal sesion_iniciada, limpieza
                        with pagina.expect_response("**/api/auth/logout") as intercambio:
                            pagina.get_by_role("button", name="Cerrar sesión", exact=True).click()
                        exigir(intercambio.value.status == 204, "El cierre de sesión no respondió HTTP 204.")
                        sesion_iniciada = False
                        limpieza = True
                        expect(pagina.locator("#loginForm")).to_be_visible()
                        expect(pagina.locator("#appShell")).to_be_hidden()
                        for ruta in ("/api/auth/me", "/api/pacientes"):
                            exigir(sesion.request.get(URL_BASE + ruta, timeout=10000).status == 401, "El recurso protegido sigue accesible con la sesión cerrada.")

                    try:
                        acciones = [("SMK-02", salud), ("SMK-03", acceso_anonimo),
                                    ("SMK-04", ingresar), ("SMK-05", recargar),
                                    ("SMK-06", pacientes), ("SMK-07", usuarios), ("SMK-08", cerrar)]
                        for identificador, accion in acciones:
                            if not ejecutar_paso(pasos, identificador, accion):
                                break
                        ejecutar_paso(pasos, "SMK-09", lambda: exigir(not errores_pagina, "Se detectaron excepciones JavaScript no controladas."))
                    finally:
                        if sesion_iniciada or pasos[3]["estado"] in ("fallido", "bloqueado"):
                            try:
                                comprobacion = sesion.request.get(URL_BASE + "/api/auth/me", timeout=10000)
                                limpieza = comprobacion.status == 401 or (comprobacion.status == 200 and sesion.request.post(URL_BASE + "/api/auth/logout", timeout=10000).status == 204)
                            except ErrorPlaywright:
                                limpieza = False
                        sesion.close()
                        navegador.close()
            except Exception:
                if all(p["estado"] == "no_ejecutado" for p in pasos[1:9]):
                    pasos[1].update(estado="bloqueado", observacion="No se pudo preparar Playwright/Chromium; revisar la instalación local.")
                else:
                    pasos[8].update(estado="bloqueado", observacion="No se pudo completar o cerrar el entorno del navegador.")
            finally:
                contrasena = None
                usuario = None

    def verificar_version():
        contexto["final"] = consultar_entorno()
        if not contexto_estable(contexto["inicial"] or {}, contexto["final"]):
            raise BloqueoSmoke("Cambió la imagen, el contenedor o su inicio durante la evaluación.")

    ejecutar_paso(pasos, "SMK-10", verificar_version)
    estable = contexto_estable(contexto["inicial"] or {}, contexto["final"] or {})
    estado = resumir_estado(pasos, estable)
    reporte = dict(
        id=f"SMOKE-{fecha:%Y%m%d-%H%M%S-%f}", fecha_inicio=fecha.isoformat(),
        fecha_fin=hora_cliente().isoformat(), ejecutor="herramienta QC local", url=URL_BASE,
        alcance="Acceso y consulta básica; salud de dependencias. Sin altas clínicas ni verificación funcional de archivos/restauraciones.",
        estado=estado, autoriza_profundizar=estado == "aprobado", pasos=pasos,
        entorno=contexto, contexto_estable=estable, navegador=navegador_version,
        sistema=platform.system(), limpieza_sesion_confirmada=limpieza,
        duracion_segundos=round(time.perf_counter() - inicio, 6),
        sha256_herramienta=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    )
    carpeta = RAIZ / "reports/qc/unidad5"
    carpeta.mkdir(parents=True, exist_ok=True)
    ruta = carpeta / (reporte["id"] + ".json")
    contenido = json.dumps(reporte, ensure_ascii=False, indent=2) + "\n"
    with ruta.open("x", encoding="utf-8") as archivo:
        archivo.write(contenido)
    huella = hashlib.sha256(ruta.read_bytes()).hexdigest()
    ruta.with_suffix(".sha256").write_text(huella + "\n", encoding="ascii")
    print(f"Smoke {estado}. Reporte: {ruta}")
    return 0 if estado == "aprobado" else 1 if estado == "fallido" else 2


def main():
    analizador = argparse.ArgumentParser(description=__doc__)
    analizador.parse_args()
    try:
        return ejecutar()
    except (EOFError, KeyboardInterrupt):
        print("Ejecución interrumpida o sin entrada de credenciales; no se acredita aprobación.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
