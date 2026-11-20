# language: en

@RN-001
Feature: Disponibilidad del inicio de sesión de HCV
  Como usuario de un puesto compartido
  Quiero ingresar aunque otra persona haya cometido errores
  Para continuar utilizando el sistema

  @RF-1.1 @HU-01 @TC-015
  Scenario: TC-015 Ingresar con otra cuenta después de intentos fallidos
    Given que existen las cuentas de prueba A y M activas
    And que no hay una sesión iniciada en este navegador
    And que la cuenta M acumuló 12 intentos fallidos desde este navegador
    When intento ingresar inmediatamente con credenciales válidas de la cuenta A
    Then debo acceder a la aplicación identificado como la cuenta A
    And no se debe exigir una espera por los intentos fallidos anteriores