# Cierre de ejecución de la matriz HCV

17 de noviembre de 2026. Docker beta existente.

**181 casos aprobados, siete bloqueados por LAN/HTTPS y un criterio retirado.**

| Requisito | Resultado |
| --- | --- |
| RF-1.1 | 8/8 TC aprobados |
| RF-1.2 | 3/3 TC aprobados |
| RF-1.3 | 3/3 TC aprobados |
| RF-1.4 | 6/6 TC aprobados |
| RF-2.1 | 5/5 TC aprobados |
| RF-2.2 | 2/2 TC aprobados |
| RF-2.3 | 28/28 TC aprobados |
| RF-2.4 | 5/5 TC aprobados |
| RF-2.5 | TC-060 aprobado: eliminación deshabilitada |
| RF-3.1 | 3/3 TC aprobados |
| RF-3.2 | 9/9 TC aprobados |
| RF-3.3 | 1/1 TC aprobados |
| RF-3.4 | 5/5 TC aprobados |
| RF-4.1 | 1/1 TC aprobados |
| RF-4.2 | 22/22 TC aprobados |
| RF-4.3 | 6/7 TC aprobados; 1 bloqueado |
| RF-4.4 | 3/3 TC aprobados |
| RF-4.5 | 2/2 TC aprobados |
| RF-4.6 | 1/1 TC aprobados |
| RF-5.1 | 1/1 TC aprobados |
| RF-5.2 | 1/1 TC aprobados |
| RF-5.3 | 37/37 TC aprobados |
| RF-6.1 | 10/11 TC aprobados; 1 bloqueado |
| RF-6.2 | 17/17 TC aprobados |
| RF-7.1 | 1/1 TC aprobados |
| RF-8.1 | TC-182 aprobado: control reservado; no genera reportes |
| RNF-01 | 0/7 TC aprobados; 7 bloqueados |
| RNF-02 | 2/2 TC aprobados |
| RNF-03 | 1/1 TC aprobados |
| RNF-04 | 2/2 TC aprobados |
| RNF-05 | 1/1 TC aprobados |

## Casos bloqueados

- **TC-172**: La API beta está publicada exclusivamente en 127.0.0.1:3002. No se dispone del nombre DNS hospitalario ni de dos puestos de la LAN para comprobar este recorrido.
- **TC-173**: El puerto beta responde HTTP y el sondeo TLS no logra establecer HTTPS. Falta un destino HTTPS del despliegue hospitalario.
- **TC-174**: No hay un certificado TLS presentado por el destino beta local que pueda evaluarse frente al nombre DNS hospitalario.
- **TC-175**: Faltan un servicio HTTPS con certificado interno y los puestos con y sin confianza para comparar su comportamiento.
- **TC-176**: Se observó HTTP 200 en localhost, permitido para esta instalación beta. No hay un destino LAN configurado para evaluar redirección o rechazo por HTTP.
- **TC-177**: Las pruebas locales de respaldo aprobaron; falta el puesto cliente y el destino HTTPS de la LAN para este caso específico.
- **TC-178**: Las descargas y vistas locales aprobaron por HTTP. El puerto beta no ofrece HTTPS; falta el destino TLS para repetir los enlaces con ese protocolo.
