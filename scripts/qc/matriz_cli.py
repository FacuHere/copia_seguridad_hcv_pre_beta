"""Ensayo de los CLI reales en el mismo Docker beta, con resguardo y recuperación.

El bootstrap exige cero usuarios: esa condición se prepara temporalmente en la
misma base autorizada y se recupera el dump completo en finally. No crea entornos.
"""
import codecs,json,queue,subprocess,threading,time
from datetime import datetime,timezone
from pathlib import Path
from playwright.sync_api import sync_playwright
from ejecutar_matriz import Pruebas,PRIVADO
from matriz_operacion import API,DB,sql,esperar_salud

def ejecutar_cli(archivo,entradas):
    proceso=subprocess.Popen(['docker','exec','-i',API,'script','-qec','node '+archivo,'/dev/null'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    canal=queue.Queue()
    def leer():
        decodificador=codecs.getincrementaldecoder('utf8')('replace')
        while True:
            dato=proceso.stdout.read(1)
            if not dato:break
            texto=decodificador.decode(dato)
            if texto:canal.put(texto)
        canal.put(None)
    threading.Thread(target=leer,daemon=True).start();salida=''
    try:
        for pregunta,respuesta in entradas:
            segmento='';limite=time.monotonic()+30
            while pregunta not in segmento:
                if time.monotonic()>limite:raise RuntimeError('El CLI no presentó la pregunta esperada.')
                try:dato=canal.get(timeout=1)
                except queue.Empty:continue
                if dato is None:raise RuntimeError('El CLI terminó antes de completar la entrada.')
                segmento+=dato;salida+=dato
            proceso.stdin.write((respuesta+'\r').encode('utf8'));proceso.stdin.flush()
        limite=time.monotonic()+30
        while time.monotonic()<limite:
            try:dato=canal.get(timeout=1)
            except queue.Empty:continue
            if dato is None:break
            salida+=dato
        codigo=proceso.wait(timeout=10)
        return codigo,salida
    finally:
        if proceso.poll() is None:proceso.terminate();proceso.wait(timeout=10)
        proceso.stdin.close();proceso.stdout.close()

class Comandos:
    def __init__(self,p):self.p=p;self.preparado=False;self.cuenta_bootstrap_sql=None
    def preparar(self):
        nombre='hcv_qc_b'+str(time.time_ns());clave=self.p.clave
        sql("CREATE USER '"+nombre+"'@'%' IDENTIFIED BY '"+clave+"';")
        self.cuenta_bootstrap_sql=nombre
        for tabla,permisos in {'app_users':'SELECT, INSERT','roles':'SELECT','role_permissions':'SELECT','role_service_permissions':'SELECT','permissions':'SELECT','user_roles':'INSERT','audit_events':'INSERT'}.items():
            sql(f"GRANT {permisos} ON hcv_docker_beta_test.{tabla} TO '{nombre}'@'%';")
        codigo='''const fs=require('node:fs');const d=JSON.parse(fs.readFileSync(0,'utf8'));const nombres=['/app/.env.bootstrap','/app/.env.password-reset'];if(nombres.some(n=>fs.existsSync(n)))process.exit(3);const b='DB_USER='+JSON.stringify(d.usuario)+'\\nDB_PASSWORD='+JSON.stringify(d.clave)+'\\n';const r='DB_HOST=127.0.0.1\\nDB_PORT=3399\\nDB_NAME='+process.env.DB_NAME+'\\nDB_USER='+JSON.stringify(process.env.DB_USER)+'\\nDB_PASSWORD='+JSON.stringify(process.env.DB_PASSWORD)+'\\n';for(const[n,v]of[[nombres[0],b],[nombres[1],r]]){fs.writeFileSync(n,v,{flag:'wx',mode:0o600});fs.chownSync(n,1000,1000)}'''
        subprocess.run(['docker','exec','-i','-u','0',API,'node','-e',codigo],input=json.dumps({'usuario':nombre,'clave':clave}),text=True,capture_output=True,check=True,timeout=15)
        self.preparado=True
        proxy='''// QC_PROXY_MATRIZ
const net=require('node:net'),fs=require('node:fs');const s=net.createServer(c=>{const d=net.connect(3306,process.env.DB_HOST);c.pipe(d);d.pipe(c);c.on('error',()=>d.destroy());d.on('error',()=>c.destroy())});s.listen(3399,'127.0.0.1',()=>fs.writeFileSync('/tmp/hcv-qc-proxy.pid',String(process.pid)));'''
        subprocess.run(['docker','exec','-d',API,'node','-e',proxy],check=True,capture_output=True,timeout=15)
        time.sleep(.3)
    def bootstrap(self):
        antes=self.p.peticion('get','/api/respaldos/resumen-clinico').json()['data'];ruta=PRIVADO/('antes-bootstrap-'+datetime.now().strftime('%H%M%S')+'.sql')
        r=subprocess.run(['docker','exec',DB,'sh','-c','exec mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" --single-transaction --routines --triggers --databases hcv_docker_beta_test'],capture_output=True,check=True,timeout=60);ruta.write_bytes(r.stdout)
        nombre=self.p.prefijo+'bootstrap';entradas=[('Nombre de usuario (3 a 100 caracteres): ',nombre),('Nombre visible (máximo 200 caracteres): ','Administrador técnico sintético QC'),('Contraseña (mínimo 12 caracteres): ',self.p.clave),('Repita la contraseña: ',self.p.clave)]
        try:
            sql('SET FOREIGN_KEY_CHECKS=0; DELETE FROM user_roles; DELETE FROM user_services; DELETE FROM app_sessions; DELETE FROM app_users; SET FOREIGN_KEY_CHECKS=1;')
            codigo,salida=ejecutar_cli('src/cli/bootstrap-admin.js',entradas)
            (PRIVADO/'salida-bootstrap.txt').write_text(salida.replace(self.p.clave,'[OCULTO]'),encoding='utf8')
            self.p.comprobar(codigo==0 and 'Administrador técnico inicial creado' in salida,'El CLI real crea el administrador en la misma base temporalmente sin usuarios')
            self.p.comprobar(sql('SELECT COUNT(*) FROM app_users;')=='1','El bootstrap crea una sola cuenta')
            rol=sql("SELECT r.code FROM app_users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.username='"+nombre+"';")
            self.p.comprobar(rol=='system_admin','El administrador inicial recibe el perfil técnico system_admin')
            cliente=self.p.sesion(nombre,self.p.clave);permisos=cliente.get('/api/auth/permisos').json()['permissions'];self.p.comprobar(set(permisos)=={'users.manage','roles.manage'},'El perfil inicial conserva únicamente los permisos técnicos previstos')
            codigo,salida=ejecutar_cli('src/cli/bootstrap-admin.js',entradas)
            self.p.comprobar(codigo!=0 and 'Ya existe' in salida and sql('SELECT COUNT(*) FROM app_users;')=='1','Un segundo bootstrap se rechaza sin crear otra cuenta')
        finally:
            restauracion=subprocess.run(['docker','exec','-i',DB,'sh','-c','exec mariadb -uroot -p"$MARIADB_ROOT_PASSWORD"'],input=ruta.read_bytes(),capture_output=True,timeout=90)
            if restauracion.returncode:raise RuntimeError('No se pudo recuperar el resguardo previo al bootstrap; requiere intervención antes de continuar.')
        despues=self.p.peticion('get','/api/respaldos/resumen-clinico').json()['data'];self.p.comprobar(all(antes[k]==despues[k] for k in ['pacientes','estudios','documentos']),'Se recuperan los datos y las cuentas originales después de probar el bootstrap')
    def restablecer(self):
        a=self.p.usuario_nuevo();uno=self.p.sesion(a['username'],self.p.clave);dos=self.p.sesion(a['username'],self.p.clave);nueva=self.p.clave+'cli'
        codigo,salida=ejecutar_cli('src/cli/reset-password.js',[('Usuario cuya contraseña desea cambiar: ',a['username']),('Nueva contraseña (mínimo 12 caracteres): ',nueva),('Repita la nueva contraseña: ',nueva)])
        self.p.comprobar(codigo==0 and 'Contraseña actualizada' in salida,'El CLI real finaliza correctamente')
        self.p.peticion('get','/api/auth/me',401,cliente=uno);self.p.peticion('get','/api/auth/me',401,cliente=dos)
        self.p.peticion('post','/api/auth/login',401,{'username':a['username'],'password':self.p.clave},cliente=self.p.sesion())
        self.p.sesion(a['username'],nueva);self.p.peticion('get','/api/auth/me')
    def ejecutar(self):
        self.preparar()
        self.p.caso(190,'Crear administrador inicial por CLI y rechazar un segundo bootstrap',self.bootstrap,'CLI real sobre la misma base beta; usuarios y datos recuperados desde resguardo')
        if not __import__('os').environ.get('HCV_QC_SOLO_BOOTSTRAP'):self.p.caso(191,'Restablecer contraseña por CLI e invalidar todas las sesiones de esa cuenta',self.restablecer,'CLI real dentro de la API beta; conexión local de recuperación temporal')
    def cerrar(self):
        if self.preparado:
            codigo='''const fs=require('node:fs');for(const n of ['/app/.env.bootstrap','/app/.env.password-reset'])if(fs.existsSync(n))fs.unlinkSync(n);const f='/tmp/hcv-qc-proxy.pid';if(fs.existsSync(f)){const p=Number(fs.readFileSync(f,'utf8'));try{if(fs.readFileSync('/proc/'+p+'/cmdline','utf8').includes('QC_PROXY_MATRIZ'))process.kill(p,'SIGTERM')}catch{}fs.unlinkSync(f)}'''
            subprocess.run(['docker','exec','-u','0',API,'node','-e',codigo],check=True,capture_output=True,timeout=15)
        if self.cuenta_bootstrap_sql:sql("DROP USER '"+self.cuenta_bootstrap_sql+"'@'%';")

def main():
    with sync_playwright() as motor:
        p=Pruebas(motor);p.inicio=datetime.now(timezone.utc).isoformat();p.identificador='MATRIZ-'+datetime.now().strftime('%Y%m%d-%H%M%S')+'-cli';p.fase='cli';p.entorno={};c=Comandos(p)
        try:c.ejecutar()
        finally:c.cerrar();p.cerrar();p.guardar_reporte()
if __name__=='__main__':main()
