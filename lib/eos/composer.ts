type TeclaComposer = {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  esMovil: boolean;
};

/**
 * En escritorio Enter envía y Shift+Enter conserva el salto. En un teclado
 * táctil, Enter siempre queda disponible para escribir varias líneas: el
 * envío se hace con el botón visible del composer.
 */
export function debeEnviarConEnter(tecla: TeclaComposer): boolean {
  return (
    tecla.key === "Enter" &&
    !tecla.shiftKey &&
    !tecla.isComposing &&
    !tecla.esMovil
  );
}
