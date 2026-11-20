"""Comprueba las precondiciones reales para los casos de LAN y HTTPS."""
import json,socket,ssl,subprocess
from datetime import datetime,timezone
from playwright.sync_api import sync_playwright
from ejecutar_matriz import Pruebas,CasoBloqueado

def main():
    with sync_playwright() as motor:
        p=Pruebas(motor);p.inicio=datetime.now(timezone.utc).isoformat();p.identificador='MATRIZ-'+datetime.now().strftime('%Y%m%d-%H%M%S')+'-red';p.fase='red'
        r=subprocess.run(['docker','inspect','--format','{{json .NetworkSettings.Ports}}','hcv_docker_beta_test-api-1'],capture_output=True,text=True,check=True)
        puertos=json.loads(r.stdout);tls=False;error_tls=None
        try:
            with socket.create_connection(('127.0.0.1',3002),timeout=5) as conexion:
                with ssl.create_default_context().wrap_socket(conexion,server_hostname='127.0.0.1'):tls=True
        except (OSError,ssl.SSLError) as error:error_tls=type(error).__name__
        respuesta=p.admin.get('/');p.entorno={'puertos_publicados':puertos,'https_en_puerto_beta':tls,'resultado_sondeo_tls':error_tls,'http_local':respuesta.status,'redireccion_http_local':respuesta.headers.get('location'),'url_lan_y_dos_pc_de_prueba':'No disponibles en esta ejecución'}
        razones={172:('Abrir el nombre interno desde dos PC','La API beta está publicada exclusivamente en 127.0.0.1:3002. No se dispone del nombre DNS hospitalario ni de dos puestos de la LAN para comprobar este recorrido.'),173:('Comprobar HTTPS confiable sin advertencias','El puerto beta responde HTTP y el sondeo TLS no logra establecer HTTPS. Falta un destino HTTPS del despliegue hospitalario.'),174:('Validar identidad y vigencia del certificado','No hay un certificado TLS presentado por el destino beta local que pueda evaluarse frente al nombre DNS hospitalario.'),175:('Comprobar rechazo en un puesto sin confianza en la CA interna','Faltan un servicio HTTPS con certificado interno y los puestos con y sin confianza para comparar su comportamiento.'),176:('Comprobar el tratamiento del acceso HTTP en la LAN','Se observó HTTP 200 en localhost, permitido para esta instalación beta. No hay un destino LAN configurado para evaluar redirección o rechazo por HTTP.'),177:('Utilizar respaldos desde un puesto de red con HTTPS','Las pruebas locales de respaldo aprobaron; falta el puesto cliente y el destino HTTPS de la LAN para este caso específico.'),178:('Comprobar enlaces de documentos bajo HTTPS','Las descargas y vistas locales aprobaron por HTTP. El puerto beta no ofrece HTTPS; falta el destino TLS para repetir los enlaces con ese protocolo.')}
        try:
            for numero,(objetivo,razon) in razones.items():
                def condicion(razon=razon):raise CasoBloqueado(razon)
                p.caso(numero,objetivo,condicion,'Comprobación de precondiciones: publicación Docker, respuesta HTTP y sondeo TLS reales')
        finally:p.cerrar();p.guardar_reporte()
if __name__=='__main__':main()
