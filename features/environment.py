from playwright.sync_api import sync_playwright
from getpass import getpass
from os import environ


def before_all(contexto):
    contexto.url_base = "http://127.0.0.1:3002"
    contexto.cuentas = {}

    for etiqueta in ("A", "M"):
        usuario = environ.get(f"HCV_QC_USUARIO_{etiqueta}")
        if usuario is None:
            usuario = input(
                f"Nombre de usuario de la cuenta {etiqueta}: "
            )
        usuario = usuario.strip()

        contrasena = environ.get(f"HCV_QC_CONTRASENA_{etiqueta}")
        if contrasena is None:
            contrasena = getpass(
                f"Contraseña de la cuenta {etiqueta}: "
            )

        if not usuario or not contrasena:
            raise ValueError(
                "Las dos cuentas deben tener usuario y contraseña."
            )

        contexto.cuentas[etiqueta] = {
            "usuario": usuario,
            "contrasena": contrasena,
        }

    if contexto.cuentas["A"]["usuario"] == contexto.cuentas["M"]["usuario"]:
        raise ValueError(
            "TC-015 necesita dos cuentas diferentes."
        )


def before_scenario(contexto, escenario):
    contexto.playwright = sync_playwright().start()
    contexto.add_cleanup(contexto.playwright.stop)

    contexto.navegador = contexto.playwright.chromium.launch(
        channel="chromium",
        headless=True,
    )
    contexto.add_cleanup(contexto.navegador.close)

    contexto.contexto_navegador = contexto.navegador.new_context()
    contexto.add_cleanup(contexto.contexto_navegador.close)

    contexto.pagina = contexto.contexto_navegador.new_page()
