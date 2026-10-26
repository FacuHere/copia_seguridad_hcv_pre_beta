"""Prueba de UI con respuestas sintéticas. No inicia HCV ni se conecta a MariaDB.
Requiere Playwright y Chromium ya instalados. Ejecutar: python test/browser/users-ui.py
"""
import json
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

RAIZ = Path(__file__).resolve().parents[2] / 'public'
PERMISOS = ['users.manage', 'roles.manage', 'patients.read', 'patients.create', 'patients.update',
            'studies.read', 'studies.create', 'studies.update', 'documents.read',
            'documents.upload', 'documents.replace', 'documents.delete', 'documents.download', 'images.read']


def probar():
    cuentas = [{'id': '1', 'username': 'admin_sintetico', 'displayName': 'Administración de prueba', 'isActive': True, 'roles': ['administrador']}]
    escrituras = []
    errores = []
    permisos = PERMISOS.copy()

    def responder(ruta):
        solicitud = ruta.request
        destino = solicitud.url.removeprefix('http://hcv.test')
        if destino.startswith('/api/'):
            if solicitud.method != 'GET':
                escrituras.append((solicitud.method, destino, solicitud.post_data_json))
            if destino == '/api/auth/me':
                cuerpo = {'user': cuentas[0]}
            elif destino == '/api/auth/permisos':
                cuerpo = {'permissions': permisos}
            elif destino.startswith('/api/pacientes'):
                cuerpo = {'data': []}
            elif destino.startswith('/api/usuarios') and solicitud.method == 'GET':
                cuerpo = {'data': cuentas, 'page': 1, 'pageSize': 50}
            elif destino == '/api/usuarios' and solicitud.method == 'POST':
                datos = solicitud.post_data_json
                cuenta = {'id': '2', 'username': datos['username'], 'displayName': datos['displayName'], 'isActive': True, 'roles': [datos['role']]}
                cuentas.append(cuenta)
                cuerpo = {'data': cuenta}
            elif destino.endswith('/password'):
                ruta.fulfill(status=204)
                return
            else:
                cuerpo = {'data': cuentas[-1]}
            ruta.fulfill(status=201 if solicitud.method == 'POST' else 200, json=cuerpo)
            return
        archivo = RAIZ / (destino.lstrip('/') or 'index.html')
        if archivo.is_file() and archivo.resolve().is_relative_to(RAIZ.resolve()):
            tipos = {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css'}
            ruta.fulfill(path=str(archivo), content_type=tipos.get(archivo.suffix, 'application/octet-stream'))
        else:
            ruta.fulfill(status=404)

    with sync_playwright() as p:
        navegador = p.chromium.launch(headless=True)
        try:
            pagina = navegador.new_page(viewport={'width': 1400, 'height': 1000})
            pagina.route('http://hcv.test/**', responder)
            pagina.on('pageerror', lambda error: errores.append(str(error)))
            pagina.on('dialog', lambda dialogo: dialogo.accept())
            pagina.goto('http://hcv.test/')
            pagina.wait_for_load_state('networkidle')
            pagina.get_by_role('button', name='Gestión de usuarios').click()
            expect(pagina.locator('#usersList')).to_contain_text('admin_sintetico')
            pagina.get_by_role('button', name='+ Nuevo usuario').click()
            pagina.locator('#userForm').get_by_role('button', name='Guardar usuario').click()
            assert not escrituras, 'Un formulario inválido no debe guardar.'
            pagina.locator('#userForm').get_by_role('button', name='Cancelar').click()
            expect(pagina.locator('#userDialog')).not_to_be_visible()
            assert not escrituras
            pagina.get_by_role('button', name='+ Nuevo usuario').click()
            pagina.locator('#userForm input[name=username]').fill('medico_prueba')
            pagina.locator('#userForm input[name=displayName]').fill('<b>Nombre sintético</b>')
            pagina.locator('#userForm select[name=role]').select_option('medico')
            pagina.locator('#userForm input[name=password]').fill('Contrasena sintetica prueba')
            pagina.locator('#userForm input[name=passwordConfirmation]').fill('Contrasena sintetica prueba')
            pagina.locator('#userForm').get_by_role('button', name='Guardar usuario').click()
            expect(pagina.locator('#userDialog')).not_to_be_visible()
            expect(pagina.locator('#usersList')).to_contain_text('<b>Nombre sintético</b>')
            assert pagina.locator('#usersList b').count() == 0, 'El nombre debe tratarse como texto.'
            assert len(escrituras) == 1 and escrituras[0][2]['role'] == 'medico'
            fila = pagina.locator('#usersList tr').filter(has_text='medico_prueba')
            fila.get_by_role('button', name='Editar', exact=True).click()
            pagina.locator('#userForm input[name=displayName]').fill('No guardar')
            pagina.locator('#userForm').get_by_role('button', name='Cerrar formulario').click()
            assert len(escrituras) == 1, 'Cerrar no debe editar.'
            fila.get_by_role('button', name='Contraseña', exact=True).click()
            pagina.locator('#userPasswordForm input[name=password]').fill('Otra contrasena sintetica')
            pagina.locator('#userPasswordForm input[name=passwordConfirmation]').fill('Otra contrasena sintetica')
            pagina.locator('#userPasswordForm').get_by_role('button', name='Cambiar contraseña').click()
            expect(pagina.locator('#userPasswordDialog')).not_to_be_visible()
            assert escrituras[-1][1] == '/api/usuarios/2/password'
            expect(pagina.locator('#userPasswordForm input[name=password]')).to_have_value('')
            carpeta = Path(tempfile.mkdtemp(prefix='hcv-users-ui-'))
            pagina.screenshot(path=str(carpeta / 'usuarios-desktop.png'), full_page=True)
            pagina.set_viewport_size({'width': 390, 'height': 844})
            pagina.screenshot(path=str(carpeta / 'usuarios-mobile.png'), full_page=True)
            permisos.clear()
            permisos.extend(['patients.read', 'studies.read', 'documents.read', 'documents.download', 'images.read'])
            pagina.reload()
            pagina.wait_for_load_state('networkidle')
            expect(pagina.locator('#importData')).to_be_hidden()
            expect(pagina.locator('#newPatient')).to_be_hidden()
            expect(pagina.locator('#newStudy')).to_be_hidden()
            assert not errores, errores
            print('PASS: UI sintética, validación, cancelación, alta, cambio de contraseña, escape HTML y controles de lectura.')
            print(f'Capturas: {carpeta}')
        finally:
            navegador.close()


if __name__ == '__main__':
    probar()
