<div align="center">

<img src="docs/screenshots/banner.png" alt="Fixit Editor" width="100%">

# Fixit Editor

**Un editor de código ligero y elegante para Windows, con aspecto de cristal esmerilado.**

![License](https://img.shields.io/badge/license-proprietary-lightgrey)
![Platform](https://img.shields.io/badge/platform-Windows-0078d4)
![Built with](https://img.shields.io/badge/built%20with-Tauri%20%C2%B7%20React%20%C2%B7%20CodeMirror%206-444)

[Sitio web](https://fixit-editor.lapius7.com) · [Documentación](https://fixit-editor.lapius7.com/docs) · [Historial de cambios](https://fixit-editor.lapius7.com/es/changelog) · [Licencia](#licencia)

[English](README.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [简体中文](README.zh-CN.md) · **Español**

</div>

## Resumen

Fixit Editor es un pequeño editor de código con aspecto de cristal esmerilado. Para Windows hay un instalador (`Fixit-Editor-Setup.exe`) y un único archivo, `Fixit-Editor.exe`. Está hecho con CodeMirror 6 y Tauri, así que arranca rápido y consume poco.

Los ajustes, las estadísticas y los espacios de trabajo se guardan en tu PC. Lo que programas no sale de ella, salvo cuando haces una pregunta a una IA, inicias sesión en Lapount con la sincronización activada, envías comentarios o se envía el recuento anónimo de uso.

<p align="center">
  <img src="docs/screenshots/en-light.png" alt="Fixit Editor en modo claro" width="49%">
  <img src="docs/screenshots/en-dark.png" alt="Fixit Editor en modo oscuro" width="49%">
</p>

## Funciones

Todo lo que se describe aquí está en la última versión, la 1.0.8. Los cambios de cada versión están en el [registro de cambios](https://fixit-editor.lapius7.com/es/changelog).

### Edición

- **Lenguajes y autocompletado:** resaltado de sintaxis para muchos lenguajes. El autocompletado ofrece candidatos propios de cada lenguaje, palabras del documento abierto y fragmentos como `for` e `if`. Emmet funciona en HTML y CSS (escribe una abreviatura y pulsa `Tab`). En HTML, escribir `!` y pulsar `Enter` o `Tab` expande una plantilla HTML5.
- **Vista del código:** minimapa con un marco sobre el rango visible, colores por pares de corchetes, guías de sangría, plegado, resaltado del corchete correspondiente y cierre automático de corchetes y comillas. Los errores de sintaxis y de JSON se subrayan con una línea ondulada. El minimapa, los colores y los subrayados se pueden desactivar por separado.
- **Navegación:** migas de pan (ubicación del archivo › función o clase actual) que abren una lista de elementos del mismo nivel, un esquema (`Ctrl+Shift+O`) para filtrar y saltar a símbolos, ir a la línea y apertura rápida (`Ctrl+P`).
- **Buscar y reemplazar:** un panel flotante translúcido con el número de coincidencias y opciones para mayúsculas, palabra completa y expresiones regulares. La búsqueda en todos los archivos puede incluir o excluir archivos (`*.ts`, `src/**`) o limitarse a las pestañas abiertas.
- **Comandos de edición:** cursores múltiples, selección rectangular, duplicar, mover, eliminar y ordenar líneas, alternar comentarios, cambiar mayúsculas y minúsculas, y sangrar con `Tab` y `Shift+Tab`. En HTML y XML (y en JSX, TSX, Vue y PHP), al renombrar la etiqueta de apertura también se renombra la de cierre.
- **Guardado:** guardado automático, eliminación opcional de espacios finales y salto de línea final al guardar, y un ajuste opcional que reescribe el espacio inicial según el ancho de sangría y los espacios/tabuladores que muestra la barra de estado. Los Makefile, el Markdown y las cadenas de varias líneas se dejan como están. Cada pestaña conserva su historial de deshacer y la posición del cursor.
- **Historial local:** cada vez que guardas se conserva una copia en tu PC. Compárala con el archivo actual y restaura cualquier versión (`Ctrl+Alt+H`).
- **Código como imagen:** convierte la selección (o el archivo completo) en un PNG con fondo degradado y una ventana al estilo de macOS, y cópialo o guárdalo. Los colores y el fondo se pueden configurar.
- **Archivos grandes:** los archivos de más de 1,9 MB muestran un aviso y un botón «Cargar» en lugar de negarse a abrirse. Los cambios hechos fuera del editor se recargan si no tienes ediciones, o se te pregunta antes de sobrescribir.

### Servidores de lenguaje

Son opcionales y están desactivados por defecto. Actívalos en Ajustes y el editor obtiene el servidor la primera vez que se usa (solo se envían peticiones de paquetes; nunca se envían el código ni los nombres de archivo).

- **Lenguajes:** TypeScript y JavaScript (servidor de TypeScript), Python (Pyright), HTML, CSS / SCSS / Less, PHP (Intelephense), Go (gopls), Rust (rust-analyzer), Ruby (Solargraph) y MySQL (sqls).
- **Funciones:** autocompletado (con importación automática en TypeScript), tipos al pasar el cursor, ir a la definición (`F12`, `Ctrl+clic`), ayuda de firmas (`Ctrl+Shift+Space`), buscar referencias (`Shift+F12`), renombrar entre archivos (`F2`), acciones de código (`Ctrl+.`), sugerencias en línea y subrayados de error que siguen tu `tsconfig.json` y `node_modules`. Los cambios que afecten a archivos sin abrir o que solo se apliquen en parte se rechazan indicando el motivo.
- **Control:** un elemento de la barra de estado (`TS`, `PY`, `RS`, etc.) abre una lista con el estado de cada servidor, interruptores por servidor y por función, reinicio tras un error, y CPU y memoria en vivo de los servidores en marcha. Los servidores se detienen cuando se cierra la última pestaña correspondiente (tras 1 minuto por defecto) y al salir de la aplicación. Las carpetas de WSL usan el PATH de tu shell de inicio de sesión de WSL.

### Archivos y carpetas

- **Árbol de archivos:** crea archivos y carpetas escribiendo un nombre en la lista (`test/01/main.js` crea también las carpetas), renombra con un icono que sigue a la extensión, elimina y selecciona varios con `Ctrl` y `Shift`. Cortar, copiar y pegar con `Ctrl+X`, `Ctrl+C` y `Ctrl+V` funciona también con archivos copiados en el Explorador de Windows y con imágenes del portapapeles. Arrastra para mover; si te detienes sobre una carpeta cerrada, se abre. Los cambios hechos fuera del editor aparecen en pocos segundos y el orden coincide con el del Explorador de Windows.
- **Varias carpetas:** añade más carpetas a un espacio de trabajo, de este PC o de WSL y SSH. Cada carpeta tiene su encabezado, se puede quitar del espacio de trabajo y se puede expandir o contraer por completo (`.git` y `node_modules` siguen cerradas).
- **Menú contextual:** abrir en un terminal externo o en el Explorador, abrir un terminal aquí (a elegir entre PowerShell, Símbolo del sistema, Git Bash o una distribución de WSL), abrir en el panel de Git, copiar la ruta y vista previa.
- **Visores:** las imágenes, los PDF, el audio, el vídeo y los documentos de Word (`.docx`) se abren dentro del editor. Un archivo que no se puede abrir muestra el motivo y qué hacer.
- **Editor de imágenes:** recorte con proporciones, giro, volteo, cambio de tamaño, brillo, contraste, saturación, desenfoque, blanco y negro, invertir, deshacer y rehacer. Haz zoom con `Ctrl+rueda` o escribiendo un valor, y copia las imágenes al portapapeles como PNG.
- **Línea de comandos:** con el instalador, escribe `fixit ./` en un terminal o en la barra de direcciones del Explorador para abrir una carpeta.

### Vista previa y navegador

- **Vista previa de Markdown y HTML** (`Ctrl+Alt+V`) junto al código o por separado, y se puede fijar. El Markdown muestra diagramas de Mermaid y fórmulas LaTeX (`$…$`, `$$…$$`, `` ```math ``). Los archivos de Mermaid (`.mmd`, `.mermaid`) tienen resaltado y vista previa.
- **La vista previa de HTML** muestra CSS, JavaScript e imágenes con rutas relativas, y refleja mientras escribes los cambios sin guardar de CSS y JavaScript. Se ejecuta en una vista aislada.
- **Navegador integrado** (`Ctrl+Alt+B`): abre páginas web dentro del editor. Los sitios que prohíben incrustarse no se pueden mostrar.

### Terminal y ejecución

- Varios terminales bajo el editor, con pestañas renombrables, en local, WSL y SSH. Las URL se pueden pulsar y `Ctrl+V` pega. Los colores siguen el tema claro y oscuro.
- Ejecuta el archivo abierto con ▶ (`Ctrl+Alt+R`). El comando de cada extensión se puede editar en Ajustes.
- Los terminales de WSL reciben `FIXIT_CWD=1`, así que un `.zshrc` que salta a la carpeta personal puede conservar la carpeta abierta.

### Git

Un panel de Git a la derecha (con el botón de rama o con el nombre de la rama en la barra de estado) con cuatro pestañas, que también funciona en carpetas de WSL y SSH.

- **Cambios:** preparar, quitar de la preparación, confirmar, descartar (pulsa dos veces para confirmar) y ver diferencias.
- **Árbol e historial:** las ramas de confirmaciones dibujadas como líneas, con los archivos modificados y las diferencias de cada confirmación.
- **Ramas:** crear, cambiar, eliminar (solo las fusionadas), fetch, pull (solo avance rápido) y push.
- **Carpetas que no son repositorios:** crea uno o clónalo desde una URL. Los repositorios dentro de la carpeta abierta se pueden abrir desde una lista.
- El árbol de archivos marca los archivos modificados, el margen del editor muestra las líneas añadidas, cambiadas y eliminadas, y la barra de estado muestra la rama y el número de cambios.

### Carpetas remotas y espacios de trabajo

- Abre carpetas de WSL y SSH como si fueran locales: explorar, editar, guardar, renombrar, eliminar, buscar, mover, usar el panel de Git y usar un terminal. Los archivos CRLF conservan sus saltos de línea. Un selector te deja recorrer las carpetas como en el Explorador, crear carpetas nuevas, ir atrás y adelante con los botones del ratón y reabrir lugares recientes.
- Las operaciones de archivos de WSL y las lecturas de Git pasan por un shell de trabajo que permanece activo dentro de WSL, así que no se inicia `wsl.exe` en cada operación. El tiempo que permanece activo (5 minutos por defecto, 0 para desactivarlo) es un ajuste.
- Los **espacios de trabajo** guardan carpetas, pestañas, la disposición de paneles, terminales, el estado de la vista previa y las posiciones del cursor, y los restauran en el siguiente inicio. La pantalla de inicio muestra los espacios de trabajo recientes como tarjetas con forma de carpeta.
- Los **perfiles** agrupan apariencia, ajustes y atajos. Cambia entre ellos, asocia uno a un espacio de trabajo o expórtalos e impórtalos como archivos.
- Se pueden abrir varias ventanas a la vez sin que se sobrescriban los ajustes, los chats ni los espacios de trabajo de las demás.

### Pestañas y disposición

- Las pestañas se pueden reordenar, fijar a la izquierda (`Alt+P`) y cerrar en bloque. Al cerrar una pestaña sin guardar se ofrece «Guardar y cerrar».
- Divide la vista a izquierda, derecha, arriba o abajo tantas veces como quieras arrastrando una pestaña o un archivo a un borde, o con «Abrir en división». Arrastra un separador para cambiar el tamaño (doble clic para partir a la mitad), intercambia paneles y cambia la dirección. También se pueden arrastrar los separadores entre la barra lateral, el editor, la IA y el navegador.

### IA, solo cuando la pides

- **Proveedores:** tu propia clave de API de Anthropic u OpenAI, la suscripción de Claude mediante el comando oficial `claude` (en Windows o WSL, a elegir), GitHub Copilot mediante el inicio de sesión de dispositivo de GitHub (también funcionan los planes gratuitos), Google Gemini y endpoints compatibles con OpenAI como Ollama, LM Studio y OpenRouter. Todos están desactivados hasta que los actives, y una pantalla de consentimiento muestra el destino antes de la primera petición.
- **Chat:** ábrelo con `Ctrl+Alt+A`. Elige el modelo y el nivel de razonamiento (de low a max). Adjunta código con «Citar en el chat de IA» (`Ctrl+Alt+Q`) o arrastra archivos y pestañas (hasta 8). Adjunta imágenes (hasta 4; PNG, JPEG, GIF y WebP; los demás formatos se convierten y las imágenes grandes se reducen).
- **Conversaciones:** un historial agrupado por día, la hora en cada mensaje, las imágenes adjuntas conservadas en el historial, regenerar y un botón para ir al último mensaje. Los bloques de código se colorean como en el editor, con botones de copiar, y se muestran Mermaid y fórmulas. Los enlaces se abren en tu navegador predeterminado.
- **Acciones:** resumir, explicar, traducir (japonés, inglés, coreano), buscar problemas y añadir comentarios desde el menú contextual del editor. Un botón del panel de Git redacta un mensaje de confirmación a partir de los cambios preparados, con el idioma y el estilo de las confirmaciones recientes.
- **Archivos y comandos:** la IA puede listar, leer, buscar, crear, editar, mover y eliminar archivos y carpetas dentro de la carpeta abierta y, solo en la aplicación de escritorio (carpetas de PC, WSL y SSH), ejecutar un comando de terminal cada vez. La lectura y la búsqueda son automáticas. Todo lo demás se muestra como una tarjeta (diferencias para las ediciones, el comando completo para los comandos) que apruebas antes. Un botón junto al cuadro del chat cambia el modo: «Confirmar» espera tu aprobación para todo (por defecto), «Automático» crea y edita solo y sigue preguntando para mover, eliminar y ejecutar comandos, y «Totalmente automático» no pregunta nada. Los comandos tienen la entrada estándar cerrada y se detienen a los 30 segundos por defecto (120 como máximo). Las rutas fuera de la carpeta, `.git` y los archivos que parecen secretos, como `.env` y las claves, quedan fuera de su alcance. No está disponible con la suscripción de Claude.
- **Uso:** el uso de 5 horas y semanal de la suscripción de Claude y la cuota de Copilot, actualizados cada 5 minutos, y el número de tokens para las claves de API. Las cifras cubren solo lo enviado desde este editor.
- Mientras la IA responde, un resplandor de color recorre el borde de la ventana (se puede desactivar en Ajustes).

### Apariencia

- Diseño de cristal esmerilado con tema claro, oscuro o el del sistema. El color de énfasis y una malla de colores de fondo (arrastra los puntos para darle forma) se ajustan con vista previa en vivo, igual que la opacidad de las superficies, los márgenes de la ventana, la intensidad de las líneas y el grano del fondo.
- Fuentes distintas para la interfaz, el árbol de archivos y el código; se puede elegir cualquier fuente de tu PC. La fuente de código predeterminada es Obel Mono, incluida con la aplicación.
- Las animaciones (olas al cambiar de espacio de trabajo, cristal de la división, avisos) se pueden ralentizar, acortar o desactivar, y respetan el ajuste de movimiento reducido del sistema.
- Idiomas de la interfaz: japonés, inglés y coreano. Una pantalla de primer inicio elige idioma, tema, color de énfasis y lo básico, y luego ofrece iniciar sesión en Lapount (se puede omitir).

### Ajustes y atajos

- Más de 120 ajustes con búsqueda, un filtro de «solo modificados», una marca en los elementos cambiados, restablecimiento por elemento, un historial de cambios que se puede deshacer y exportación e importación en JSON.
- Más de 70 atajos reasignables, con búsqueda por nombre de tecla. La paleta de comandos (`Ctrl+Shift+P`) ejecuta cualquier acción.
- Los ajustes, los chats de IA y las estadísticas son archivos JSON en `%APPDATA%\Fixit` (la aplicación) o en localStorage (navegador), fáciles de copiar como respaldo.
- Un registro de depuración que puedes descargar desde Ajustes → Información para desarrolladores (errores, eventos principales, ajustes y entorno, con el nombre de usuario y los nombres de carpeta ocultos). Nunca se envía automáticamente.

### Estadísticas, actualizaciones y cuentas

- **Estadísticas:** tiempo programando, caracteres escritos, pulsaciones de teclas, guardados y días de racha.
- **Actualizaciones:** aparece la marca «Actualización disponible», y «Actualizar y reiniciar» sustituye la aplicación tras verificar la firma y el hash. Se puede comprobar a mano desde Ajustes o el menú, y una comprobación fallida se reintenta sola.
- **Comentarios:** envía errores y peticiones desde el menú. Con la sesión iniciada, puedes leer las respuestas del desarrollador y contestar dentro de la aplicación.
- **Cuenta de Lapount (opcional):** inicia sesión aprobando un código en el navegador (no se escribe ninguna contraseña en el editor). Sincroniza ajustes, perfiles y espacios de trabajo entre PC, y consulta totales y respuestas en el panel del sitio web. Todas las funciones sirven sin iniciar sesión.

### Seguridad

- Las claves de API de IA y los datos de inicio de sesión de Lapount se cifran con Windows (solo en el exe).
- La aplicación restringe lo que puede cargar, y la vista previa de HTML está aislada del editor.
- La IA solo puede tocar la carpeta abierta y nunca los archivos que parecen secretos. El contenido de los comandos que ejecuta no se filtra: ves el comando completo y apruebas cada uno (salvo en el modo Totalmente automático).

<p align="center">
  <img src="docs/screenshots/en-split.png" alt="Vista dividida" width="49%">
  <img src="docs/screenshots/en-palette.png" alt="Paleta de comandos" width="49%">
</p>

## Privacidad

Solo puede salir de tu PC lo siguiente. El contenido, los nombres y las rutas de los archivos no se incluyen, salvo en las peticiones a la IA como se describe.

- **Peticiones a la IA:** el código seleccionado, el archivo abierto, tu mensaje y los archivos que lea la IA se envían al proveedor que elijas.
- **Recuento de uso anónimo:** una vez al día, un ID aleatorio, la versión de la aplicación, la familia del sistema operativo y el idioma. No hay ajuste para desactivarlo.
- **Comentarios:** solo cuando pulsas Enviar: tu mensaje, su tipo, un contacto opcional, la versión de la aplicación, el sistema operativo y el idioma.
- **Inicio de sesión de Lapount (opcional):** solo cuando inicias sesión, la aplicación obtiene el nombre y el icono de tu cuenta y sincroniza tus ajustes, perfiles y espacios de trabajo (nombres, colores y ubicaciones de carpetas). No se sincronizan las pestañas abiertas, los terminales, las claves y chats de IA, las estadísticas ni el contenido de los archivos. Puedes desactivar la sincronización y borrar los datos de la nube. Los comentarios enviados con la sesión iniciada se vinculan a tu cuenta para que puedas recibir respuestas.
- **Uso detallado y errores:** el tiempo de trabajo diario, los caracteres escritos, las pulsaciones y los guardados, y el tipo, el mensaje y el orden de llamadas de los errores. No hay ajuste para desactivarlo.
- **Servidores de lenguaje (opcionales):** el servidor se descarga de npm, de las versiones de GitHub, con `go install` o con `gem install`. Solo se envía la petición del paquete.
- **Comprobación de actualizaciones:** pide la información de la última versión.

## Compilar desde el código fuente

Necesitas pnpm y Rust con el destino `x86_64-pc-windows-gnu`. El exe de Windows se compila desde WSL o Linux:

```bash
pnpm install
bash scripts/build-win.sh   # genera dist-win/Fixit-Editor.exe
```

## Licencia

Todos los derechos reservados. Puedes usar la aplicación gratis, pero no se permite copiar, redistribuir ni reutilizar el código. Consulta [LICENSE](LICENSE).
