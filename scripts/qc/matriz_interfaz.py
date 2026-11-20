"""Recorridos de usuario reales con Playwright sobre el Docker beta existente."""
import argparse,json,time
from datetime import datetime,timezone
from playwright.sync_api import sync_playwright,expect
from ejecutar_matriz import Pruebas,PUBLICO,PRIVADO,URL

class Interfaz:
    def __init__(self,p):
        self.p=p;self.navegador=p.motor.chromium.launch(channel='chromium',headless=True)
        self.contextos=[];self.pagina=self.abrir();self.pagina.set_default_timeout(15000);self.pagina.set_default_navigation_timeout(30000)
        self.nombre_cuenta=p.admin.get('/api/auth/me').json()['user']['displayName']
        self.nombre=p.estado['paciente']['fullName'];self.id=p.estado['paciente']['id']
    def abrir(self,usuario=None,clave=None,navegador=None):
        c=(navegador or self.navegador).new_context(viewport={'width':1440,'height':1000});self.contextos.append(c)
        pagina=c.new_page();pagina.goto(URL);pagina.wait_for_load_state('networkidle')
        if usuario is not False:self.login(pagina,usuario or self.p.usuario,clave or self.p.contrasena)
        return pagina
    def login(self,pagina,usuario,clave):
        f=pagina.locator('#loginForm');f.locator('[name=username]').fill(usuario);f.locator('[name=password]').fill(clave);f.locator('button[type=submit]').click();expect(pagina.locator('#appShell')).to_be_visible();pagina.wait_for_load_state('networkidle')
    def seleccionar(self,pagina=None,paciente=None):
        pagina=pagina or self.pagina;paciente=paciente or self.p.estado['paciente']
        pagina.locator('#patientSearch').fill(paciente['fullName']);boton=pagina.locator('.patient-item[data-id="'+str(paciente['id'])+'"]');expect(boton).to_be_visible();boton.click();expect(pagina.locator('#patientName')).to_have_text(paciente['fullName']);pagina.wait_for_load_state('networkidle')
    def restablecer(self):
        self.pagina.evaluate('document.querySelectorAll("dialog[open]").forEach(d=>d.close())')
        self.pagina.goto(URL,wait_until='domcontentloaded');self.pagina.wait_for_load_state('networkidle');expect(self.pagina.locator('#appShell')).to_be_visible()
    def caso(self,n,objetivo,funcion):
        def accion():
            self.restablecer();funcion()
        self.p.caso(n,objetivo,accion,'Interfaz real con Playwright y Docker')
    def ejecutar(self):
        self.caso(1,'Iniciar sesión y comprobar identidad visible',lambda:expect(self.pagina.locator('#currentUser')).to_have_text(self.nombre_cuenta))
        def incorrecta():
            pagina=self.abrir(False);f=pagina.locator('#loginForm');f.locator('[name=username]').fill(self.p.usuario);f.locator('[name=password]').fill('ClaveIncorrectaQC');f.locator('button').click();expect(pagina.locator('#loginError')).to_be_visible();expect(pagina.locator('#appShell')).to_be_hidden()
        self.caso(2,'Rechazar credenciales incorrectas con mensaje visible',incorrecta)
        self.caso(3,'Conservar sesión e identidad después de recargar',lambda:(self.pagina.reload(),expect(self.pagina.locator('#currentUser')).to_have_text(self.nombre_cuenta)))
        def piloto():
            a=self.p.usuario_nuevo('medico');pagina=self.abrir(False)
            for _ in range(12):
                r=pagina.request.post(URL+'/api/auth/login',data={'username':a['username'],'password':'ErrorQC'});self.p.comprobar(r.status==401,'Intento incorrecto rechazado sin bloqueo')
            self.login(pagina,self.p.usuario,self.p.contrasena)
            self.p.comprobar(pagina.request.get(URL+'/api/auth/me').json()['user']['username']==self.p.usuario,'La otra cuenta ingresa y conserva su identidad')
        self.caso(6,'Ingresar con otra cuenta después de doce intentos fallidos',piloto)
        def sesiones(cerrar=False):
            chrome=self.p.motor.chromium.launch(channel='chrome',headless=True);edge=self.p.motor.chromium.launch(channel='msedge',headless=True)
            try:
                a=self.abrir(navegador=chrome);b=self.abrir(navegador=edge);self.seleccionar(a);self.seleccionar(b)
                if cerrar:a.locator('#logoutButton').click();expect(a.locator('#loginForm')).to_be_visible()
                else:a.reload();expect(a.locator('#appShell')).to_be_visible()
                b.reload();expect(b.locator('#appShell')).to_be_visible();self.seleccionar(b)
                self.p.comprobar(b.request.get(URL+'/api/auth/me').status==200,'La sesión del otro navegador continúa autorizada')
            finally:chrome.close();edge.close()
        self.caso(17,'Sesiones independientes con consulta en Chrome y Edge',sesiones)
        self.caso(18,'Cerrar Chrome conservando la sesión y consulta de Edge',lambda:sesiones(True))
        def atras():
            pagina=self.abrir();self.seleccionar(pagina);pagina.locator('#logoutButton').click();expect(pagina.locator('#loginForm')).to_be_visible();pagina.go_back();pagina.goto(URL);expect(pagina.locator('#loginForm')).to_be_visible();self.p.comprobar(pagina.request.get(URL+'/api/pacientes').status==401,'Tras cerrar sesión el acceso clínico sigue restringido')
        self.caso(19,'No recuperar ficha con Atrás después del cierre',atras)
        def formularios():
            pagina=self.abrir();pagina.locator('#newPatient').click();pagina.locator('#patientForm [name=fullName]').fill('BORRADOR QC NO GUARDADO');pagina.evaluate('document.querySelector("#patientDialog").close()');pagina.locator('#logoutButton').click();expect(pagina.locator('#loginForm')).to_be_visible();self.login(pagina,self.p.usuario,self.p.contrasena);pagina.locator('#newPatient').click();expect(pagina.locator('#patientForm [name=fullName]')).to_have_value('')
        self.caso(20,'No conservar borradores al cambiar de sesión',formularios)
        def desconectar_login():
            pagina=self.abrir(False);pagina.route('**/api/auth/login',lambda ruta:ruta.abort('internetdisconnected'));f=pagina.locator('#loginForm');f.locator('[name=username]').fill(self.p.usuario);f.locator('[name=password]').fill(self.p.contrasena);f.locator('button').click();expect(pagina.locator('#loginError')).to_be_visible();expect(pagina.locator('#appShell')).to_be_hidden()
        self.caso(23,'Mostrar error y permanecer sin sesión si falla la conexión de ingreso',desconectar_login)
        def crear_ui():
            nombre=self.p.prefijo+' Creado desde interfaz';self.pagina.locator('#newPatient').click();self.pagina.locator('#patientForm [name=fullName]').fill(nombre);self.pagina.locator('#patientForm button[type=submit]').click();expect(self.pagina.locator('#patientName')).to_have_text(nombre)
            self.p.comprobar(any(x['fullName']==nombre for x in self.p.peticion('get','/api/pacientes',params={'search':nombre}).json()['data']),'Ficha creada desde la interfaz y persistida en MariaDB')
        self.caso(5,'Crear paciente desde el formulario',crear_ui)
        def buscar_restaurar():
            self.pagina.locator('#patientSearch').fill(self.nombre);expect(self.pagina.locator('.patient-item[data-id="'+self.id+'"]')).to_be_visible();self.pagina.locator('#patientSearch').fill('');expect(self.pagina.locator('#patientCount')).not_to_have_text('0')
        self.caso(50,'Restaurar listado después de vaciar la búsqueda',buscar_restaurar)
        def busqueda_rapida():
            for texto in ['NoCoincideQC','OtraCadenaQC',self.nombre]:self.pagina.locator('#patientSearch').fill(texto)
            expect(self.pagina.locator('.patient-item')).to_have_count(1);expect(self.pagina.locator('.patient-item[data-id="'+self.id+'"]')).to_be_visible();self.p.comprobar(all(self.nombre in s for s in self.pagina.locator('.patient-item b').all_text_contents()),'Solo se muestra el resultado de la última búsqueda')
        self.caso(51,'Conservar la última búsqueda al escribir rápidamente',busqueda_rapida)
        def cien():
            for i in range(103):self.p.paciente(fullName=self.p.prefijo+' Pag '+str(i).zfill(3))
            self.pagina.locator('#patientSearch').fill(self.p.prefijo+' Pag');expect(self.pagina.locator('.patient-item')).to_have_count(103,timeout=15000)
        self.caso(52,'Acceder desde la interfaz a más de cien pacientes',cien)
        def cambiar_rapido():
            a=self.p.paciente(fullName=self.p.prefijo+' Cambio A');b=self.p.paciente(fullName=self.p.prefijo+' Cambio B');self.pagina.locator('#patientSearch').fill(self.p.prefijo+' Cambio');expect(self.pagina.locator('.patient-item')).to_have_count(2)
            self.pagina.locator('.patient-item[data-id="'+a['id']+'"]').click();self.pagina.locator('.patient-item[data-id="'+b['id']+'"]').click();expect(self.pagina.locator('#patientName')).to_have_text(b['fullName'])
        self.caso(53,'Mantener la última ficha seleccionada al cambiar rápidamente',cambiar_rapido)
        def cancelar_paciente():
            self.pagina.locator('#newPatient').click();self.pagina.locator('#patientForm [name=fullName]').fill(self.p.prefijo+' Cancelado');self.pagina.locator('#patientForm [data-dialog-cancel]').last.click();expect(self.pagina.locator('#patientDialog')).not_to_be_visible();self.p.comprobar(self.p.peticion('get','/api/pacientes',params={'search':self.p.prefijo+' Cancelado'}).json()['data']==[],'Cancelar el alta no crea ficha')
            self.seleccionar();self.pagina.locator('#editPatient').click();self.pagina.locator('#patientForm [name=fullName]').fill('NO GUARDAR');self.pagina.locator('#patientForm [data-dialog-cancel]').last.click();self.p.comprobar(self.p.peticion('get','/api/pacientes/'+self.id).json()['data']['fullName']==self.nombre,'Cancelar edición conserva el nombre original')
        self.caso(55,'Cancelar creación y edición sin persistir borradores',cancelar_paciente)
        def edad():
            hoy=datetime.now();nacimiento=f'{hoy.year-26}-01-01';a=self.p.paciente(fullName=self.p.prefijo+' Edad',birthDate=nacimiento);self.seleccionar(paciente=a);expect(self.pagina.locator('#patientMeta')).to_contain_text('26')
        self.caso(59,'Mostrar edad coherente con una fecha sencilla',edad)
        self.caso(60,'Mantener deshabilitada la eliminación de pacientes',lambda:(self.seleccionar(),expect(self.pagina.locator('#deletePatient')).to_be_disabled()))
        self.caso(65,'Conservar fecha del estudio al recargar y consultar desde Edge',self.fecha_estudio)
        self.caso(69,'Cancelar alta y edición de estudio sin persistir',self.cancelar_estudio)
        self.caso(73,'Ordenar estudios por fecha descendente',self.orden_estudios)
        self.caso(74,'Crear estudio con varias imágenes',lambda:self.crear_estudio_imagenes(False))
        self.caso(75,'Informar una imagen fallida sin duplicar el estudio guardado',lambda:self.crear_estudio_imagenes(True))
        self.caso(76,'Evitar altas duplicadas al pulsar Guardar estudio repetidamente',self.doble_estudio)
        self.caso(86,'Abrir contenido PDF mediante el enlace protegido',lambda:self.enlace_documento('pdf'))
        self.caso(87,'Mostrar imágenes admitidas con su contenido protegido',self.imagenes)
        self.caso(88,'Descargar documentos Word mediante los enlaces visibles',lambda:[self.enlace_documento(e) for e in ['doc','docx']])
        self.caso(89,'Descargar DICOM sin exigir visor integrado',lambda:self.enlace_documento('dcm'))
        self.caso(99,'Cancelar selector de archivo sin crear documentos',self.cancelar_archivo)
        self.caso(103,'Cancelar selector de reemplazo conservando el original',lambda:self.cancelar_archivo(True))
        self.caso(106,'Cancelar confirmación de eliminación conservando el documento',self.cancelar_borrado)
        self.caso(109,'Informar interrupción de carga sin mostrar éxito falso',self.interrumpir_carga)
        self.caso(132,'Cancelar formularios de alta y edición de usuarios',self.cancelar_usuario)
        self.caso(134,'Navegar más de cincuenta cuentas',self.paginar_usuarios)
        self.caso(137,'Cancelar desactivación sin alterar la cuenta',self.cancelar_desactivacion)
        self.caso(142,'Cancelar confirmación de cambio de contraseña',self.cancelar_contrasena)
        self.caso(146,'Evitar altas duplicadas de usuario por doble clic',self.doble_usuario)
        self.caso(179,'Recorrer controles principales con teclado',self.teclado)
        self.caso(180,'Operar formularios con ampliación al 200 por ciento',self.ampliacion)
        self.caso(181,'Representar entradas como texto sin ejecutar HTML',self.texto_seguro)
        self.caso(182,'Mantener Reportes como control reservado sin exportación',self.reportes_reservados)
        self.caso(183,'Recuperarse de una desconexión durante la consulta',self.consulta_desconectada)
        self.caso(184,'Recorrido básico de pacientes y estudios en Chrome y Edge',self.dos_navegadores)
        self.seleccionar();self.pagina.screenshot(path=str(PUBLICO/'consulta-sintetica.png'),full_page=True)
    def abrir_estudio(self):
        self.seleccionar();self.pagina.locator('[data-tab=studies]').click();self.pagina.wait_for_load_state('networkidle')
    def fecha_estudio(self):
        self.abrir_estudio();id=self.p.estado['estudio']['id'];self.pagina.locator('[data-edit-study="'+id+'"]').click();expect(self.pagina.locator('#studyForm [name=date]')).to_have_value('2026-11-01');expect(self.pagina.locator('#studyForm [name=date]')).to_be_disabled();self.pagina.locator('#studyForm [data-dialog-cancel]').last.click()
        edge=self.p.motor.chromium.launch(channel='msedge',headless=True)
        try:
            otra=self.abrir(navegador=edge);self.seleccionar(otra);otra.locator('[data-tab=studies]').click();otra.locator('[data-edit-study="'+id+'"]').click();expect(otra.locator('#studyForm [name=date]')).to_have_value('2026-11-01')
        finally:edge.close()
    def cancelar_estudio(self):
        self.abrir_estudio();antes=len(self.p.peticion('get','/api/pacientes/'+self.id+'/estudios').json()['data']);self.pagina.locator('#newStudy').click();self.pagina.locator('#studyForm [name=diagnosis]').fill('NO GUARDAR');self.pagina.locator('#studyForm [data-dialog-cancel]').last.click();self.p.comprobar(len(self.p.peticion('get','/api/pacientes/'+self.id+'/estudios').json()['data'])==antes,'Cancelar alta no crea estudio')
        e=self.p.estado['estudio'];self.pagina.locator('[data-edit-study="'+e['id']+'"]').click();self.pagina.locator('#studyForm [name=diagnosis]').fill('NO GUARDAR');self.pagina.locator('#studyForm [data-dialog-cancel]').last.click();self.p.comprobar(self.p.peticion('get','/api/estudios/'+e['id']).json()['data']['diagnosis']!='NO GUARDAR','Cancelar edición no cambia el estudio')
    def orden_estudios(self):
        self.abrir_estudio();fechas=self.pagina.locator('.study-card .study-top small').all_text_contents();self.p.comprobar(len(fechas)>1 and fechas==sorted(fechas,reverse=True),'Estudios ordenados por fecha descendente')
    def crear_estudio_imagenes(self,parcial):
        self.abrir_estudio();antes=self.p.peticion('get','/api/pacientes/'+self.id+'/estudios').json()['data'];self.pagina.locator('#newStudy').click();self.pagina.locator('#studyForm [name=date]').fill('2026-11-03')
        archivos=[{'name':'uno.png','mimeType':'image/png','buffer':self.p.archivo('png')},{'name':'dos.png','mimeType':'image/png','buffer':b'invalido' if parcial else self.p.archivo('png')}]
        self.pagina.locator('#studyForm [name=images]').set_input_files(archivos)
        with self.pagina.expect_event('dialog') as evento:self.pagina.locator('#studySaveButton').click()
        dialogo=evento.value;mensaje=dialogo.message;dialogo.dismiss();expect(self.pagina.locator('#studyDialog')).to_be_hidden(timeout=15000)
        if parcial:self.p.comprobar('1 de 2' in mensaje,'El aviso identifica la carga parcial')
        despues=self.p.peticion('get','/api/pacientes/'+self.id+'/estudios').json()['data'];nuevos=[x for x in despues if x['id'] not in {a['id'] for a in antes}];self.p.comprobar(len(nuevos)==1,'Se creó un único estudio');docs=self.p.peticion('get','/api/estudios/'+nuevos[0]['id']+'/documentos').json()['data'];self.p.comprobar(len(docs)==(1 if parcial else 2),'Se conserva el número esperado de imágenes válidas')
    def doble_estudio(self):
        self.abrir_estudio();antes=len(self.p.peticion('get','/api/pacientes/'+self.id+'/estudios').json()['data']);self.pagina.locator('#newStudy').click();self.pagina.locator('#studyForm [name=date]').fill('2026-11-04');self.pagina.locator('#studySaveButton').evaluate('b=>{b.click();b.click()}');expect(self.pagina.locator('#studyDialog')).to_be_hidden();self.p.comprobar(len(self.p.peticion('get','/api/pacientes/'+self.id+'/estudios').json()['data'])==antes+1,'El doble clic crea exactamente un estudio')
    def enlace_documento(self,extension):
        self.abrir_estudio();a=self.p.estado['documentos'][extension];contenedor=self.pagina.locator('[data-document-list="'+self.p.estado['estudio']['id']+'"]');enlace=contenedor.locator('a[href="/api/documentos/'+a['id']+'/download"]');expect(enlace).to_be_visible()
        if extension=='pdf':
            vista=contenedor.locator('a[href="/api/documentos/'+a['id']+'/content"]');expect(vista).to_be_visible()
            r=self.pagina.request.get(URL+'/api/documentos/'+a['id']+'/content');self.p.comprobar(r.status==200 and r.headers.get('content-type','').startswith('application/pdf'),'El enlace de visualización entrega un PDF protegido válido')
        with self.pagina.expect_download() as evento:enlace.click()
        descarga=evento.value;ruta=PRIVADO/('descarga.'+extension);descarga.save_as(str(ruta));self.p.comprobar(ruta.read_bytes()==self.p.archivo(extension),'Descarga del navegador idéntica al original')
    def imagenes(self):
        self.abrir_estudio()
        for e in ['jpg','jpeg','png','gif','webp']:
            id=self.p.estado['documentos'][e]['id'];selector='img[src="/api/documentos/'+id+'/content"]';imagen=self.pagina.locator(selector);imagen.scroll_into_view_if_needed();expect(imagen).to_be_visible();self.pagina.wait_for_function('(s)=>{const e=document.querySelector(s);return e&&e.complete&&e.naturalWidth>0}',arg=selector);self.p.comprobar(imagen.evaluate('e=>e.complete&&e.naturalWidth>0'),'La imagen '+e+' se decodifica en el navegador')
    def cancelar_archivo(self,reemplazo=False):
        self.abrir_estudio();id=self.p.estado['estudio']['id'];antes=self.p.peticion('get','/api/estudios/'+id+'/documentos').json()['data']
        boton=self.pagina.locator('[data-replace-document="'+self.p.estado['documentos']['pdf']['id']+'"]') if reemplazo else self.pagina.locator('[data-upload-document="'+id+'"]')
        with self.pagina.expect_file_chooser() as evento:boton.click()
        evento.value.set_files([]);self.pagina.wait_for_load_state('networkidle');despues=self.p.peticion('get','/api/estudios/'+id+'/documentos').json()['data'];self.p.comprobar(antes==despues,'Cancelar selección conserva los documentos')
    def cancelar_borrado(self):
        self.abrir_estudio();id=self.p.estado['documentos']['pdf']['id'];self.pagina.once('dialog',lambda d:d.dismiss());self.pagina.locator('[data-delete-document="'+id+'"]').click();self.p.comprobar(self.p.peticion('get','/api/documentos/'+id+'/download').body()==self.p.archivo(),'Documento conservado tras cancelar')
    def interrumpir_carga(self):
        self.abrir_estudio();id=self.p.estado['estudio']['id'];antes=len(self.p.peticion('get','/api/estudios/'+id+'/documentos').json()['data']);self.pagina.route('**/api/estudios/*/documentos',lambda r:r.abort('connectionreset') if r.request.method=='POST' else r.continue_())
        try:
            with self.pagina.expect_event('dialog') as evento:self.pagina.locator('[data-document-input="'+id+'"]').set_input_files({'name':'cortado.pdf','mimeType':'application/pdf','buffer':self.p.archivo()})
            dialogo=evento.value;mensaje=dialogo.message;dialogo.dismiss();self.p.comprobar('guardado y verificado' not in mensaje.lower() and bool(mensaje),'La interfaz informa el error y no un éxito de carga')
            self.p.comprobar(len(self.p.peticion('get','/api/estudios/'+id+'/documentos').json()['data'])==antes,'No se registra una carga que no llegó al servidor')
        finally:self.pagina.unroute('**/api/estudios/*/documentos')
    def abrir_usuarios(self):self.pagina.locator('#importData').click();expect(self.pagina.locator('#usersDialog')).to_be_visible()
    def cancelar_usuario(self):
        self.abrir_usuarios();self.pagina.locator('#newUser').click();self.pagina.locator('#userForm [name=username]').fill(self.p.prefijo+'cancelar');self.pagina.locator('#userForm [data-users-close]').last.click();expect(self.pagina.locator('#userDialog')).to_be_hidden();self.p.comprobar(self.p.peticion('get','/api/users',params={'search':self.p.prefijo+'cancelar'}).json()['data']==[],'Cancelar no crea una cuenta')
    def paginar_usuarios(self):
        for i in range(52):self.p.usuario_nuevo(nombre=self.p.prefijo+'pag'+str(i).zfill(2))
        self.abrir_usuarios();self.pagina.locator('#usersSearch').fill(self.p.prefijo+'pag');expect(self.pagina.locator('#usersList tr')).to_have_count(50,timeout=15000);self.pagina.locator('#usersNext').click();expect(self.pagina.locator('#usersList tr')).to_have_count(2);self.pagina.locator('#usersPrevious').click();expect(self.pagina.locator('#usersList tr')).to_have_count(50)
    def fila_usuario(self):
        a=self.p.usuario_nuevo(nombre=self.p.prefijo+'u'+str(time.time_ns())[-6:]);self.abrir_usuarios();self.pagina.locator('#usersSearch').fill(a['username']);fila=self.pagina.locator('#usersList tr').filter(has_text=a['username']);expect(fila).to_be_visible();return a,fila
    def cancelar_desactivacion(self):
        a,fila=self.fila_usuario();self.pagina.once('dialog',lambda d:d.dismiss());fila.get_by_role('button',name='Desactivar',exact=True).click();self.p.comprobar(self.p.sesion(a['username'],self.p.clave).get(URL+'/api/auth/me').status==200,'La cuenta sigue activa después de cancelar')
    def cancelar_contrasena(self):
        a,fila=self.fila_usuario();fila.get_by_role('button',name='Contraseña',exact=True).click();self.pagina.locator('#userPasswordForm [name=password]').fill(self.p.clave+'otra');self.pagina.locator('#userPasswordForm [name=passwordConfirmation]').fill(self.p.clave+'otra');self.pagina.once('dialog',lambda d:d.dismiss());self.pagina.locator('#userPasswordForm button[type=submit]').click();self.p.comprobar(self.p.sesion(a['username'],self.p.clave).get(URL+'/api/auth/me').status==200,'Cancelar conserva la contraseña anterior')
    def doble_usuario(self):
        self.abrir_usuarios();self.pagina.locator('#newUser').click();nombre=self.p.prefijo+'doble'+str(time.time_ns())[-5:]
        for campo,valor in {'username':nombre,'displayName':'Cuenta sintética doble clic','password':self.p.clave,'passwordConfirmation':self.p.clave}.items():self.pagina.locator('#userForm [name='+campo+']').fill(valor)
        self.pagina.locator('#userForm button[type=submit]').evaluate('b=>{b.click();b.click()}');expect(self.pagina.locator('#userDialog')).to_be_hidden();datos=self.p.peticion('get','/api/users',params={'search':nombre}).json()['data'];self.p.comprobar(len(datos)==1,'Un doble clic crea una única cuenta')
    def teclado(self):
        self.pagina.locator('#newPatient').focus();self.pagina.keyboard.press('Enter');expect(self.pagina.locator('#patientDialog')).to_be_visible();self.pagina.keyboard.press('Tab');self.pagina.locator('#patientForm [name=fullName]').focus();self.pagina.keyboard.insert_text(self.p.prefijo+' Teclado');self.pagina.locator('#patientForm button[type=submit]').focus();self.pagina.keyboard.press('Enter');expect(self.pagina.locator('#patientName')).to_have_text(self.p.prefijo+' Teclado')
    def reportes_reservados(self):
        descargas=[];peticiones=[]
        self.pagina.on('download',lambda d:descargas.append(d))
        def observar(r):
            if r.method not in ['GET','HEAD']:peticiones.append(r.method)
        self.pagina.on('request',observar);self.pagina.locator('#exportData').click();self.seleccionar();self.pagina.remove_listener('request',observar)
        self.p.comprobar(not descargas and not peticiones,'Reportes no descarga ni modifica datos y la consulta sigue disponible')
    def ampliacion(self):
        self.pagina.evaluate('document.documentElement.style.zoom="2"');self.pagina.locator('#newPatient').click();expect(self.pagina.locator('#patientDialog')).to_be_visible();self.pagina.locator('#patientForm [name=fullName]').fill(self.p.prefijo+' Ampliación');self.pagina.locator('#patientForm button[type=submit]').click();expect(self.pagina.locator('#patientName')).to_have_text(self.p.prefijo+' Ampliación');self.pagina.evaluate('document.documentElement.style.zoom=""')
    def texto_seguro(self):
        texto=self.p.prefijo+' <img src=x onerror="window.falloQc=1">';a=self.p.paciente(fullName=texto);self.seleccionar(paciente=a);expect(self.pagina.locator('#patientName')).to_have_text(texto);self.p.comprobar(self.pagina.evaluate('window.falloQc===undefined'),'El texto no ejecuta HTML ni JavaScript')
    def consulta_desconectada(self):
        self.pagina.route('**/api/pacientes?*',lambda r:r.abort('internetdisconnected'));self.pagina.locator('#patientSearch').fill('consulta desconectada');expect(self.pagina.locator('#patientList')).to_contain_text('No se pudo');self.pagina.unroute('**/api/pacientes?*');self.pagina.locator('#patientSearch').fill(self.nombre);expect(self.pagina.locator('.patient-item[data-id="'+self.id+'"]')).to_be_visible()
    def dos_navegadores(self):
        for canal in ['chrome','msedge']:
            navegador=self.p.motor.chromium.launch(channel=canal,headless=True)
            try:
                pagina=self.abrir(navegador=navegador);self.seleccionar(pagina);pagina.locator('[data-tab=studies]').click();expect(pagina.locator('[data-edit-study="'+self.p.estado['estudio']['id']+'"]')).to_be_visible()
            finally:navegador.close()
    def cerrar(self):
        for c in self.contextos:
            try:c.request.post(URL+'/api/auth/logout');c.close()
            except Exception:pass
        self.navegador.close()

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--casos');args=parser.parse_args()
    with sync_playwright() as motor:
        p=Pruebas(motor);p.inicio=datetime.now(timezone.utc).isoformat();p.identificador='MATRIZ-'+datetime.now().strftime('%Y%m%d-%H%M%S')+'-ui';p.fase='ui';p.entorno={};p.seleccion={int(x) for x in args.casos.split(',')} if args.casos else None
        ui=Interfaz(p)
        try:ui.ejecutar()
        finally:ui.cerrar();p.cerrar();p.guardar_reporte()
if __name__=='__main__':main()
