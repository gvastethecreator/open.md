/**
 * Document link activation: click interception and open policy for Read surfaces.
 */

import { getLinkAction } from './document-path.js';

export function createDocumentLinkController({
  adapters = {},
  hooks = {},
} = {}) {
  let disposed = false;

  const handleClick = (event) => {
    if (disposed) return;

    const target = event.target instanceof Element ? event.target.closest('a') : null;
    const hrefAttribute = target?.getAttribute('href');
    if (!target || !hrefAttribute) return;

    if (adapters.isEditMode?.() && target.closest('#editor-view')) {
      event.preventDefault();
      return;
    }

    const action = getLinkAction(hrefAttribute, adapters.getDocumentPath?.() || null, target.href);
    if (action.type === 'anchor') return;

    event.preventDefault();

    if (action.type === 'external') {
      Promise.resolve(adapters.openExternalUrl?.(action.href)).catch((error) => {
        hooks.onDiagnostic?.('Failed to open URL', error);
        hooks.onToast?.('Could not open the external link');
      });
      return;
    }

    if (action.type === 'file') {
      Promise.resolve(adapters.openDocument?.({
        origin: 'link',
        items: [{ path: action.path, fragment: action.fragment }],
      })).catch((error) => {
        hooks.onDiagnostic?.('Could not open the linked document', error);
        hooks.onToast?.('Could not open the linked document');
      });
      return;
    }

    hooks.onToast?.('This link type is not supported');
  };

  return Object.freeze({
    handleClick,
    dispose() {
      disposed = true;
    },
  });
}
