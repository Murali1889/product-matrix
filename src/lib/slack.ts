/**
 * Slack Webhook Integration
 * Sends notifications for comments, revenue edits, and cross-sell opportunities
 */

const SLACK_SETTINGS_KEY = 'slack_settings';

export interface SlackSettings {
  webhookUrl: string;
  notifyOnComment: boolean;
  notifyOnEdit: boolean;
  notifyOnCrossSell: boolean;
}

export function getSlackSettings(): SlackSettings {
  if (typeof window === 'undefined') {
    return { webhookUrl: '', notifyOnComment: true, notifyOnEdit: true, notifyOnCrossSell: true };
  }
  try {
    const raw = localStorage.getItem(SLACK_SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { webhookUrl: '', notifyOnComment: true, notifyOnEdit: true, notifyOnCrossSell: true };
}

export function saveSlackSettings(settings: SlackSettings): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SLACK_SETTINGS_KEY, JSON.stringify(settings));
}

export async function sendSlackNotification(message: {
  text: string;
  blocks?: Array<Record<string, unknown>>;
}): Promise<boolean> {
  const settings = getSlackSettings();
  const webhookUrl = settings.webhookUrl;

  if (!webhookUrl) return false;

  try {
    const res = await fetch('/api/slack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhookUrl, ...message }),
    });
    return res.ok;
  } catch {
    console.error('[Slack] Failed to send notification');
    return false;
  }
}

export function notifyComment(
  author: string,
  clientName: string,
  apiName: string | null,
  text: string
): void {
  const settings = getSlackSettings();
  if (!settings.notifyOnComment || !settings.webhookUrl) return;

  const target = apiName ? `${clientName} → ${apiName}` : clientName;

  sendSlackNotification({
    text: `💬 New comment by ${author} on ${target}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `💬 *New Comment* by *${author}*\n*${target}*\n> ${text}`,
        },
      },
    ],
  });
}

export function notifyRevenueEdit(
  author: string,
  clientName: string,
  apiName: string,
  oldValue: number,
  newValue: number
): void {
  const settings = getSlackSettings();
  if (!settings.notifyOnEdit || !settings.webhookUrl) return;

  const change = newValue > oldValue ? '📈' : '📉';

  sendSlackNotification({
    text: `${change} Revenue edited by ${author}: ${clientName} / ${apiName}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${change} *Revenue Edit* by *${author}*\n*${clientName}* → *${apiName}*\nOld: ₹${oldValue.toLocaleString()} → New: ₹${newValue.toLocaleString()}`,
        },
      },
    ],
  });
}

export async function testSlackWebhook(webhookUrl: string): Promise<boolean> {
  try {
    const res = await fetch('/api/slack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhookUrl,
        text: '✅ Product Matrix connected successfully!',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '✅ *Product Matrix* Slack integration is working!\nYou will receive notifications for comments and revenue edits.',
            },
          },
        ],
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
