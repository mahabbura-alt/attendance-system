/*
 * OMOS shared feedback for asynchronous save actions.
 *
 * Usage:
 *   await OMOSActionFeedback.run(button, () => saveData());
 *
 * The helper deliberately does not discover buttons by their text. Callers
 * must wrap the authoritative async operation so the busy state matches the
 * real request lifetime and duplicate invocations are rejected reliably.
 */
(function attachOMOSActionFeedback(root, factory) {
  const api = factory();
  if (root) root.OMOSActionFeedback = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function createOMOSActionFeedback() {
  'use strict';

  const activeActions = new WeakMap();
  const DEFAULTS = Object.freeze({
    loadingText: 'Menyimpan\u2026',
    successText: 'Tersimpan',
    errorText: 'Gagal',
    minBusyMs: 250,
    successMs: 700,
    errorMs: 900,
    showSuccess: true,
    showError: true,
  });

  function delay(duration) {
    const milliseconds = Math.max(0, Number(duration) || 0);
    return milliseconds ? new Promise(resolve => setTimeout(resolve, milliseconds)) : Promise.resolve();
  }

  function normalizedOptions(options) {
    return Object.assign({}, DEFAULTS, options || {});
  }

  function isButtonLike(button) {
    return Boolean(
      button
      && typeof button.setAttribute === 'function'
      && typeof button.removeAttribute === 'function'
      && button.classList
      && button.dataset
    );
  }

  function setText(button, text) {
    button.textContent = String(text || '');
  }

  function setState(button, state, text) {
    button.dataset.omosActionState = state;
    button.classList.remove(
      'omos-action-feedback--busy',
      'omos-action-feedback--success',
      'omos-action-feedback--error'
    );
    button.classList.add(`omos-action-feedback--${state}`);
    setText(button, text);
  }

  function restoreAttribute(button, name, value) {
    if (value === null || value === undefined) button.removeAttribute(name);
    else button.setAttribute(name, value);
  }

  function begin(button, options) {
    if (!isButtonLike(button) || button.disabled || activeActions.has(button) || button.dataset.omosBusy === 'true') {
      return null;
    }

    const settings = normalizedOptions(options);
    const measuredWidth = typeof button.getBoundingClientRect === 'function'
      ? button.getBoundingClientRect().width
      : 0;
    const snapshot = {
      disabled: Boolean(button.disabled),
      innerHTML: button.innerHTML,
      ariaBusy: button.getAttribute('aria-busy'),
      ariaDisabled: button.getAttribute('aria-disabled'),
      ariaLabel: button.getAttribute('aria-label'),
      minWidth: button.style ? button.style.minWidth : '',
    };
    const startedAt = Date.now();
    let finished = false;

    if (button.style && measuredWidth > 0 && !button.style.minWidth) {
      button.style.minWidth = `${Math.ceil(measuredWidth)}px`;
    }
    button.dataset.omosBusy = 'true';
    button.disabled = true;
    button.setAttribute('aria-disabled', 'true');
    button.setAttribute('aria-busy', 'true');
    setState(button, 'busy', settings.loadingText);

    const controller = {
      button,
      settings,
      async finish(outcome, detail) {
        if (finished) return;
        finished = true;

        const elapsed = Date.now() - startedAt;
        await delay(Math.max(0, settings.minBusyMs - elapsed));

        const success = outcome !== 'error';
        if (success && settings.showSuccess) {
          button.setAttribute('aria-busy', 'false');
          setState(button, 'success', settings.successText);
          await delay(settings.successMs);
        } else if (!success && settings.showError) {
          button.setAttribute('aria-busy', 'false');
          setState(button, 'error', settings.errorText);
          await delay(settings.errorMs);
        }

        button.classList.remove(
          'omos-action-feedback--busy',
          'omos-action-feedback--success',
          'omos-action-feedback--error'
        );
        delete button.dataset.omosBusy;
        delete button.dataset.omosActionState;
        button.innerHTML = snapshot.innerHTML;
        restoreAttribute(button, 'aria-busy', snapshot.ariaBusy);
        restoreAttribute(button, 'aria-disabled', snapshot.ariaDisabled);
        restoreAttribute(button, 'aria-label', snapshot.ariaLabel);
        if (button.style) button.style.minWidth = snapshot.minWidth;

        const resolvedDisabled = typeof settings.resolveDisabled === 'function'
          ? settings.resolveDisabled({ success, result: detail, originalDisabled: snapshot.disabled })
          : snapshot.disabled;
        button.disabled = Boolean(resolvedDisabled);
        activeActions.delete(button);
        if (typeof settings.onRestore === 'function') {
          try {
            settings.onRestore({ button, success, result: detail });
          } catch (error) {
            console.error('[OMOS Action Feedback] onRestore gagal:', error);
          }
        }
      },
    };

    activeActions.set(button, controller);
    return controller;
  }

  async function run(button, task, options) {
    if (typeof task !== 'function') throw new TypeError('OMOSActionFeedback.run membutuhkan fungsi async.');
    const controller = begin(button, options);
    if (!controller) {
      if (options && typeof options.onBusy === 'function') options.onBusy(button);
      return undefined;
    }

    try {
      const result = await task(controller);
      await controller.finish('success', result);
      return result;
    } catch (error) {
      await controller.finish('error', error);
      throw error;
    }
  }

  function status(element, state, message) {
    if (!element) return;
    const normalizedState = ['loading', 'pending', 'success', 'error', 'warning'].includes(state)
      ? state
      : 'success';
    element.classList.add('omos-save-status');
    element.dataset.omosStatusState = normalizedState;
    element.setAttribute('role', 'status');
    element.setAttribute('aria-live', 'polite');
    element.setAttribute('aria-busy', normalizedState === 'loading' || normalizedState === 'pending' ? 'true' : 'false');
    element.textContent = String(message || '');
  }

  return Object.freeze({
    begin,
    isBusy(button) {
      return Boolean(isButtonLike(button) && (activeActions.has(button) || button.dataset.omosBusy === 'true'));
    },
    run,
    status,
    submitter(event) {
      return event?.submitter
        || event?.currentTarget?.querySelector?.('button[type="submit"], input[type="submit"]')
        || null;
    },
  });
});
