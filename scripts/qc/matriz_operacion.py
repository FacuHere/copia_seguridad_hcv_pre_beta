"""Pruebas operativas autorizadas sobre los mismos contenedores beta."""
import argparse,json,subprocess,time
from datetime import datetime,timezone
from playwright.sync_api import sync_playwright,expect
from ejecutar_matriz import Pruebas,URL
from matriz_interfaz import Interfaz

API='hcv_docker_beta_test-api-1';DB='hcv_docker_beta_test-db-1'
def sql(sentencia):
    r=subprocess.run(['docker','exec','-i',DB,'sh','-c','exec mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" --batch --skip-column-names hcv_docker_beta_test'],input=sentencia,text=True,capture_output=True,timeout=30)
    if r.returncode:raise RuntimeError('No se pudo preparar o verificar el dato de ensayo SQL.')
    return r.stdout.strip()
def nodo(codigo,datos=None):
    r=subprocess.run(['docker','exec','-i',API,'node','-e',codigo],input=json.dumps(datos or {}),text=True,capture_output=True,timeout=40)
    if r.returncode:raise RuntimeError('No se pudo completar la preparación operativa; no se publica su salida interna.')
    return json.loads(r.stdout)
def esperar_salud():
    inicio=time.monotonic()
    while time.monotonic()-inicio<60:
        r=subprocess.run(['docker','inspect','--format','{{.State.Health.Status}}',API,DB],text=True,capture_output=True,timeout=10)
        if r.returncode==0 and r.stdout.split()==['healthy','healthy']:return
        time.sleep(1)
    raise RuntimeError('Los servicios no recuperaron el estado saludable en el plazo previsto.')

class Operacion:
    def __init__(self,p):self.p=p;self.tecnico=None
    def preparar_tecnico(self,multiple=False):
        a=self.p.usuario_nuevo();id=int(a['id']);roles="'system_admin','medico'" if multiple else "'system_admin'"
        sql(f"START TRANSACTION; DELETE FROM user_roles WHERE user_id={id}; INSERT INTO user_roles(user_id,role_id) SELECT {id},id FROM roles WHERE code IN ({roles}); COMMIT;")
        return a,self.p.sesion(a['username'],self.p.clave)
    def ejecutar(self):
        self.p.caso(22,'Comprobar TTL de ocho horas y rechazo efectivo de una sesión vencida preparada',self.vencimiento,'API y MariaDB reales; vencimiento adelantado solo para la cuenta sintética')
        self.p.caso(115,'Aplicar permisos reales de una cuenta técnica system_admin',self.permisos_tecnicos)
        self.p.caso(144,'Impedir desactivar al último administrador desde otra cuenta autorizada',self.ultimo_administrador,'API y MariaDB reales; estados de administradores recuperados en finally')
        self.p.caso(145,'Conservar roles técnicos o múltiples y deshabilitar su edición de perfil',self.roles_especiales,'Interfaz, API y MariaDB reales; roles preparados solo en cuentas sintéticas')
        self.p.caso(185,'Informar caída real de MariaDB y recuperar el servicio después',self.indisponibilidad,'Interfaz y API reales; parada y arranque controlados de la misma MariaDB beta')
        self.p.caso(189,'Recuperar al reiniciar una carga preparada en el journal real',self.journal,'MariaDB, filesystem y arranque real de la misma API beta')
    def vencimiento(self):
        a=self.p.usuario_nuevo();c=self.p.sesion(a['username'],self.p.clave);id=int(a['id'])
        duraciones=sql(f'SELECT TIMESTAMPDIFF(SECOND,created_at,expires_at) FROM app_sessions WHERE user_id={id};').splitlines()
        self.p.comprobar(duraciones and all(int(x)==28800 for x in duraciones),'La sesión se crea con duración de 28800 segundos (ocho horas)')
        self.p.peticion('get','/api/auth/me',cliente=c)
        sql(f'UPDATE app_sessions SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE user_id={id};')
        self.p.peticion('get','/api/auth/me',401,cliente=c);self.p.peticion('get','/api/pacientes',401,cliente=c)
    def permisos_tecnicos(self):
        a,c=self.preparar_tecnico();self.tecnico=(a,c)
        permisos=self.p.peticion('get','/api/auth/permisos',cliente=c).json()['permissions'];self.p.comprobar(set(permisos)=={'users.manage','roles.manage'},'El perfil técnico conserva exactamente los dos permisos administrativos')
        self.p.peticion('get','/api/usuarios',cliente=c)
        for ruta in ['/api/pacientes','/api/estudios/'+self.p.estado['estudio']['id'],'/api/respaldos/resumen-clinico']:
            self.p.peticion('get',ruta,403,cliente=c)
    def ultimo_administrador(self):
        if self.tecnico is None:self.tecnico=self.preparar_tecnico()
        a,c=self.tecnico;ultimo=self.p.usuario_nuevo('administrador');id=int(ultimo['id'])
        anteriores=[int(x) for x in sql(f"SELECT DISTINCT u.id FROM app_users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.is_active=1 AND r.code='administrador' AND u.id<>{id};").splitlines() if x]
        try:
            if anteriores:sql('UPDATE app_users SET is_active=0 WHERE id IN ('+','.join(map(str,anteriores))+');')
            r=self.p.peticion('put','/api/usuarios/'+str(id),409,{'isActive':False},cliente=c)
            self.p.comprobar(r.json()['error']['code']=='LAST_ADMIN_PROTECTION','Se rechaza específicamente por protección del último administrador')
            self.p.comprobar(sql(f'SELECT is_active FROM app_users WHERE id={id};')=='1','El último administrador permanece activo')
        finally:
            if anteriores:sql('UPDATE app_users SET is_active=1 WHERE id IN ('+','.join(map(str,anteriores))+');')
        self.p.peticion('get','/api/auth/me')
    def roles_especiales(self):
        ui=Interfaz(self.p)
        try:
            for multiple in [False,True]:
                a,c=self.preparar_tecnico(multiple);antes=self.p.peticion('get','/api/auth/me',cliente=c).json()['user']['roles'];self.p.peticion('put','/api/usuarios/'+a['id'],409,{'role':'visualizador'})
                cambiado=self.p.peticion('put','/api/usuarios/'+a['id'],datos={'displayName':'Cuenta técnica QC editada'}).json()['data'];self.p.comprobar(sorted(cambiado['roles'])==sorted(antes),'Editar el nombre conserva los roles técnicos o múltiples')
                ui.restablecer();ui.abrir_usuarios();ui.pagina.locator('#usersSearch').fill(a['username']);fila=ui.pagina.locator('#usersList tr').filter(has_text=a['username']);fila.get_by_role('button',name='Editar',exact=True).click();expect(ui.pagina.locator('#userForm [name=role]')).to_be_disabled();expect(ui.pagina.locator('#userRoleNote')).to_be_visible()
        finally:ui.cerrar()
    def indisponibilidad(self):
        ui=Interfaz(self.p);pagina=ui.abrir(False)
        try:
            subprocess.run(['docker','stop',DB],check=True,capture_output=True,timeout=60)
            self.p.peticion('get','/api/health/database',503)
            f=pagina.locator('#loginForm');f.locator('[name=username]').fill(self.p.usuario);f.locator('[name=password]').fill(self.p.contrasena);f.locator('button').click();expect(pagina.locator('#loginError')).to_be_visible(timeout=30000);expect(pagina.locator('#appShell')).to_be_hidden()
        finally:
            subprocess.run(['docker','start',DB],check=True,capture_output=True,timeout=30);esperar_salud();ui.cerrar()
        self.p.peticion('get','/api/health/database');self.p.sesion(self.p.usuario,self.p.contrasena)
    def journal(self):
        codigo='''const fs=require('node:fs/promises'),crypto=require('node:crypto');const db=require('./src/config/database'),r=require('./src/repositories/document-repository'),s=require('./src/services/document-storage');let entrada='';process.stdin.on('data',x=>entrada+=x);process.stdin.on('end',async()=>{let c;try{const d=JSON.parse(entrada),op=crypto.randomUUID(),contenido=Buffer.from('%PDF-1.7\\nRecuperacion QC\\n%%EOF');const sha=crypto.createHash('sha256').update(contenido).digest('hex');const stage='.staging/'+op+'.part';await fs.mkdir(process.env.FILE_STORAGE_ROOT+'/.staging',{recursive:true});await fs.writeFile(process.env.FILE_STORAGE_ROOT+'/'+stage,contenido);c=await db.getPool().getConnection();await c.beginTransaction();const e=await r.findStudyForUpload(c,d.studyId,true);const a=await r.insertPending(c,{patientId:e.patientId,studyId:d.studyId,originalName:'recuperacion-qc.pdf',storageKey:'.staging/pending-'+op+'.pending',mimeType:'application/pdf',sizeBytes:contenido.length,sha256:sha,uploadedBy:d.userId});const id=String(a.insertId);const key=s.relativeDocumentKey({...e,documentId:id,originalName:'recuperacion-qc.pdf'});await r.setStorageKey(c,key,id);await r.createUploadOperation(c,{operationId:op,documentId:id,patientId:e.patientId,studyId:d.studyId,stagingKey:stage,newKey:key,originalName:'recuperacion-qc.pdf',mimeType:'application/pdf',sizeBytes:contenido.length,sha256:sha,actorId:d.userId});await c.commit();console.log(JSON.stringify({id,operationId:op,sha256:sha}));}catch(e){if(c)await c.rollback();process.exitCode=1;}finally{if(c)c.release();await db.end();}});'''
        usuario=self.p.peticion('get','/api/auth/me').json()['user'];d=nodo(codigo,{'studyId':self.p.estado['estudio']['id'],'userId':str(usuario['id'])})
        self.p.comprobar(sql("SELECT operation_state FROM document_file_operations WHERE operation_id='"+d['operationId']+"';")=='prepared','La operación quedó preparada antes del reinicio')
        subprocess.run(['docker','restart',API],capture_output=True,check=True,timeout=40);esperar_salud()
        r=self.p.peticion('get','/api/documentos/'+d['id']+'/download');self.p.comprobar(r.body()==b'%PDF-1.7\nRecuperacion QC\n%%EOF','El arranque recuperó exactamente los bytes preparados')
        self.p.comprobar(sql("SELECT operation_state FROM document_file_operations WHERE operation_id='"+d['operationId']+"';")=='completed','El journal quedó completado después del arranque')
        self.p.comprobar(self.p.peticion('get','/api/health/storage').json()['status']=='ready','El almacenamiento vuelve a quedar listo')

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--casos');args=parser.parse_args()
    with sync_playwright() as motor:
        p=Pruebas(motor);p.inicio=datetime.now(timezone.utc).isoformat();p.identificador='MATRIZ-'+datetime.now().strftime('%Y%m%d-%H%M%S')+'-operacion';p.fase='operacion';p.entorno={};p.seleccion={int(x) for x in args.casos.split(',')} if args.casos else None
        try:Operacion(p).ejecutar()
        finally:p.cerrar();p.guardar_reporte()
if __name__=='__main__':main()
