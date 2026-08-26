# open.md Privacy Policy / Política de privacidad

Effective date / Fecha de vigencia: **2026-08-18**

This policy describes how the desktop application **open.md** handles information. The English text is followed by the Spanish version.

---

## English

### Summary

open.md is a local-first Markdown and text reader/editor.

- It does not require an account.
- It does not include advertising.
- It does not collect analytics or telemetry.
- It does not upload documents, document contents, local images, file paths, or reading preferences to the publisher.
- It does not fetch remote images referenced by Markdown documents.
- Opening a document is read-only. A document is changed only after the user enters an editing mode and saves, or when the user has explicitly enabled the app's autosave behavior.

### Files selected by the user

open.md can read local files selected through the file picker, drag and drop, command-line arguments, or the operating system's **Open with** flow. Supported content includes Markdown and plain text, selected text-based companion formats, and supported local raster images.

The application processes selected content locally on the device. It may temporarily hold document text, rendered HTML, image bytes, paths, and derived statistics in memory while a document is open.

open.md limits the amount of local content it accepts for an instant view. The current application limits are 20 MiB for renderable text documents and 12 MiB for local images or exported image bytes.

### Editing, saving, and autosave

Opening a file does not write to it.

When the user chooses to edit and save, open.md writes only to the selected document or to a destination explicitly chosen by the user. Saves use a temporary file and replacement flow intended to reduce the risk of partially written files.

The app includes an autosave preference. When autosave is enabled and the user is editing, document changes may be written without an additional confirmation for every individual save. Users should disable autosave when they require manual save control.

open.md does not create cloud backups and does not synchronize documents.

### Local images and links

Relative local images may be displayed from the opened document's directory under the application's bounded local-file policy. Remote images are not fetched.

When the user activates an external link, open.md may ask the operating system to open that link in the user's default browser or registered application. The destination service then applies its own privacy policy. open.md does not add document content to external links.

### Local settings

The native application stores the multiple-instance preference in:

```text
%APPDATA%\com.gvastethecreator.openmd\settings.json
```

The embedded webview stores reader preferences locally in its application storage. These settings can include the chosen theme, font preset, reading tools, zoom-related options, autosave preference, always-on-top preference, reduced-motion preference, and optional path-to-theme associations.

A path-to-theme association may contain a local path chosen by the user. It remains in local application storage and is not transmitted by open.md.

### File associations

Packaged builds can register `.md`, `.markdown`, and `.txt` so open.md appears in Windows **Open with** and Default apps interfaces.

open.md does not silently replace the user's default application. On Windows, the in-app action for changing defaults opens the operating system's Default apps settings so the user retains control.

### Network access

The current application does not include telemetry, advertising, account synchronization, cloud document storage, or a production update service.

Before a Microsoft Store EXE release is submitted, the project plans to add a signed Tauri updater because updates for this Store distribution model remain the application's responsibility. When enabled, the updater will request only release metadata and signed update artifacts from a documented HTTPS endpoint. It will not send document content, local file paths, reading history, or preferences. This policy will be reviewed before that feature is enabled.

### Retention and deletion

User documents remain wherever the user stored them. Uninstalling open.md does not delete or modify those documents.

Application settings can remain after uninstall, depending on Windows and WebView2 profile behavior. A user can remove the native settings directory shown above. Webview application data can be removed through Windows application-data controls or by deleting the application's local WebView profile after uninstall.

### Children

open.md is a general-purpose local document utility and is not directed specifically to children. It does not knowingly collect personal information from children or adults.

### Security

Please report security issues privately through the repository's security reporting process:

- Project security policy: `SECURITY.md`
- Repository: `https://github.com/gvastethecreator/open.md`

Do not include private documents, credentials, or sensitive file paths in a public issue.

### Changes

This policy may be updated when application behavior changes. The effective date at the top identifies the current version.

---

## Español

### Resumen

open.md es un lector y editor local de Markdown y texto.

- No requiere una cuenta.
- No incluye publicidad.
- No recopila analíticas ni telemetría.
- No sube documentos, contenido de documentos, imágenes locales, rutas de archivos ni preferencias de lectura al publicador.
- No descarga imágenes remotas referenciadas por documentos Markdown.
- Abrir un documento es una operación de lectura. El documento cambia únicamente cuando el usuario entra en un modo de edición y guarda, o cuando habilitó explícitamente el guardado automático.

### Archivos elegidos por el usuario

open.md puede leer archivos locales elegidos mediante el selector de archivos, arrastrar y soltar, argumentos de línea de comandos o la opción **Abrir con** del sistema operativo. El contenido compatible incluye Markdown y texto plano, determinados formatos auxiliares basados en texto e imágenes raster locales compatibles.

La aplicación procesa el contenido seleccionado localmente en el dispositivo. Mientras un documento está abierto, puede mantener temporalmente en memoria su texto, HTML renderizado, bytes de imágenes, rutas y estadísticas derivadas.

open.md limita el contenido local admitido para una vista instantánea. Los límites actuales son 20 MiB para documentos de texto renderizables y 12 MiB para imágenes locales o bytes de imagen exportados.

### Edición, guardado y guardado automático

Abrir un archivo no escribe sobre él.

Cuando el usuario decide editar y guardar, open.md escribe únicamente en el documento seleccionado o en un destino elegido explícitamente. El guardado utiliza un archivo temporal y un reemplazo diseñado para reducir el riesgo de archivos escritos parcialmente.

La aplicación incluye una preferencia de guardado automático. Cuando está habilitada y el usuario está editando, los cambios pueden escribirse sin una confirmación adicional para cada guardado individual. Se recomienda desactivarla cuando se requiera control manual.

open.md no crea copias de seguridad en la nube ni sincroniza documentos.

### Imágenes locales y enlaces

Las imágenes locales relativas pueden mostrarse desde el directorio del documento abierto bajo una política acotada de archivos locales. Las imágenes remotas no se descargan.

Cuando el usuario activa un enlace externo, open.md puede pedirle al sistema operativo que lo abra en el navegador o aplicación predeterminada. El servicio de destino aplica entonces su propia política de privacidad. open.md no agrega contenido del documento al enlace.

### Configuración local

La aplicación nativa guarda la preferencia de múltiples instancias en:

```text
%APPDATA%\com.gvastethecreator.openmd\settings.json
```

El webview embebido guarda preferencias de lectura en el almacenamiento local de la aplicación. Esto puede incluir tema, tipografías, herramientas de lectura, zoom, guardado automático, siempre visible, reducción de movimiento y asociaciones opcionales entre rutas y temas.

Una asociación ruta-tema puede contener una ruta local elegida por el usuario. Permanece en el almacenamiento local y open.md no la transmite.

### Asociaciones de archivos

Las compilaciones empaquetadas pueden registrar `.md`, `.markdown` y `.txt` para que open.md aparezca en **Abrir con** y Aplicaciones predeterminadas de Windows.

open.md no reemplaza silenciosamente la aplicación predeterminada. En Windows, la acción interna abre la configuración de Aplicaciones predeterminadas para que el usuario mantenga el control.

### Acceso a la red

La aplicación actual no incluye telemetría, publicidad, sincronización de cuentas, almacenamiento de documentos en la nube ni un servicio de actualizaciones de producción.

Antes de enviar una versión EXE a Microsoft Store, el proyecto planea incorporar el updater firmado de Tauri porque, en este modelo de distribución, las actualizaciones siguen siendo responsabilidad de la aplicación. Cuando se habilite, solicitará únicamente metadata de versiones y artefactos de actualización firmados desde un endpoint HTTPS documentado. No enviará contenido de documentos, rutas locales, historial de lectura ni preferencias. Esta política será revisada antes de habilitar esa función.

### Conservación y eliminación

Los documentos permanecen donde el usuario los guardó. Desinstalar open.md no elimina ni modifica esos documentos.

La configuración de la aplicación puede permanecer después de desinstalar, según el comportamiento de Windows y del perfil de WebView2. El usuario puede borrar el directorio nativo indicado arriba. Los datos del webview pueden eliminarse mediante los controles de datos de aplicaciones de Windows o borrando el perfil WebView local después de desinstalar.

### Menores

open.md es una utilidad general de documentos locales y no está dirigida específicamente a menores. No recopila deliberadamente información personal de menores ni de adultos.

### Seguridad

Los problemas de seguridad deben reportarse de forma privada mediante el proceso de seguridad del repositorio:

- Política: `SECURITY.md`
- Repositorio: `https://github.com/gvastethecreator/open.md`

No publiques documentos privados, credenciales ni rutas sensibles en un issue público.

### Cambios

Esta política puede actualizarse cuando cambie el comportamiento de la aplicación. La fecha de vigencia identifica la versión actual.
