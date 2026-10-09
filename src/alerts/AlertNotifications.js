// The merged alert notification's platform side. 058a only decides what it
// says (AlertContent) and when it alerts (AlertScheduler); the Android
// notification, its two channels and the 「暫停提醒 30 分」 action button are
// 058b's native module, which replaces `send` below. Until then a command is
// only remembered, so the debug preview (AlertPreview) can show it.

let last = { command: 'cancel', content: null, at: null };

/**
 * Carries out AlertScheduler's notification command: 'notify' (post or
 * update, alerting), 'update' (silent content update), 'cancel'.
 */
export function sendAlertNotification(command, content, at = Date.now()) {
  last = { command, content: command === 'cancel' ? null : content, at };
  return last;
}

/** The last command, for the debug preview. */
export const lastAlertNotification = () => last;
