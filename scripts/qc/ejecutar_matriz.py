"""Pruebas funcionales trazables sobre la instalación Docker beta existente.

Solo datos de ensayo. Los reportes públicos contienen comprobaciones y estados,
no cookies, contraseñas ni cuerpos clínicos. La preparación privada queda en storage/qc.
"""
import argparse
import base64
import hashlib
import json
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

RAIZ=Path(__file__).resolve().parents[2]
PUBLICO=RAIZ/'reports/qc/matriz-ejecucion-20261117'
PRIVADO=RAIZ/'storage/qc/matriz-20261117'
URL='http://127.0.0.1:3002'
PUBLICO.mkdir(parents=True,exist_ok=True);PRIVADO.mkdir(parents=True,exist_ok=True)

class CasoBloqueado(Exception):
    """Una precondición ausente impide evaluar el comportamiento especificado."""

class Pruebas:
    def __init__(self,motor):
        self.motor=motor;self.registros=[];self.actual=None;self.sesiones=[]
        self.estado=json.loads((PRIVADO/'estado.json').read_text(encoding='utf8')) if (PRIVADO/'estado.json').exists() else {}
        self.prefijo=self.estado.setdefault('prefijo','qc'+datetime.now().strftime('%m%d%H%M%S'))
        self.clave=self.estado.setdefault('clave',base64.urlsafe_b64encode(os.urandom(18)).decode())
        self.usuario=os.environ['HCV_QC_USUARIO_A'];self.contrasena=os.environ['HCV_QC_CONTRASENA_A']
        self.admin=self.sesion(self.usuario,self.contrasena)
        self.anterior=None
        self.guardar_estado()
    def guardar_estado(self):
        (PRIVADO/'estado.json').write_text(json.dumps(self.estado,ensure_ascii=False,indent=2),encoding='utf8')
    def sesion(self,usuario=None,clave=None):
        c=self.motor.request.new_context(base_url=URL,timeout=25000);self.sesiones.append(c)
        if usuario:
            r=c.post('/api/auth/login',data={'username':usuario,'password':clave})
            assert r.status==200,'No se pudo preparar la sesión de ensayo.'
        return c
    def comprobar(self,condicion,mensaje):
        if self.actual is not None:self.actual['comprobaciones'].append({'criterio':mensaje,'cumple':bool(condicion)})
        assert condicion,mensaje
    def peticion(self,metodo,ruta,esperado=200,datos=None,cliente=None,**opciones):
        c=cliente or self.admin
        ruta=ruta.replace('/api/users','/api/usuarios')
        r=getattr(c,metodo)(ruta,**({'data':datos} if datos is not None else {}),**opciones)
        esperados=esperado if isinstance(esperado,(tuple,list,set)) else [esperado]
        if self.actual is not None:self.actual['http'].append({'metodo':metodo.upper(),'ruta':ruta,'esperado':list(esperados),'obtenido':r.status})
        if r.status>=400 and self.actual is not None:
            try:self.actual['http'][-1]['codigo_error']=r.json().get('error',{}).get('code')
            except Exception:pass
        self.comprobar(r.status in esperados,f'{metodo.upper()} {ruta}: HTTP {r.status}; esperado {list(esperados)}')
        return r
    def caso(self,numero,objetivo,accion,canal='API real en Docker'):
        if getattr(self,'seleccion',None) and numero not in self.seleccion:return
        self.actual={'caso':f'TC-{numero:03}','objetivo':objetivo,'canal':canal,'inicio':datetime.now(timezone.utc).isoformat(),'http':[],'comprobaciones':[]}
        inicio=time.monotonic()
        try:
            accion();self.actual['estado']='aprobado'
        except CasoBloqueado as error:
            self.actual['estado']='bloqueado';self.actual['observacion']=str(error)
        except Exception as error:
            self.actual['estado']='fallido';self.actual['error_tipo']=type(error).__name__
            self.actual['observacion']=str(error)[:600] if isinstance(error,AssertionError) else 'La herramienta no pudo completar el recorrido; revisar el detalle privado.'
            with (PRIVADO/'errores.txt').open('a',encoding='utf8') as f:f.write(f"TC-{numero:03}: {type(error).__name__}: {error}\n")
        self.actual['duracion_segundos']=round(time.monotonic()-inicio,3)
        self.registros.append(self.actual);print(self.actual['caso']+' '+self.actual['estado'],flush=True)
        self.actual=None
        self.guardar_estado();self.guardar_reporte()
    def guardar_reporte(self):
        contenido={'inicio':self.inicio,'url':URL,'fase':self.fase,'entorno':self.entorno,'resultados':self.registros}
        ruta=PUBLICO/(self.identificador+'.json');ruta.write_text(json.dumps(contenido,ensure_ascii=False,indent=2),encoding='utf8')
        ruta.with_suffix('.sha256').write_text(hashlib.sha256(ruta.read_bytes()).hexdigest()+'\n',encoding='ascii')
    def paciente(self,**campos):
        datos={'fullName':self.prefijo+' Paciente sintético',**campos}
        r=self.peticion('post','/api/pacientes',201,datos).json()['data']
        self.estado.setdefault('pacientes',[]).append(r['id']);return r
    def estudio(self,paciente=None,**campos):
        datos={'patientId':(paciente or self.estado['paciente'])['id'],'type':'Endoscopía','date':'2026-11-01',**campos}
        r=self.peticion('post','/api/estudios',201,datos).json()['data']
        self.estado.setdefault('estudios',[]).append(r['id']);return r
    def usuario_nuevo(self,rol='visualizador',nombre=None,**campos):
        datos={'username':nombre or self.prefijo+str(len(self.estado.setdefault('usuarios',[]))), 'displayName':'Cuenta sintética QC','role':rol,'password':self.clave,'passwordConfirmation':self.clave,**campos}
        r=self.peticion('post','/api/users',201,datos).json()['data']
        self.estado['usuarios'].append(r);return r
    def archivo(self,extension='pdf'):
        return (PUBLICO/'archivos'/('prueba.'+extension)).read_bytes()
    def subir(self,extension='pdf',nombre=None,contenido=None,estudio=None,esperado=201,documento=None,cliente=None):
        tipos={'pdf':'application/pdf','doc':'application/msword','docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg','gif':'image/gif','webp':'image/webp','dcm':'application/dicom','txt':'text/plain','zip':'application/zip'}
        ruta='/api/documentos/'+str(documento) if documento else '/api/estudios/'+str((estudio or self.estado['estudio'])['id'])+'/documentos'
        r=self.peticion('put' if documento else 'post',ruta,esperado,cliente=cliente,multipart={'file':{'name':nombre or 'prueba.'+extension,'mimeType':tipos[extension],'buffer':contenido if contenido is not None else self.archivo(extension)}})
        return r
    def datos_usuario(self,nombre=None,clave=None,**campos):
        return {'username':nombre or self.prefijo+'v'+str(time.time_ns())[-8:],'displayName':'Cuenta sintética QC','role':'visualizador','password':clave or self.clave,'passwordConfirmation':clave or self.clave,**campos}
    def api(self):
        self.caso(186,'Salud de MariaDB y almacenamiento',lambda:(self.comprobar(self.peticion('get','/api/health/database').json()['database']=='connected','MariaDB conectada'),self.comprobar(self.peticion('get','/api/health/storage').json()['status']=='ready','Almacenamiento listo')))
        self.estado['paciente']=self.paciente()
        self.estado['estudio']=self.estudio()
        self.guardar_estado()
        def piloto():
            otro=self.sesion()
            for _ in range(12):self.peticion('post','/api/auth/login',401,{'username':self.usuario,'password':'ClaveIncorrectaQC'},cliente=otro)
            self.peticion('post','/api/auth/login',200,{'username':self.usuario,'password':self.contrasena},cliente=otro)
            self.comprobar(self.peticion('get','/api/auth/me',cliente=otro).json()['user']['username']==self.usuario,'La identidad autenticada es la esperada')
        self.caso(16,'Ingreso válido desde contexto independiente después de doce rechazos',piloto)
        self.caso(24,'Crear paciente con todos sus datos y recuperarlos',lambda:self.validar_paciente({'fullName':self.prefijo+' Completo','dni':'QC112233','birthDate':'2000-02-29','phone':'123456','address':'Domicilio sintético','notes':'Antecedente ficticio'}))
        self.caso(25,'Crear paciente sin datos opcionales',lambda:self.validar_paciente({'fullName':self.prefijo+' Mínimo'}))
        for numero,nombre in [(26,''),(27,'   ')]:self.caso(numero,'Rechazar nombre vacío o compuesto por espacios',lambda n=nombre:self.peticion('post','/api/pacientes',400,{'fullName':n}))
        self.caso(28,'Conservar tildes y apóstrofos',lambda:self.validar_paciente({'fullName':self.prefijo+" José D'Ángelo"}))
        def duplicados(campo):
            datos={campo:self.prefijo+' Coincidencia'};a=self.paciente(**datos);b=self.paciente(**datos)
            self.comprobar(a['id']!=b['id'],'Dos registros independientes sin fusión')
        self.caso(29,'Aceptar DNI repetido sin fusionar fichas',lambda:duplicados('dni'))
        self.caso(30,'Aceptar nombres repetidos sin fusionar fichas',lambda:duplicados('fullName'))
        for inicio,campo,limite in [(31,'fullName',240),(34,'dni',32),(37,'phone',80),(40,'address',500),(43,'notes',10000)]:
            for diferencia in [-1,0,1]:
                longitud=limite+diferencia
                self.caso(inicio+diferencia+1,f'API {campo} con {longitud} caracteres',lambda c=campo,n=longitud,l=limite:self.frontera_paciente(c,n,l))
        self.caso(46,'Fecha bisiesta existente',lambda:self.validar_paciente({'fullName':self.prefijo+' Bisiesto','birthDate':'2000-02-29'}))
        self.caso(47,'Rechazar fecha inexistente',lambda:self.peticion('post','/api/pacientes',400,{'fullName':self.prefijo,'birthDate':'2025-02-29'}))
        def buscar(campo):
            a=self.paciente(fullName=self.prefijo+' Buscable',dni=self.prefijo+'8899')
            for valor in [a[campo],a[campo][-5:]]:
                datos=self.peticion('get','/api/pacientes',params={'search':valor}).json()['data'];self.comprobar(any(x['id']==a['id'] for x in datos),'La búsqueda completa/parcial incluye el paciente preparado')
        self.caso(48,'Búsqueda por nombre y fragmento',lambda:buscar('fullName'))
        self.caso(49,'Búsqueda por DNI completo y parcial',lambda:buscar('dni'))
        self.caso(54,'Actualizar ficha y comprobar persistencia',self.editar_paciente)
        self.caso(56,'Limpiar un campo opcional previamente registrado',lambda:self.editar_paciente(limpiar=True))
        self.caso(57,'Detectar una versión antigua sin sobrescribir',self.conflicto_paciente)
        self.caso(61,'Crear y consultar un estudio completo',lambda:self.validar_estudio({'professional':'Profesional sintético','diagnosis':'Diagnóstico ficticio','procedure':'Procedimiento QC','description':'Descripción QC','conclusions':'Conclusión QC'}))
        self.caso(62,'Crear estudio sin opcionales',lambda:self.validar_estudio({}))
        self.caso(63,'Rechazar estudio sin fecha o con fecha inexistente',lambda:[self.peticion('post','/api/estudios',400,{'patientId':self.estado['paciente']['id'],'type':'Otro','date':fecha}) for fecha in ['', '2025-02-29']])
        self.caso(64,'Crear y recuperar los siete tipos disponibles',lambda:[self.validar_estudio({'type':tipo}) for tipo in ['Endoscopía','Radiología','CPRE','Ecografía','Tomografía','Laboratorio','Otro']])
        self.caso(66,'Impedir cambio de fecha en estudio existente',lambda:self.peticion('put','/api/estudios/'+self.estado['estudio']['id'],422,{**self.estado['estudio'],'date':'2026-11-02'}))
        self.caso(67,'Editar textos de un estudio',self.editar_estudio)
        self.caso(70,'Detectar versión antigua de estudio',self.conflicto_estudio)
        self.caso(71,'Mantener estudios separados por paciente',self.separar_estudios)
        self.caso(72,'Paciente nuevo sin estudios',lambda:self.comprobar(self.peticion('get','/api/pacientes/'+self.paciente()['id']+'/estudios').json()['data']==[],'Listado de estudios vacío'))
        self.caso(187,'Consultar estudio por identificador y rechazar identificador inexistente',lambda:(self.comprobar(self.peticion('get','/api/estudios/'+self.estado['estudio']['id']).json()['data']['patientId']==self.estado['paciente']['id'],'El estudio conserva su paciente'),self.peticion('get','/api/estudios/2147483647',404)))
        self.estado.setdefault('documentos',{})
        for numero,extension in enumerate(['pdf','doc','docx','jpg','jpeg','png','gif','webp','dcm'],77):
            self.caso(numero,'Cargar '+extension.upper()+' y comprobar contenido, tamaño, hash y asociación',lambda e=extension:self.validar_documento(e))
        self.caso(188,'Listar documentos de un estudio y excluir documentos de otro',self.listar_documentos)
        self.caso(90,'Descarga idéntica en bytes y tamaño para cada formato',self.descargar_todos)
        for numero,extension,contenido in [(91,'txt',b'QC ficticio'),(92,'zip',b'PK\x03\x04texto'),(93,'pdf',b'contenido incorrecto'),(94,'pdf',b''),(95,'dcm',b'')]:
            self.caso(numero,'Rechazar archivo incompatible o vacío',lambda e=extension,c=contenido:self.subir(e,contenido=c,esperado=(400,415)))
        for numero,diferencia in [(96,-1),(97,0),(98,1)]:
            self.caso(numero,'Frontera de tamaño de archivo configurada',lambda dif=diferencia:self.frontera_archivo(dif))
        self.caso(100,'Conservar nombre de archivo con espacios y tildes',lambda:self.comprobar(self.subir(nombre='Informe clínico QC.pdf').json()['data']['originalName']=='Informe clínico QC.pdf','Nombre conservado'))
        def mismo_nombre():
            a=self.subir().json()['data'];b=self.subir().json()['data'];self.comprobar(a['id']!=b['id'],'Dos documentos con mismo nombre mantienen IDs distintos')
        self.caso(101,'Dos documentos con el mismo nombre sin sobrescritura',mismo_nombre)
        self.caso(102,'Reemplazar documento conservando ID y asociación',self.reemplazar_documento)
        self.caso(104,'Conservar original ante reemplazo rechazado',self.reemplazo_rechazado)
        self.caso(105,'Eliminar documento y comprobar ausencia de contenido',self.eliminar_documento)
        self.caso(107,'Separar documentos de dos pacientes y dos estudios',self.separar_documentos)
        self.caso(108,'Restringir enlaces de documentos sin sesión',lambda:[self.peticion('get','/api/documentos/'+self.estado['documentos']['pdf']['id']+'/'+s,401,cliente=self.sesion()) for s in ['content','download']])
        self.caso(58,'Cambiar nombre y DNI conservando archivos',self.renombrar_paciente)
        self.caso(68,'Cambiar tipo del estudio conservando archivos',self.renombrar_estudio)
        self.usuarios()
        self.caso(192,'Nombre de un carácter',lambda:self.validar_paciente({'fullName':'Q'}))
        self.caso(193,'Nombre de dos caracteres',lambda:self.validar_paciente({'fullName':'QC'}))
        for numero,n in [(194,4),(195,99)]:self.caso(numero,'Usuario con longitud '+str(n),lambda n=n:self.usuario_nuevo(nombre=(self.prefijo+'x'*100)[-n:]))
        for numero,n in [(196,1023),(197,1024),(198,1025)]:
            self.caso(numero,'Contraseña administrativa de '+str(n)+' caracteres',lambda n=n:self.peticion('post','/api/users',201 if n<=1024 else 422,self.datos_usuario(clave='Q'*n)))
    def validar_paciente(self,datos):
        a=self.paciente(**datos);b=self.peticion('get','/api/pacientes/'+a['id']).json()['data']
        self.comprobar(all(b.get(k)==v for k,v in datos.items()),'Los campos guardados coinciden al volver a consultarlos')
    def frontera_paciente(self,campo,n,limite):
        datos={'fullName':self.prefijo+' Frontera',campo:'Q'*n}
        if n>limite:self.peticion('post','/api/pacientes',400,datos)
        else:self.validar_paciente(datos)
    def editar_paciente(self,limpiar=False):
        a=self.paciente(phone='123');a['phone']=None if limpiar else '456';a['fullName']=self.prefijo+' Editado'
        b=self.peticion('put','/api/pacientes/'+a['id'],datos=a).json()['data'];c=self.peticion('get','/api/pacientes/'+a['id']).json()['data']
        self.comprobar(c['phone']==a['phone'] and c['fullName']==a['fullName'] and b['version']==2,'Se conservan cambios y aumenta la versión')
    def conflicto_paciente(self):
        a=self.paciente();self.peticion('put','/api/pacientes/'+a['id'],datos=a)
        self.peticion('put','/api/pacientes/'+a['id'],409,a)
    def validar_estudio(self,datos):
        a=self.estudio(**datos);b=self.peticion('get','/api/estudios/'+a['id']).json()['data'];self.comprobar(all(b.get(k)==v for k,v in datos.items()),'El estudio conserva sus campos')
    def editar_estudio(self):
        a=self.estudio();a['description']='Texto editado QC';b=self.peticion('put','/api/estudios/'+a['id'],datos=a).json()['data'];self.comprobar(b['description']==a['description'],'Texto del estudio actualizado')
    def conflicto_estudio(self):
        a=self.estudio();self.peticion('put','/api/estudios/'+a['id'],datos=a);self.peticion('put','/api/estudios/'+a['id'],409,a)
    def separar_estudios(self):
        a=self.paciente();b=self.paciente();e=self.estudio(a)
        datos=self.peticion('get','/api/pacientes/'+b['id']+'/estudios').json()['data'];self.comprobar(not any(x['id']==e['id'] for x in datos),'El estudio de A no aparece en B')
    def validar_documento(self,extension):
        a=self.subir(extension).json()['data'];self.estado['documentos'][extension]=a
        r=self.peticion('get','/api/documentos/'+a['id']+'/download');contenido=self.archivo(extension)
        self.comprobar(r.body()==contenido,'Descarga idéntica al archivo subido')
        self.comprobar(a['sha256']==hashlib.sha256(contenido).hexdigest(),'SHA-256 coincide con los bytes')
        self.comprobar(int(a['sizeBytes'])==len(contenido),'Tamaño persistido correcto')
        self.comprobar(a['studyId']==self.estado['estudio']['id'] and a['patientId']==self.estado['paciente']['id'],'Asociación al estudio y paciente correctos')
    def listar_documentos(self):
        datos=self.peticion('get','/api/estudios/'+self.estado['estudio']['id']+'/documentos').json()['data'];esperados={x['id'] for x in self.estado['documentos'].values()}
        self.comprobar(esperados.issubset({x['id'] for x in datos}),'Listado incluye los documentos preparados')
        otro=self.estudio();self.comprobar(self.peticion('get','/api/estudios/'+otro['id']+'/documentos').json()['data']==[],'El estudio vacío no hereda documentos')
    def descargar_todos(self):
        for e,a in self.estado['documentos'].items():self.comprobar(self.peticion('get','/api/documentos/'+a['id']+'/download').body()==self.archivo(e),'Bytes y tamaño de '+e+' conservados')
    def frontera_archivo(self,diferencia):
        r=subprocess.run(['docker','exec','hcv_docker_beta_test-api-1','node','-e','process.stdout.write(process.env.MAX_FILE_SIZE_BYTES)'],capture_output=True,text=True,check=True)
        limite=int(r.stdout);n=limite+diferencia;contenido=b'%PDF-1.4\n'+b'Q'*(n-18)+b'\n%%EOF\n'
        contenido=contenido[:n].ljust(n,b' ')
        self.comprobar(len(contenido)==n,'Datos de ensayo tienen longitud exacta '+str(n))
        self.subir(contenido=contenido,esperado=201 if diferencia<=0 else 413)
    def reemplazar_documento(self):
        a=self.subir().json()['data'];contenido=self.archivo('pdf')+b'\n% Reemplazo QC\n';b=self.subir(documento=a['id'],contenido=contenido,esperado=200).json()['data']
        self.comprobar(a['id']==b['id'] and a['studyId']==b['studyId'],'ID y asociación conservados');self.comprobar(self.peticion('get','/api/documentos/'+a['id']+'/download').body()==contenido,'Contenido nuevo persistido')
    def reemplazo_rechazado(self):
        a=self.subir().json()['data'];self.subir(documento=a['id'],contenido=b'invalido',esperado=415)
        self.comprobar(self.peticion('get','/api/documentos/'+a['id']+'/download').body()==self.archivo(),'Original intacto tras rechazo')
    def eliminar_documento(self):
        a=self.subir().json()['data'];self.peticion('delete','/api/documentos/'+a['id'],204);self.peticion('get','/api/documentos/'+a['id']+'/download',404)
    def separar_documentos(self):
        e=self.estudio(self.paciente());a=self.subir(estudio=e).json()['data'];otros=self.peticion('get','/api/estudios/'+self.estado['estudio']['id']+'/documentos').json()['data'];self.comprobar(not any(x['id']==a['id'] for x in otros),'Documento no aparece bajo otro estudio/paciente')
    def renombrar_paciente(self):
        a=self.peticion('get','/api/pacientes/'+self.estado['paciente']['id']).json()['data'];a.update(fullName=self.prefijo+' Renombrado',dni=self.prefijo+'nuevo')
        self.estado['paciente']=self.peticion('put','/api/pacientes/'+a['id'],datos=a).json()['data'];self.descargar_todos()
    def renombrar_estudio(self):
        a=self.peticion('get','/api/estudios/'+self.estado['estudio']['id']).json()['data'];a['type']='Radiología';self.estado['estudio']=self.peticion('put','/api/estudios/'+a['id'],datos=a).json()['data'];self.descargar_todos()
    def usuarios(self):
        for numero,rol in [(116,'administrador'),(117,'medico'),(118,'secretario'),(119,'visualizador')]:
            self.caso(numero,'Crear cuenta '+rol+' y autenticarla',lambda rol=rol:self.crear_y_autenticar(rol))
        self.caso(120,'Rechazar nombre de cuenta duplicado',lambda:self.peticion('post','/api/users',409,self.datos_usuario(nombre=self.estado['usuarios'][0]['username'])))
        for numero,cambios in [(121,{'displayName':''}),(122,{'username':'q2'}),(123,{'username':'qc espacio'}),(124,{'username':'qc@correo'}),(127,{'username':'q'*101}),(128,{'password':'q'*11,'passwordConfirmation':'q'*11}),(131,{'passwordConfirmation':'NoCoincideQC'})]:
            self.caso(numero,'Rechazar entrada inválida al crear cuenta',lambda c=cambios:self.peticion('post','/api/users',422,self.datos_usuario(**c)))
        self.caso(125,'Crear usuario de tres caracteres',lambda:self.usuario_nuevo(nombre=self.prefijo[-3:]))
        self.caso(126,'Crear usuario de cien caracteres',lambda:self.usuario_nuevo(nombre=self.prefijo+'q'*(100-len(self.prefijo))))
        for numero,longitud in [(129,12),(130,13)]:self.caso(numero,'Aceptar contraseña de '+str(longitud)+' caracteres',lambda n=longitud:self.crear_y_autenticar('visualizador',clave='Q'*n))
        self.caso(133,'Buscar cuenta por usuario y nombre visible',self.buscar_usuario)
        self.caso(135,'Editar nombre visible conservando username',self.editar_usuario)
        self.caso(136,'Desactivar cuenta e invalidar su sesión',self.desactivar_usuario)
        self.caso(138,'Reactivar sin reactivar la sesión anterior',self.reactivar_usuario)
        self.caso(139,'Cambiar contraseña y revocar dos sesiones de esa cuenta',self.revocar_contrasena)
        self.caso(140,'Mantener la sesión de otra cuenta al cambiar contraseña',lambda:self.comprobar(self.peticion('get','/api/auth/me').json()['user']['username']==self.usuario,'La sesión administrativa de otra cuenta sigue vigente'))
        self.caso(141,'Cambiar contraseña de una cuenta propia sintética',self.contrasena_propia)
        self.caso(143,'Impedir autodesactivación y pérdida del rol administrador',self.proteger_admin)
        for numero,rol in [(110,'administrador'),(111,'medico'),(112,'secretario'),(113,'visualizador')]:self.caso(numero,'Comprobar permisos efectivos de '+rol,lambda rol=rol:self.permisos_rol(rol))
        self.caso(114,'Cambiar perfil y revocar sesiones existentes',self.cambiar_rol)
        self.caso(21,'Rechazar login de cuenta inactiva',self.login_inactivo)
    def crear_y_autenticar(self,rol,clave=None):
        a=self.usuario_nuevo(rol,**({'password':clave,'passwordConfirmation':clave} if clave else {}));c=self.sesion(a['username'],clave or self.clave)
        self.comprobar(rol in self.peticion('get','/api/auth/me',cliente=c).json()['user']['roles'],'Identidad y perfil esperados');self.peticion('post','/api/auth/logout',204,cliente=c)
    def buscar_usuario(self):
        a=self.usuario_nuevo(nombre=self.prefijo+'buscar',displayName=self.prefijo+' Nombre visible')
        for texto in [a['username'],a['displayName']]:self.comprobar(any(x['id']==a['id'] for x in self.peticion('get','/api/users',params={'search':texto}).json()['data']),'La búsqueda encuentra el usuario preparado')
    def editar_usuario(self):
        a=self.usuario_nuevo();b=self.peticion('put','/api/users/'+a['id'],datos={'displayName':'Nombre QC actualizado'}).json()['data'];self.comprobar(a['username']==b['username'] and b['displayName']=='Nombre QC actualizado','Nombre actualizado y username inmutable')
    def desactivar_usuario(self):
        a=self.usuario_nuevo();c=self.sesion(a['username'],self.clave);self.peticion('put','/api/users/'+a['id'],datos={'isActive':False});self.peticion('get','/api/auth/me',401,cliente=c);self.estado['desactivado']=a
    def reactivar_usuario(self):
        a=self.usuario_nuevo();c=self.sesion(a['username'],self.clave);self.peticion('put','/api/users/'+a['id'],datos={'isActive':False});self.peticion('put','/api/users/'+a['id'],datos={'isActive':True});self.peticion('get','/api/auth/me',401,cliente=c);n=self.sesion(a['username'],self.clave);self.peticion('get','/api/auth/me',cliente=n)
    def revocar_contrasena(self):
        a=self.usuario_nuevo();c=self.sesion(a['username'],self.clave);otro=self.sesion(a['username'],self.clave)
        nueva=self.clave+'nuevo';self.peticion('put','/api/users/'+a['id']+'/password',204,datos={'password':nueva,'passwordConfirmation':nueva});self.peticion('get','/api/auth/me',401,cliente=c);self.peticion('get','/api/auth/me',401,cliente=otro);self.sesion(a['username'],nueva)
    def contrasena_propia(self):
        a=self.usuario_nuevo('administrador');c=self.sesion(a['username'],self.clave);nueva=self.clave+'propia'
        self.peticion('put','/api/users/'+a['id']+'/password',204,datos={'password':nueva,'passwordConfirmation':nueva},cliente=c);self.peticion('get','/api/auth/me',401,cliente=c);self.sesion(a['username'],nueva)
    def proteger_admin(self):
        a=self.peticion('get','/api/auth/me').json()['user'];self.peticion('put','/api/users/'+str(a['id']),409,{'isActive':False});self.peticion('put','/api/users/'+str(a['id']),409,{'role':'visualizador'});self.peticion('get','/api/auth/me')
    def permisos_rol(self,rol):
        a=self.usuario_nuevo(rol);c=self.sesion(a['username'],self.clave);permisos=self.peticion('get','/api/auth/permisos',cliente=c).json()['permissions']
        for metodo,ruta,permiso,datos in [('get','/api/pacientes','patients.read',None),('get','/api/users','users.manage',None),('get','/api/respaldos/resumen-clinico','backups.manage',None),('post','/api/pacientes','patients.create',{'fullName':self.prefijo+' '+rol})]:
            self.peticion(metodo,ruta,(201 if metodo=='post' else 200) if permiso in permisos else 403,datos,cliente=c)
        # Comprobar operaciones prohibidas de estudio y documento sin modificar datos.
        for metodo,ruta,permiso in [('put','/api/estudios/'+self.estado['estudio']['id'],'studies.update'),('delete','/api/documentos/'+self.estado['documentos']['pdf']['id'],'documents.delete')]:
            if permiso not in permisos:self.peticion(metodo,ruta,403,{},cliente=c)
    def cambiar_rol(self):
        a=self.usuario_nuevo('medico');c=self.sesion(a['username'],self.clave);self.peticion('put','/api/users/'+a['id'],datos={'role':'visualizador'});self.peticion('get','/api/auth/me',401,cliente=c)
        nuevo=self.sesion(a['username'],self.clave);self.peticion('post','/api/pacientes',403,{'fullName':self.prefijo},cliente=nuevo)
    def login_inactivo(self):
        a=self.usuario_nuevo();self.peticion('put','/api/users/'+a['id'],datos={'isActive':False});self.peticion('post','/api/auth/login',401,{'username':a['username'],'password':self.clave},cliente=self.sesion())
    def fronteras_usuarios(self):
        for numero,n in [(194,4),(195,99)]:
            nombre=('q'+str(time.time_ns())[-3:]) if n==4 else (self.prefijo+str(time.time_ns())).ljust(n,'q')
            self.caso(numero,'Aceptar usuario de '+str(n)+' caracteres y autenticarlo',lambda nombre=nombre:self.crear_usuario_longitud(nombre))
        for numero,n in [(196,1023),(197,1024),(198,1025)]:
            self.caso(numero,'Contraseña administrativa de '+str(n)+' caracteres',lambda n=n:self.validar_contrasena_larga(n))
    def crear_usuario_longitud(self,nombre):
        a=self.usuario_nuevo(nombre=nombre);c=self.sesion(a['username'],self.clave);self.peticion('get','/api/auth/me',cliente=c)
    def validar_contrasena_larga(self,n):
        datos=self.datos_usuario(clave='Q'*n);r=self.peticion('post','/api/users',201 if n<=1024 else 422,datos)
        if n<=1024:self.sesion(r.json()['data']['username'],'Q'*n)
    def cerrar(self):
        for sesion in self.sesiones:
            try:sesion.post('/api/auth/logout');sesion.dispose()
            except Exception:pass

def main():
    argumentos=argparse.ArgumentParser(description=__doc__);argumentos.add_argument('--fase',choices=['api','usuarios','retest','fronteras'],default='api');argumentos.add_argument('--casos');opciones=argumentos.parse_args()
    with sync_playwright() as motor:
        p=Pruebas(motor);p.inicio=datetime.now(timezone.utc).isoformat();p.identificador='MATRIZ-'+datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+opciones.fase;p.fase=opciones.fase
        p.seleccion={int(x) for x in opciones.casos.split(',')} if opciones.casos else None
        r=subprocess.run(['docker','inspect','--format','{{.Image}}|{{.State.StartedAt}}','hcv_docker_beta_test-api-1'],capture_output=True,text=True,check=True);p.entorno={'api_imagen_inicio':r.stdout.strip()}
        try:
            if opciones.fase=='usuarios':p.usuarios()
            elif opciones.fase=='fronteras':p.fronteras_usuarios()
            elif opciones.fase=='retest':
                p.caso(68,'Cambiar tipo del estudio conservando archivos',p.renombrar_estudio)
                p.caso(100,'Conservar nombre de archivo con espacios y tildes',lambda:p.comprobar(p.subir(nombre='Informe clínico QC.pdf').json()['data']['originalName']=='Informe clínico QC.pdf','Nombre conservado'))
                p.caso(97,'Archivo del límite exacto',lambda:p.frontera_archivo(0))
            else:p.api()
        finally:p.cerrar();p.guardar_reporte()
        print('Reporte: '+str(PUBLICO/(p.identificador+'.json')))
if __name__=='__main__':main()
