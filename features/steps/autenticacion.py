from behave import given, when, then
from playwright.sync_api import Error as ErrorPlaywright, expect


def enviar_inicio_sesion(contexto, etiqueta, contrasena):
    pagina = contexto.pagina
    cuenta = contexto.cuentas[etiqueta]

    formulario = pagina.locator("#loginForm")
    boton_ingresar = formulario.get_by_role(
        "button", name="Ingresar", exact=True
    )

    expect(formulario).to_be_visible()

    formulario.get_by_label(
        "Usuario", exact=True
    ).fill(cuenta["usuario"])

    try:
        formulario.get_by_label(
            "Contraseña", exact=True
        ).fill(contrasena)
    except ErrorPlaywright:
        raise AssertionError(
            "No se pudo completar el campo de contraseña."
        ) from None

    with pagina.expect_response("**/api/auth/login") as intercambio:
        boton_ingresar.click()

    respuesta = intercambio.value

    if respuesta.status == 200:
        expect(pagina.locator("#appShell")).to_be_visible()
    else:
        expect(formulario.locator("#loginError")).to_be_visible()
        expect(boton_ingresar).to_be_enabled()

    return respuesta


@given("que existen las cuentas de prueba A y M activas")
def comprobar_cuentas_activas(contexto):
    pagina = contexto.pagina
    pagina.goto(contexto.url_base)

    for etiqueta in ("A", "M"):
        cuenta = contexto.cuentas[etiqueta]

        respuesta = enviar_inicio_sesion(
            contexto,
            etiqueta,
            cuenta["contrasena"],
        )

        assert respuesta.status == 200, (
            f"No se pudo verificar el ingreso de la cuenta {etiqueta}. "
            f"El servidor respondió HTTP {respuesta.status}. "
            "Revisá las credenciales, la cuenta y el entorno de pruebas."
        )

        expect(pagina.locator("#appShell")).to_be_visible()

        usuario = respuesta.json()["user"]
        cuenta["id"] = usuario["id"]

        with pagina.expect_response("**/api/auth/logout") as cierre:
            pagina.get_by_role(
                "button", name="Cerrar sesión", exact=True
            ).click()

        assert cierre.value.status == 204, (
            f"No se pudo confirmar el cierre de la cuenta {etiqueta}."
        )

        expect(pagina.locator("#loginForm")).to_be_visible()

    assert contexto.cuentas["A"]["id"] != contexto.cuentas["M"]["id"], (
        "TC-015 necesita dos cuentas diferentes."
    )


@given("que no hay una sesión iniciada en este navegador")
def comprobar_ausencia_de_sesion(contexto):
    pagina = contexto.pagina

    respuesta = pagina.request.get(
        f"{contexto.url_base}/api/auth/me"
    )

    assert respuesta.status == 401, (
        "El navegador debería estar sin sesión iniciada. "
        f"El servidor respondió HTTP {respuesta.status}."
    )

    expect(pagina.locator("#loginForm")).to_be_visible()
    expect(pagina.locator("#appShell")).to_be_hidden()


@given("que la cuenta M acumuló 12 intentos fallidos desde este navegador")
def acumular_intentos_fallidos(contexto):
    contrasena_incorrecta = "QC-TC015-incorrecta"

    if contrasena_incorrecta == contexto.cuentas["M"]["contrasena"]:
        contrasena_incorrecta += "-otra"

    contexto.estados_intentos = []

    for numero in range(1, 13):
        respuesta = enviar_inicio_sesion(
            contexto,
            "M",
            contrasena_incorrecta,
        )

        contexto.estados_intentos.append(respuesta.status)

        assert respuesta.status in (401, 429), (
            f"El intento incorrecto número {numero} respondió "
            f"HTTP {respuesta.status}. "
            "No se pudo completar la preparación prevista."
        )

        expect(contexto.pagina.locator("#loginError")).to_be_visible()
        expect(contexto.pagina.locator("#appShell")).to_be_hidden()

    print(
        "Respuestas de los 12 intentos fallidos:",
        contexto.estados_intentos,
    )


@when("intento ingresar inmediatamente con credenciales válidas de la cuenta A")
def ingresar_con_la_otra_cuenta(contexto):
    contexto.respuesta_cuenta_a = enviar_inicio_sesion(
        contexto,
        "A",
        contexto.cuentas["A"]["contrasena"],
    )


@then("debo acceder a la aplicación identificado como la cuenta A")
def comprobar_acceso_de_la_cuenta_a(contexto):
    respuesta = contexto.respuesta_cuenta_a

    assert respuesta.status == 200, (
        "La cuenta A no pudo ingresar después de los intentos fallidos. "
        f"El servidor respondió HTTP {respuesta.status}. "
        f"Retry-After: {respuesta.header_value('Retry-After') or 'no informado'}."
    )

    pagina = contexto.pagina
    expect(pagina.locator("#appShell")).to_be_visible()
    expect(pagina.locator("#loginForm")).to_be_hidden()

    consulta = pagina.request.get(
        f"{contexto.url_base}/api/auth/me"
    )

    assert consulta.status == 200, (
        "No se pudo confirmar la sesión de la cuenta A."
    )

    usuario = consulta.json()["user"]

    assert usuario["id"] == contexto.cuentas["A"]["id"], (
        "La sesión corresponde a una cuenta diferente de A."
    )

    nombre_visible = usuario.get("displayName") or usuario["username"]
    expect(pagina.locator("#currentUser")).to_have_text(nombre_visible)


@then("no se debe exigir una espera por los intentos fallidos anteriores")
def comprobar_ausencia_de_espera(contexto):
    espera = contexto.respuesta_cuenta_a.header_value("Retry-After")

    assert espera in (None, "0"), (
        f"El servidor indicó una espera mediante Retry-After: {espera}."
    )
