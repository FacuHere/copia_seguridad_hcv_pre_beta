"""Reconocimiento sin altas ni cambios de datos para preparar la ejecución QC."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

carpeta = Path('reports/qc/matriz-ejecucion-20261117')
carpeta.mkdir(parents=True, exist_ok=True)
with sync_playwright() as motor:
    navegador = motor.chromium.launch(channel='chromium', headless=True)
    contexto = navegador.new_context()
    pagina = contexto.new_page()
    pagina.goto('http://127.0.0.1:3002')
    pagina.wait_for_load_state('networkidle')
    formulario = pagina.locator('#loginForm')
    formulario.get_by_label('Usuario', exact=True).fill(os.environ['HCV_QC_USUARIO_A'])
    formulario.get_by_label('Contraseña', exact=True).fill(os.environ['HCV_QC_CONTRASENA_A'])
    formulario.get_by_role('button', name='Ingresar', exact=True).click()
    pagina.locator('#appShell').wait_for(state='visible')
    pagina.wait_for_load_state('networkidle')
    # Solo estructura del DOM; no conservar listas ni texto de pacientes reales.
    estructura = pagina.locator('input,select,textarea,button,dialog,form').evaluate_all('els=>els.map(e=>({tag:e.tagName,id:e.id,name:e.name,type:e.type,placeholder:e.placeholder,role:e.getAttribute("role"),label:e.getAttribute("aria-label")}))')
    (carpeta/'estructura-ui.json').write_text(json.dumps(estructura,ensure_ascii=False,indent=2),encoding='utf8')
    respuestas={}
    for ruta in ['/api/health/database','/api/health/storage','/api/pacientes','/api/users','/api/auth/me']:
        respuesta=contexto.request.get('http://127.0.0.1:3002'+ruta)
        respuestas[ruta]={'http':respuesta.status,'claves':list(respuesta.json().keys())}
    (carpeta/'reconocimiento.json').write_text(json.dumps(respuestas,indent=2),encoding='utf8')
    contexto.request.post('http://127.0.0.1:3002/api/auth/logout')
    navegador.close()
print('Reconocimiento completado; estructura guardada sin valores clínicos ni credenciales.')
