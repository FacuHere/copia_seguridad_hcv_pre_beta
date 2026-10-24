# Guía práctica del temario para mejorar HCV

## Propósito

Esta guía convierte el temario público de **Programación II** en una referencia para trabajar gradualmente sobre Historial Clínico Visual (HCV). No es un plan de estudio obligatorio ni una autorización para cambiar la aplicación. Se consulta cuando una tarea concreta lo necesita; cada cambio debe ser pequeño, preservar el comportamiento y poder verificarse.

## Qué contiene la fuente

La [hoja pública del curso](https://docs.google.com/spreadsheets/d/e/2PACX-1vTJxC-gppzNtkPKXKZrIU66VhDoBytAbHiXYUEbNos2h0TcHtKqsBR6brhJAE7DTyTfJWVFpxdNS3_H/pubhtml?gid=1105730911&single=true) presenta 44 filas numeradas, con columnas para número, fecha, tema, tarea, puntajes y proyecto integrador. No tiene una columna explícita de categoría o descripción: esos datos aparecen en títulos y enlaces. Hay lecciones de HTML/CSS, JavaScript, Express/Node, MongoDB, documentación, React y despliegue; también hay fechas de evaluación, feriados y presentación de proyectos.

Los enlaces de tarea y proyecto se conservan en la hoja original para evitar duplicar el calendario completo. Algunos ejercicios de GitHub contienen `[TU-USERNAME]` en la URL y requieren personalización.

### Fuentes cuyo contenido se revisó

- [Express: servidores, rutas, middleware y errores](https://sites.google.com/fi.unju.edu.ar/creacion-de-servidores-express)
- [Node.js: filesystem, `path` y variables de entorno](https://sites.google.com/fi.unju.edu.ar/servidores-web-fundamentos)
- [Arquitectura y documentación backend](https://sites.google.com/fi.unju.edu.ar/arquitectura-documentacion)
- [HTTP, REST, Fetch y `async/await`](https://sites.google.com/fi.unju.edu.ar/apis-con-js)
- [Formularios, eventos y validación en JavaScript](https://sites.google.com/fi.unju.edu.ar/formularios-con-js)
- [Despliegue backend](https://sites.google.com/fi.unju.edu.ar/despliegue-de-proyecto-backend)

El resto de los recursos de la bibliografía de abajo se conoce por el índice y el título; no se afirma que su contenido se haya leído. El acceso a algunos enlaces posteriores llegó a una página de autenticación de Google, así que no se intentó continuar por esa vía.

## Prioridad para el JavaScript actual

### 1. Entender responsabilidades antes de mover código

En [public/js/app.js](../public/js/app.js), el estado de pacientes y estudios está en variables globales; `loadPatients()` y `loadPatient()` consultan datos, `renderPatients()` y `render()` actualizan la interfaz, y `bindDynamic()` registra eventos para controles generados dinámicamente. La lógica de documentos también vive en el archivo, por ejemplo `loadDocuments()` y `bindDocumentControls()`.

Al leer o cambiar una función, anotá primero su entrada, salida, estado que modifica, llamadas a la API y nodos DOM que toca. Esto permite ver responsabilidades mezcladas sin extraer funciones a ciegas. Aplicalo al modificar una zona; es innecesario crear una ficha formal para cada función pequeña y estable.

Una función ayuda cuando su nombre expresa una tarea y el cuerpo puede entenderse sin seguir muchas ramas. Por ejemplo, una futura separación de `render()` podría delegar el resumen del paciente y la lista de estudios a funciones de renderizado con entradas explícitas. Conviene hacerlo solo si reduce la complejidad y las pruebas pueden verificar que los mismos elementos, textos y controles sigan apareciendo. No dividir una función en envoltorios de una línea que solo agregan saltos entre llamadas.

### 2. Cuándo separar `app.js` en módulos

La separación debe seguir responsabilidades que cambian juntas, no el tamaño del archivo por sí solo. Un módulo sería razonable cuando un grupo cohesivo —por ejemplo, la comunicación HTTP— tenga límites claros, dependencias explícitas y pueda probarse sin cargar toda la interfaz.

Hoy varias funciones dependen de estado global, `document`, selectores compartidos y otras funciones declaradas en el mismo archivo. Moverlas sin definir esas dependencias puede reemplazar una dependencia visible por imports implícitos o ciclos. Antes de extraer, comprobá quién usa cada función, qué estado necesita y cómo se inicializa; si el límite no queda claro, conservarla en el archivo actual es más sencillo. No hace falta adoptar un framework ni diseñar capas nuevas para organizar un cambio pequeño.

### 3. Arrays y objetos para transformar datos sin sorpresas

HCV ya usa operaciones útiles para explicar la transformación de datos: `renderPatients()` filtra pacientes; `loadPatients()` normaliza los IDs recibidos; `render()` ordena una copia de los estudios con `slice().sort(...)`. La copia evita que el orden de presentación modifique el array guardado en el estado.

Preferí transformaciones con un propósito claro (`filter`, `map`, `some`) y nombres que describan el contenido. Usá `...objeto` al derivar una representación si hay que conservar campos no modificados. Evitá encadenar transformaciones difíciles de leer o mutar estado compartido desde varias funciones; para una operación simple, un bucle claro también es correcto.

### 4. DOM, eventos y formularios

Los controles de la lista de estudios y documentos se crean dinámicamente y luego se conectan en `bindDynamic()` o `bindDocumentControls()`. Al trabajar allí, mantené el orden: renderizar nodos, asociar su evento, ejecutar la acción y reflejar el resultado. Si se cambia un selector `data-*`, hay que buscar sus productores y consumidores. Los IDs y clases también enlazan JavaScript, HTML, CSS y pruebas, por lo que no son nombres privados.

Los formularios usan eventos `submit`, `preventDefault()` y `reportValidity()`. La regla práctica es mantener independientes Guardar, Cancelar y cerrar: solo Guardar valida y persiste; las otras acciones descartan. La validación del navegador mejora la interacción, pero el servidor sigue siendo quien protege la integridad de los datos. No dupliques reglas de negocio en el cliente si no se necesitan para orientar al usuario.

### 5. Promesas, Fetch y errores

`apiRequest()` centraliza `fetch`, credenciales de sesión, lectura JSON y conversión de respuestas no exitosas en errores con estado y código. Las funciones de pacientes, estudios y documentos la reutilizan. Esto reduce diferencias entre llamadas; no agregues otro cliente HTTP si una tarea puede usar el existente.

Al escribir una operación asíncrona, mantené visibles sus etapas con `async/await`: solicitar, comprobar la respuesta, actualizar el estado y renderizar. Usá `try/catch` cuando la función pueda traducir el error a un mensaje o recuperar estado; no captures para ignorar fallos. Los mensajes específicos se asignan actualmente mediante `patientApiMessage()`, `studyApiMessage()` y `documentApiMessage()`. No muestres credenciales, tokens ni datos clínicos en errores o consola.

## HTML y CSS

El HTML define la estructura y los formularios; `public/styles.css` contiene presentación. Al cambiar interfaz, respetá las clases, IDs y atributos `data-*` que usa JavaScript. Agrupá reglas CSS por componente o zona manteniendo orden, cascada y media queries. Una regla duplicada no es automáticamente prescindible: primero verificá especificidad y estilos calculados. Cambios de formato deberían producir diffs pequeños; cambios visuales requieren comparación en navegador si se afirma que la apariencia se conservó.

## Pruebas y refactorización segura

Las pruebas actuales usan `node:test`. Hay pruebas de contratos del frontend para pacientes, estudios y documentos, pruebas HTTP de inmutabilidad de fecha, y pruebas de integración para backend y almacenamiento. [test/age.test.js](../test/age.test.js) caracteriza la función local `age()` extrayendo su declaración con `vm` y controla la fecha; demuestra una alternativa sin framework, pero su extracción depende de la forma textual de la función.

Las pruebas de contrato basadas en expresiones regulares detectan selectores, rutas o código esperado, pero no demuestran por sí mismas que el navegador renderice bien ni que un flujo entero funcione. Para un cambio visual o de interacción, complementalas con revisión manual o con la skill `$webapp-testing` si la aplicación puede iniciarse de forma aislada y segura.

Antes de refactorizar:

1. Identificá el comportamiento observable y los consumidores de la zona.
2. Ejecutá la prueba específica y la suite completa segura: `npm test -- --test-reporter=tap`.
3. Hacé un cambio localizado, sin alterar API, sesión, permisos, persistencia ni formato de datos.
4. Repetí las pruebas pertinentes, revisá el diff y comprobá el flujo en navegador cuando corresponda.
5. Si una prueba necesita servicios externos, verificá el aislamiento antes de ejecutarla; nunca uses una base clínica real como sustituto.

En la conversación se registró una línea base histórica de 53 aprobadas, 0 fallidas y 1 omitida por una restricción de symlink. No se volvió a ejecutar al preparar esta guía; no debe tomarse como resultado actual de la rama.

## Consulta de skills

- `$brooks-review`: revisar un diff concreto y sus riesgos antes de integrarlo.
- `$brooks-audit`: mapear responsabilidades y dependencias del proyecto cuando se evalúa una separación.
- `$brooks-debt`: priorizar deuda cuando haya varias mejoras posibles.
- `$brooks-test`: revisar la calidad y los límites de la suite antes de depender de ella para una refactorización.
- `$webapp-testing`: verificar en navegador flujos visibles, errores de consola y diseño renderizado.

Usá la skill que responda a la pregunta de la tarea; no ejecutes una auditoría general para cada cambio.

## Enlaces de consulta

### JavaScript, interfaz y comunicación con la API

- [Introducción a JavaScript](https://sites.google.com/fi.unju.edu.ar/introduccion-al-lenguaje-js) — índice solamente.
- [Funciones, arrays y objetos](https://sites.google.com/fi.unju.edu.ar/funciones-arrays-y-objetos) — índice solamente.
- [DOM](https://sites.google.com/fi.unju.edu.ar/manipulacion-del-dom) — índice solamente.
- [Eventos JavaScript](https://sites.google.com/fi.unju.edu.ar/clases-y-eventos-con-js) — índice solamente.
- [Formularios dinámicos y validación](https://sites.google.com/fi.unju.edu.ar/formularios-con-js) — contenido revisado.
- [Formularios HTML](https://sites.google.com/fi.unju.edu.ar/forms) — índice solamente.
- [Consumo de APIs, HTTP y Fetch](https://sites.google.com/fi.unju.edu.ar/apis-con-js) — contenido revisado.
- [Flujo profesional, Git y GitHub](https://sites.google.com/fi.unju.edu.ar/github-y-github-pages) — índice solamente.

### Node.js, Express y organización

- [Servidores con Express](https://sites.google.com/fi.unju.edu.ar/creacion-de-servidores-express) — contenido revisado.
- [Filesystem, `path` y entornos Node.js](https://sites.google.com/fi.unju.edu.ar/servidores-web-fundamentos) — contenido revisado.
- [Arquitectura y documentación backend](https://sites.google.com/fi.unju.edu.ar/arquitectura-documentacion) — contenido revisado.
- [Swagger](https://sites.google.com/fi.unju.edu.ar/documentacion-con-swagger) — índice solamente.

### Referencias de menor prioridad para HCV actual

- [HTML](https://sites.google.com/fi.unju.edu.ar/introduccion-al-lenguaje-html), [CSS](https://sites.google.com/fi.unju.edu.ar/introduccion-al-lenguaje-css), [responsive](https://sites.google.com/fi.unju.edu.ar/responsive), [Flexbox](https://sites.google.com/fi.unju.edu.ar/flexbox) y [Grid](https://sites.google.com/fi.unju.edu.ar/grid) — consultar ante cambios de interfaz; conocidos por el índice.
- [MongoDB](https://sites.google.com/fi.unju.edu.ar/intro-a-mongodb), [integración MongoDB/Node](https://sites.google.com/fi.unju.edu.ar/integracion-mondodb-y-node) y [CRUD Express/MongoDB](https://sites.google.com/fi.unju.edu.ar/crud-express-y-mongodb) — conceptos CRUD potencialmente transferibles; ejemplos específicos de otra base, conocidos por el índice.
- [React](https://sites.google.com/fi.unju.edu.ar/introduccion-a-react), [Hooks y estado](https://sites.google.com/fi.unju.edu.ar/hooks-y-estados), [React Router](https://sites.google.com/fi.unju.edu.ar/navegacion-con-react-router) y [estado global](https://sites.google.com/fi.unju.edu.ar/estado-global-en-react) — dejar para una decisión futura de interfaz; no son una propuesta de migración.
- [Tailwind](https://sites.google.com/fi.unju.edu.ar/frameworks-css) — framework CSS no usado actualmente; consultar solo si se aprueba expresamente incorporarlo.
- [Despliegue cloud](https://sites.google.com/fi.unju.edu.ar/despliegue-de-proyecto-backend) — contenido revisado, pero sus ejemplos de nube no definen el despliegue LAN hospitalario.

## Criterio final

La guía sirve para elegir una práctica cuando una tarea concreta la necesita. La prioridad es comprender el flujo existente, mantener los contratos y cambiar solo lo que se pueda justificar y comprobar. Si el recurso sugiere una tecnología o regla que no coincide con HCV, se conserva como contexto educativo y no se adopta sin una decisión explícita.
